



import os
import json
import tempfile
from collections import Counter

from parsers.rosters_parser import (
    parse_rosters_data,
    rebuild_parsed_rosters,
)

current_stats_hash = None

ROSTER_DEBOUNCE_SEC = 10.0   # try 8s; tweak to 10–12s if needed

batch_timers = {}
_roster_acc = {}

webhook_buffer = {
    "league": [],
    "stats": [],
    "roster": []
}

last_webhook_time = {
    "league": 0,
    "stats": 0,
    "roster": 0
}

POST_ROUND_TO_WEEK = {
    1: 19,
    2: 20,
    3: 21,
    4: 22,
}

def _player_key(p: dict) -> str:
    """Stable key for merging players from many team payloads."""
    for k in ("rosterId", "playerId", "id", "personaId", "uniqueId"):
        v = p.get(k)
        if v not in (None, "", 0):
            return str(v)
    # fallback if exporter doesn’t provide an id
    first = p.get("firstName") or p.get("first_name") or ""
    last  = p.get("lastName")  or p.get("last_name")  or ""
    pos   = p.get("position")  or p.get("pos")        or ""
    team  = p.get("teamId")    or p.get("teamID")     or p.get("team") or ""
    return f"{first}.{last}.{pos}.{team}".lower()

def _load_team_map(league_id, upload_folder="uploads"):
    p = os.path.join(upload_folder, str(league_id), "team_map.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def find_league_in_subpath(subpath):
    if not subpath:
        return None
    parts = subpath.split("/")
    for p in parts:
        if p.isdigit() and len(p) >= 6:
            return p
    return None


def _add_roster_chunk(league_id: str, players: list[dict]) -> tuple[int, int]:
    acc = _get_roster_acc(league_id)
    pbk = acc["players_by_key"]
    added = 0
    for p in players or []:
        k = _player_key(p)
        if not k:
            continue
        pbk[k] = p
        added += 1
    return added, len(pbk)

def _get_roster_acc(league_id: str) -> dict:
    acc = _roster_acc.get(league_id)
    if not acc:
        acc = {"players_by_key": {}, "timer": None}
        _roster_acc[league_id] = acc
    return acc

def resolve_league_id(payload: dict, subpath: str | None = None, league_data=None):
    # Try payload fields first
    lid = (
        payload.get("leagueId")
        or payload.get("leagueInfo", {}).get("leagueId")
        or payload.get("franchiseInfo", {}).get("leagueId")
    )
    if lid:
        return str(lid)

    # Then parse from URL
    lid = find_league_in_subpath(subpath)
    if lid:
        return lid

    # Then in-memory cache
    lid = league_data.get("latest_league") or league_data.get("league_id")
    if lid:
        return str(lid)

    # Optional dev fallback via .env
    env_default = os.getenv("DEFAULT_LEAGUE_ID")
    return str(env_default) if env_default else None

def is_team_id(value: str) -> bool:
    return isinstance(value, str) and value.isdigit() and value.startswith("774")

def compute_display_week(phase: str | None, week_number: int | None) -> int | None:
    """
    Convert season phase + week_number into a single display week index.
    REG: use week_number directly (1..18)
    POST: map rounds to 19..22
    PRE: return None (we don't display preseason in your UI)
    """
    if week_number is None:
        return None
    if not phase:
        return week_number

    phase_l = phase.lower()
    if phase_l.startswith("reg"):
        return week_number
    if phase_l.startswith("post"):
        return POST_ROUND_TO_WEEK.get(int(week_number), 18 + int(week_number))
    # (Optional) if you ever want to handle preseason explicitly
    # if phase_l.startswith("pre"):
    #     return None
    return week_number

def _atomic_write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".json", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)
        os.replace(tmp, path)
    except Exception:
        try: os.remove(tmp)
        except: pass
        raise

def update_default_week(season_index, week_index, league_data):
    try:
        league_id = league_data.get("latest_league", "3264906")
        default_path = os.path.join("uploads", league_id, "default_week.json")
        season_str = f"season_{season_index}"
        week_str = f"week_{week_index}"
        default_data = {
            "season": season_str,
            "week": week_str
        }
        with open(default_path, "w") as f:
            json.dump(default_data, f, indent=2)
        print(f"🆕 Default week updated: {season_str}, {week_str}")
    except Exception as e:
        print(f"⚠️ Failed to update default week: {e}")

def _flush_roster(league_id: str, dest_folder: str, upload_folder: str):
    """Debounce flush → write merged rosters.json and parsed_rosters.json."""
    acc = _roster_acc.get(league_id)
    if not acc:
        return
    merged_map = acc["players_by_key"]
    merged = list(merged_map.values())

    # Union with previous parsed_rosters to avoid shrinking on partial cycles
    parsed_path = os.path.join(dest_folder, "parsed_rosters.json")
    if os.path.exists(parsed_path):
        try:
            with open(parsed_path, "r", encoding="utf-8") as f:
                prev = json.load(f)

            # handle both raw-list and wrapped-dict formats
            if isinstance(prev, dict):
                prev_players = prev.get("rosterInfoList") or prev.get("players") or []
            elif isinstance(prev, list):
                prev_players = prev
            else:
                prev_players = []

            for p in prev_players:
                k = _player_key(p)
                if k not in merged_map:
                    merged.append(p)

            print(f"🧬 Unioned {len(prev_players)} previous players for fallback safety")

        except Exception as e:
            print(f"⚠️ Couldn’t union previous parsed_rosters.json: {e}")

    # Write a raw-style rosters.json and then run the parser on the merged data
    out_raw = {"rosterInfoList": merged}
    os.makedirs(dest_folder, exist_ok=True)
    raw_path = os.path.join(dest_folder, "rosters.json")

    _atomic_write_json(raw_path, out_raw)

    print(f"✅ Roster merged → {raw_path} (players={len(merged)})")

    output_folder = os.path.join(
        upload_folder,
        league_id,
        "season_global",
        "week_global"
    )

    # 🔧 FINAL, AUTHORITATIVE rebuild from per-team files
    rebuild_parsed_rosters(output_folder)

    valid_team_ids = {
        str(tid) for tid in _load_team_map(league_id).keys()
        if str(tid) not in {"0", "-1", "32", "1000"}
    }

    team_counts = Counter(str(p.get("teamId")) for p in merged)

    missing = valid_team_ids - set(team_counts.keys())
    if missing:
        print(f"🚨 WARNING: Missing teams in roster snapshot: {sorted(missing)}")
    else:
        print("✅ All teams present in roster snapshot")

    # Drive the existing parser (keeps rosters.html reading parsed_rosters.json)
    parse_rosters_data(out_raw, "debounced/merge", dest_folder)

    # Helpful per-team log
    team_counts = Counter(str(p.get("teamId") or p.get("team") or 0) for p in merged)
    non_fa = {tid: c for tid, c in team_counts.items() if tid != "0"}
    print(f"📊 Roster coverage: teams={len(non_fa)} + FA={team_counts.get('0', 0)} players")
    if non_fa:
        top = sorted(non_fa.items(), key=lambda kv: kv[1], reverse=True)[:10]
        print("   top teams:", ", ".join(f"{tid}:{cnt}" for tid, cnt in top))

    # reset accumulator
    merged_map.clear()
    acc["timer"] = None


