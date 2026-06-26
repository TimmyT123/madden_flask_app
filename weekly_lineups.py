#!/usr/bin/env python3

# Every new season...you'll have to make sure you change the league number.
# 26969931 folder is the latest league 6-25-26 when the new one starts find the league number in uploads folder
# From the madden_flask directory:
# Run this on PI:
# python weekly_lineups.py --root uploads/26969931 --season season_1 --out weekly_lineups.txt --csv weekly_lineups.csv
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

def iter_schedule_dirs(season_dir):
    """
    Yields (season_type, week_num, path) for folders like:
      pre_1, pre_2, pre_3, pre_4
      week_1, week_2, ... week_18
    """
    schedule_re = re.compile(r"^(pre|week)_(\d+)$")

    found = []
    for name in os.listdir(season_dir):
        m = schedule_re.match(name)
        if not m:
            continue

        folder_type = m.group(1)
        week_num = int(m.group(2))

        if folder_type == "pre":
            season_type = "PRE"
        else:
            season_type = "REG"

        found.append((season_type, week_num, os.path.join(season_dir, name)))

    def sort_key(item):
        season_type, week_num, _ = item
        order = 0 if season_type == "PRE" else 1
        return (order, week_num)

    for item in sorted(found, key=sort_key):
        yield item


def build_weekly_lineups(root_dir, season_name="season_1"):
    """
    Scans preseason and regular season folders.

    Returns:
      {
        "PRE": OrderedDict({1: [...], 2: [...]}),
        "REG": OrderedDict({1: [...], ..., 18: [...]})
      }
    """
    team_map = load_team_map(root_dir, season_name)
    season_dir = os.path.join(root_dir, season_name)
    if not os.path.isdir(season_dir):
        raise FileNotFoundError(f"Season folder not found: {season_dir}")

    pre_weeks = defaultdict(list)
    reg_weeks = defaultdict(list)

    max_pre_week = 0

    for folder_season_type, folder_week_num, folder_path in iter_schedule_dirs(season_dir):
        sch = load_week_schedule(folder_path)
        if not sch:
            continue

        if folder_season_type == "PRE":
            max_pre_week = max(max_pre_week, folder_week_num)

        # Only regular season 1-18 for WEEK output.
        # Ignore week_19, week_20, week_21, week_23 here because those are playoffs/offseason folders.
        if folder_season_type == "REG" and (folder_week_num < 1 or folder_week_num > 18):
            continue

        for g in normalize_games(sch):
            home_id = get_int(g.get("homeTeamId") or g.get("homeTeam") or g.get("homeId"))
            away_id = get_int(g.get("awayTeamId") or g.get("awayTeam") or g.get("awayId"))
            if home_id is None or away_id is None:
                continue

            home = label_for_team(home_id, team_map)
            away = label_for_team(away_id, team_map)

            # IMPORTANT:
            # Use the FOLDER week number, not Madden's internal weekIndex/weekNumber.
            # Your folders are already correct: pre_1, pre_2, week_1, week_2, etc.
            if folder_season_type == "PRE":
                pre_weeks[folder_week_num].append((away, home))
            else:
                reg_weeks[folder_week_num].append((away, home))

    ordered_pre = OrderedDict()
    for w in range(1, max_pre_week + 1):
        ordered_pre[w] = pre_weeks.get(w, [])

    ordered_reg = OrderedDict()
    for w in range(1, 19):
        ordered_reg[w] = reg_weeks.get(w, [])

    return {
        "PRE": ordered_pre,
        "REG": ordered_reg,
    }


def write_txt(weekly, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        for w, games in weekly["PRE"].items():
            f.write(f"PRE {w},\n")
            for a, b in games:
                f.write(f"{a},{b}\n")

        for w in range(1, 19):
            f.write(f"WEEK {w},\n")
            for a, b in weekly["REG"].get(w, []):
                f.write(f"{a},{b}\n")


def write_csv(weekly, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("SeasonType,Week,Away,Home\n")

        for w, games in weekly["PRE"].items():
            for away, home in games:
                f.write(f"PRE,{w},{away},{home}\n")

        for w in range(1, 19):
            for away, home in weekly["REG"].get(w, []):
                f.write(f"REG,{w},{away},{home}\n")

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
