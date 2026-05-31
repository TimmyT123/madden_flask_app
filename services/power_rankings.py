import os
import json
from datetime import datetime


def _load_json_safe(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _atomic_write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"

    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())

    os.replace(tmp_path, path)


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _get_first(row, keys, default=None):
    for key in keys:
        value = row.get(key)
        if value not in (None, "", "N/A"):
            return value
    return default


def _index_items(data):
    if not data:
        return {}

    if isinstance(data, dict):
        items = (
            data.get("standings")
            or data.get("parsed_standings")
            or data.get("teamStandingInfoList")
            or data.get("teams")
            or data.get("items")
            or []
        )
    elif isinstance(data, list):
        items = data
    else:
        items = []

    out = {}
    for item in items:
        if not isinstance(item, dict):
            continue

        tid = str(item.get("teamId") or item.get("teamID") or item.get("id") or "").strip()
        if tid:
            out[tid] = item

    return out


def load_standings_map(upload_folder, league_id):
    base = os.path.join(upload_folder, str(league_id), "season_global", "week_global")

    raw_path = os.path.join(base, "standings.json")
    parsed_path = os.path.join(base, "parsed_standings.json")

    raw_idx = _index_items(_load_json_safe(raw_path, {}))
    parsed_idx = _index_items(_load_json_safe(parsed_path, {}))

    merged = dict(parsed_idx)

    for tid, raw_row in raw_idx.items():
        if tid in merged:
            merged[tid] = {**raw_row, **merged[tid]}
        else:
            merged[tid] = raw_row

    return merged


def load_team_map(upload_folder, league_id):
    path = os.path.join(upload_folder, str(league_id), "team_map.json")
    data = _load_json_safe(path, {})
    return data if isinstance(data, dict) else {}


def load_league_teams(upload_folder, league_id):
    path = os.path.join(
        upload_folder,
        str(league_id),
        "season_global",
        "week_global",
        "parsed_league_info.json"
    )

    data = _load_json_safe(path, {}) or {}

    teams = (
        data.get("leagueTeamInfoList")
        or data.get("teamInfoList")
        or data.get("teams")
        or []
    )

    return data, teams


def _record_from_standings(row):
    wins = _safe_int(_get_first(row, ["wins", "overallWins", "totalWins"], 0))
    losses = _safe_int(_get_first(row, ["losses", "overallLosses", "totalLosses"], 0))
    ties = _safe_int(_get_first(row, ["ties", "overallTies", "totalTies"], 0))

    games = wins + losses + ties
    win_pct = ((wins + (ties * 0.5)) / games) if games else 0

    record = f"{wins}-{losses}-{ties}" if ties else f"{wins}-{losses}"

    return wins, losses, ties, games, win_pct, record


def _rank_score(rank, max_rank=32):
    """
    Lower rank is better.
    #1 gets the most points.
    Missing ranks get 0.
    """
    rank = _safe_int(rank, 0)
    if rank <= 0:
        return 0
    return max(0, max_rank + 1 - rank)


def _fmt_signed(value):
    value = _safe_int(value, 0)
    return f"+{value}" if value > 0 else str(value)


def _is_cpu_user(user):
    if not user:
        return True
    return str(user).strip().lower() == "cpu"


def build_power_rankings(upload_folder, league_id, season=None, week=None, top_n=10):
    league_id = str(league_id)

    league_info, teams = load_league_teams(upload_folder, league_id)
    standings = load_standings_map(upload_folder, league_id)
    team_map = load_team_map(upload_folder, league_id)

    rows = []

    for team in teams:
        tid = str(team.get("teamId") or team.get("id") or "").strip()
        if not tid:
            continue

        team_info = team_map.get(tid, {}) if isinstance(team_map, dict) else {}

        team_name = (
            team_info.get("name")
            or team.get("teamName")
            or team.get("name")
            or team.get("displayName")
            or f"Team {tid}"
        )

        user = (
            team_info.get("userName")
            or team_info.get("ownerName")
            or team_info.get("displayName")
            or team_info.get("user")
            or "CPU"
        )

        # Exclude CPU teams from Power Rankings.
        if _is_cpu_user(user):
            continue

        S = standings.get(tid) or {}

        wins, losses, ties, games, win_pct, record = _record_from_standings(S)

        team_ovr = _safe_int(
            _get_first(team, ["teamOvr", "teamOverall", "ovr", "overall"], 0)
        )

        off_total_rank = _safe_int(S.get("offTotalYdsRank"), 0)
        def_total_rank = _safe_int(S.get("defTotalYdsRank"), 0)
        pf_rank = _safe_int(S.get("ptsForRank"), 0)
        pa_rank = _safe_int(S.get("ptsAgainstRank"), 0)
        to_diff = _safe_int(S.get("tODiff"), 0)

        # Main score.
        # Record matters most.
        record_score = (wins * 100) - (losses * 45) + (ties * 25)

        # Stats support the ranking.
        points_score = (_rank_score(pf_rank) * 3) + (_rank_score(pa_rank) * 3)
        yardage_score = (_rank_score(off_total_rank) * 1.5) + (_rank_score(def_total_rank) * 1.5)
        turnover_score = to_diff * 4

        # Small bonus for winning with a lower OVR roster.
        # Do not make this too strong, or users will argue about roster strength.
        low_ovr_bonus = 0
        if team_ovr and team_ovr < 84:
            low_ovr_bonus = (84 - team_ovr) * 5

        score = record_score + points_score + yardage_score + turnover_score + low_ovr_bonus

        reasons = []
        if wins:
            reasons.append(f"{record} record")
        if pf_rank:
            reasons.append(f"PF #{pf_rank}")
        if pa_rank:
            reasons.append(f"PA #{pa_rank}")
        if to_diff:
            reasons.append(f"TO {_fmt_signed(to_diff)}")
        if off_total_rank:
            reasons.append(f"OFF #{off_total_rank}")
        if def_total_rank:
            reasons.append(f"DEF #{def_total_rank}")

        rows.append({
            "team_id": tid,
            "team": team_name,
            "user": user,
            "record": record,
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "games": games,
            "win_pct": round(win_pct, 3),
            "ovr": team_ovr,
            "to_diff": to_diff,
            "to_diff_pretty": _fmt_signed(to_diff),
            "off_total_rank": off_total_rank,
            "def_total_rank": def_total_rank,
            "pf_rank": pf_rank,
            "pa_rank": pa_rank,
            "score": round(score, 2),
            "reason": ", ".join(reasons) if reasons else "Strong overall ranking profile."
        })

    rows.sort(
        key=lambda r: (
            r["score"],
            r["wins"],
            r["win_pct"],
            r["to_diff"]
        ),
        reverse=True
    )

    rankings = []
    for i, row in enumerate(rows[:top_n], start=1):
        row["rank"] = i
        rankings.append(row)

    output = {
        "league_id": league_id,
        "season": season,
        "week": week,
        "calendar_year": league_info.get("calendarYear"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "top_n": top_n,
        "note": "For fun only. Official Madden standings still control playoff position.",
        "rankings": rankings
    }

    out_path = os.path.join(upload_folder, league_id, "power_rankings.json")
    _atomic_write_json(out_path, output)

    return output
