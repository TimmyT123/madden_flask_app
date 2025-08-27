#!/usr/bin/env python3

# From the directory that contains the 17287266 folder:
#python weekly_lineups.py --root uploads\17287266 --season season_4 --out weekly_lineups.txt --csv weekly_lineups.csv

import argparse
import json
import os
import re
from collections import defaultdict, OrderedDict

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def load_team_map(root_dir, season_name=None):
    """
    Return {int(teamId): "Label"} where Label prefers Nickname, else Abbr, else City.
    Looks for a team map in many shapes, else rebuilds from league files.
    """
    import os, json

    def load_json(p):
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)

    def pick_label(t):
        nickname = (t.get("teamNickName") or t.get("nickname") or
                    t.get("displayName") or t.get("teamName") or t.get("name") or "")
        abbr = t.get("teamAbbr") or t.get("abbr") or ""
        city = t.get("teamName") or t.get("city") or ""
        label = (nickname or abbr or city or "").strip()
        return label

    def coerce_map(obj):
        """
        Try many common shapes and return {int(teamId): label} or {}.
        Supported:
          - {"1":"Eagles", "2":"Bears"}  (simple dict)
          - {"team_map": {...}} or {"mapping": {...}}
          - [{"teamId":1,"teamNickName":"Eagles"}, ...]
          - {"teams":[...]} or {"leagueTeamInfoList":[...]}
          - [[1,"Eagles"],[2,"Bears"]] (list of pairs)
        """
        m = {}

        # simple dict (id -> label)
        if isinstance(obj, dict):
            # unwrap common wrappers
            for wrap_key in ("team_map", "mapping", "map", "data"):
                if wrap_key in obj and isinstance(obj[wrap_key], (dict, list)):
                    inner = coerce_map(obj[wrap_key])
                    if inner:
                        return inner

            # If values are scalars (not list/dict), treat as id->label
            if obj and all(not isinstance(v, (list, dict)) for v in obj.values()):
                for k, v in obj.items():
                    try:
                        m[int(k)] = str(v).strip()
                    except Exception:
                        pass
                if m:
                    return m

            # teams in arrays under known keys
            for key in ("teams", "leagueTeamInfoList", "team_list", "items"):
                if key in obj and isinstance(obj[key], list):
                    for t in obj[key]:
                        if not isinstance(t, dict):
                            continue
                        tid = (t.get("teamId") or t.get("teamID") or t.get("id"))
                        try:
                            tid = int(tid)
                        except Exception:
                            continue
                        label = pick_label(t) or f"Team{tid}"
                        m[tid] = label
                    if m:
                        return m

        # list of dicts or list of pairs
        if isinstance(obj, list):
            # list of dicts with teamId
            for t in obj:
                if isinstance(t, dict) and any(k in t for k in ("teamId", "teamID", "id")):
                    tid = (t.get("teamId") or t.get("teamID") or t.get("id"))
                    try:
                        tid = int(tid)
                    except Exception:
                        continue
                    label = pick_label(t) or f"Team{tid}"
                    m[tid] = label
            if m:
                return m

            # list of [id, label] pairs
            for item in obj:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    tid, label = item[0], item[1]
                    try:
                        tid = int(tid)
                        m[tid] = str(label).strip()
                    except Exception:
                        pass
            if m:
                return m

        return {}

    # 1) Try common team_map.json locations
    tried = []
    candidates = [os.path.join(root_dir, "team_map.json")]
    if season_name:
        candidates.append(os.path.join(root_dir, season_name, "team_map.json"))

    for p in candidates:
        tried.append(p)
        if os.path.exists(p):
            data = load_json(p)
            mapping = coerce_map(data)
            if mapping:
                print(f"✔ Using team map from: {p}")
                return mapping
            else:
                print(f"⚠ team_map.json found at {p} but format wasn’t recognized; will try league files.")

    # 2) Rebuild from league files (season_global then root)
    league_candidates = [
        os.path.join(root_dir, "season_global", "week_global", "parsed_league_info.json"),
        os.path.join(root_dir, "season_global", "week_global", "league.json"),
        os.path.join(root_dir, "league.json"),
    ]
    teams_list = None
    for p in league_candidates:
        if os.path.exists(p):
            data = load_json(p)
            # accept either leagueTeamInfoList or teams
            teams_list = (data.get("leagueTeamInfoList") if isinstance(data, dict) else None) \
                         or (data.get("teams") if isinstance(data, dict) else None)
            if teams_list:
                break

    if not teams_list:
        raise FileNotFoundError(
            "team_map.json not found or unrecognized, and couldn’t build from league files.\n"
            "Tried team map at: " + " | ".join(tried) + "\n" +
            "Tried league files at: " + " | ".join(league_candidates)
        )

    mapping = {}
    for t in teams_list:
        if not isinstance(t, dict):
            continue
        tid = t.get("teamId") or t.get("teamID") or t.get("id")
        try:
            tid = int(tid)
        except Exception:
            continue
        label = pick_label(t) or f"Team{tid}"
        mapping[tid] = label

    print("✔ Built team map from league files")
    # Optionally write a normalized team_map.json at root for next time
    try:
        out_path = os.path.join(root_dir, "team_map.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        print(f"✔ Wrote normalized team_map.json to {out_path}")
    except Exception as e:
        print(f"⚠ Couldn’t write normalized team_map.json: {e}")

    return mapping

def iter_week_dirs(season_dir):
    """
    Yields (week_num:int, week_path) for folders like week_1, week_2, ... in numeric order.
    """
    week_re = re.compile(r"^week_(\d+)$")
    for name in sorted(os.listdir(season_dir), key=lambda s: (len(s), s)):
        m = week_re.match(name)
        if not m:
            continue
        week_num = int(m.group(1))
        yield week_num, os.path.join(season_dir, name)

def load_week_schedule(week_dir):
    """
    Load parsed_schedule.json if present, else schedule.json.
    Returns a Python object (dict or list).
    """
    for fname in ("parsed_schedule.json", "schedule.json"):
        path = os.path.join(week_dir, fname)
        if os.path.exists(path):
            return load_json(path)
    return None

def normalize_games(schedule_obj):
    """
    Returns an iterable of game dicts with keys (best-effort):
      - seasonType/weekType
      - weekIndex/weekNumber
      - homeTeamId, awayTeamId
    Accepts multiple shapes:
      - {"gameScheduleInfoList":[{...}, ...]}
      - {"games":[{...}, ...]}
      - [{...}, ...] (a list at top-level)
      - {"REG":[{...}, ...], "POST":[...]}  (parsed styles)
    """
    # 1) Standard EA companion export
    if isinstance(schedule_obj, dict):
        if isinstance(schedule_obj.get("gameScheduleInfoList"), list):
            return schedule_obj["gameScheduleInfoList"]
        if isinstance(schedule_obj.get("games"), list):
            return schedule_obj["games"]

        # 2) Parsed forms that split by seasonType
        collected = []
        # common keys to check for season buckets
        for k in ("REG", "PRE", "POST", "reg", "pre", "post"):
            v = schedule_obj.get(k)
            if isinstance(v, list):
                # Inject a seasonType marker if missing
                for g in v:
                    if "seasonType" not in g and "weekType" not in g:
                        g = dict(g)
                        g["seasonType"] = k.upper()
                    collected.append(g)
        if collected:
            return collected

    # 3) Top-level list
    if isinstance(schedule_obj, list):
        return schedule_obj

    # Nothing matched
    return []

def get_int(value, default=None):
    try:
        return int(value)
    except Exception:
        return default

def label_for_team(team_id, team_map):
    return team_map.get(team_id, f"Team{team_id}")

def build_weekly_lineups(root_dir, season_name="season_4"):
    """
    Scans weeks, extracts REG-season games for weeks 1..18, returns OrderedDict:
      {week:int -> [(HomeLabel, AwayLabel), ...]}
    """
    team_map = load_team_map(root_dir, season_name)
    season_dir = os.path.join(root_dir, season_name)
    if not os.path.isdir(season_dir):
        raise FileNotFoundError(f"Season folder not found: {season_dir}")

    weeks = defaultdict(list)

    for week_num, week_path in iter_week_dirs(season_dir):
        if week_num < 1 or week_num > 18:
            continue  # only REG 1..18

        sch = load_week_schedule(week_path)
        if not sch:
            continue

        for g in normalize_games(sch):
            season_type = (g.get("seasonType") or g.get("weekType") or "").upper()
            # Some parsed files may not include seasonType; assume REG for weeks 1..18
            if season_type not in ("", "REG"):
                continue

            # Prefer game-provided week if present; else use folder week
            wn = get_int(g.get("weekIndex") or g.get("weekNumber"), default=week_num)
            if wn != week_num:
                # If files are inconsistent, we still keep them under their folder's week
                wn = week_num

            home_id = get_int(g.get("homeTeamId") or g.get("homeTeam") or g.get("homeId"))
            away_id = get_int(g.get("awayTeamId") or g.get("awayTeam") or g.get("awayId"))
            if home_id is None or away_id is None:
                continue

            home = label_for_team(home_id, team_map)
            away = label_for_team(away_id, team_map)
            weeks[wn].append((away, home))

    # Sort matchups alphabetically inside each week for stable output (optional)
    ordered = OrderedDict()
    for w in range(1, 19):
        games = weeks.get(w, [])
        games.sort(key=lambda p: (p[0], p[1]))
        ordered[w] = games
    return ordered

def write_txt(weekly, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        for w in range(1, 19):
            f.write(f"WEEK {w},\n")
            for a, b in weekly.get(w, []):
                f.write(f"{a},{b}\n")

def write_csv(weekly, out_path):
    # CSV with headers Week,Away,Home
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("Week,Away,Home\n")
        for w in range(1, 19):
            for away, home in weekly.get(w, []):
                f.write(f"{w},{away},{home}\n")

def main():
    ap = argparse.ArgumentParser(description="Build Madden weekly lineups (Weeks 1–18) into a file.")
    ap.add_argument("--root", default="17287266", help="Root folder containing team_map.json and season folders (default: 17287266)")
    ap.add_argument("--season", default="season_4", help="Season folder name (e.g., season_4)")
    ap.add_argument("--out", default="weekly_lineups.txt", help="Output text file path")
    ap.add_argument("--csv", default="", help="Optional CSV output path (e.g., weekly_lineups.csv)")
    args = ap.parse_args()

    weekly = build_weekly_lineups(args.root, args.season)
    write_txt(weekly, args.out)
    if args.csv:
        write_csv(weekly, args.csv)

    print(f"✔ Wrote {args.out}" + (f" and {args.csv}" if args.csv else ""))

if __name__ == "__main__":
    main()
