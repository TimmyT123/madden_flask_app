#!/usr/bin/env python3

# Every new season...you'll have to make sure you change the league number.
# From the directory that contains the 3264906 folder:
# Run this on PI:
# python weekly_lineups.py --root uploads\3264906 --season season_4 --out weekly_lineups.txt --csv weekly_lineups.csv
# It will save to madden_flask and then copy and paste to laptop time_madden_old -> wurd24sched.csv and git push and then pull from PI

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
    READ-ONLY. Returns {int(teamId): { ...full team obj... }}.
    Supports your team_map.json shape:
      { "759955486": {"abbr":"BAL","name":"Ravens", ...}, ... }
    """
    import os, json

    def load_json(p):
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)

    # Look in root, then in season folder (but do NOT write anything)
    candidates = [os.path.join(root_dir, "team_map.json")]
    if season_name:
        candidates.append(os.path.join(root_dir, season_name, "team_map.json"))

    last_err = None
    for p in candidates:
        try:
            if os.path.exists(p):
                raw = load_json(p)
                mapping = {}
                # Expect dict of id->dict
                if isinstance(raw, dict):
                    for k, v in raw.items():
                        try:
                            tid = int(k)
                        except Exception:
                            continue
                        if isinstance(v, dict):
                            mapping[tid] = v
                if mapping:
                    print(f"✔ Loaded team_map.json from {p} (read-only)")
                    return mapping
        except Exception as e:
            last_err = e

    # If we get here, we couldn't load/recognize it
    raise FileNotFoundError(
        "Could not load a valid team_map.json. Looked at: "
        + " | ".join(candidates)
        + (f" | Last error: {last_err}" if last_err else "")
    )

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

def label_for_team(team_id, team_map, prefer="name"):
    """
    Build a display label from your rich team objects.
    prefer can be: 'name', 'abbr', or 'name+abbr'
    """
    t = team_map.get(team_id)
    if not isinstance(t, dict):
        return f"Team{team_id}"

    name = (t.get("name") or "").strip()
    abbr = (t.get("abbr") or "").strip()

    if prefer == "name+abbr" and (name or abbr):
        if name and abbr:
            return f"{name} ({abbr})"
        return name or abbr
    if prefer == "abbr":
        return abbr or name or f"Team{team_id}"
    # default: prefer name
    return name or abbr or f"Team{team_id}"

def build_weekly_lineups(root_dir, season_name="season_4"):
    """
    Scans weeks, extracts REG-season games for weeks 1..18, returns OrderedDict:
      {week:int -> [(AwayLabel, HomeLabel), ...]}
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
        #games.sort(key=lambda p: (p[0], p[1]))  # This will sort your games
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
