from flask import Flask, request, jsonify, url_for
from flask import send_from_directory

from datetime import datetime
import os
import json
import requests
from threading import Timer
from hashlib import sha256
from threading import Lock
from time import time
import re

from config import UPLOAD_FOLDER

from parsers.schedule_parser import parse_schedule_data
from parsers.rosters_parser import parse_rosters_data
from parsers.league_parser import parse_league_info_data
from parsers.passing_parser import parse_passing_stats
from parsers.standings_parser import parse_standings_data


from flask import render_template
from urllib.parse import urlparse, parse_qs

from collections import Counter, defaultdict

from dotenv import load_dotenv
load_dotenv()


print("🚀 Running Madden Flask App!")

DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1395202722227290213/fbpHTWl3nwq0XxD-AKriIJSUdBhgqGhGoGxBScUQLBK2d_SxSlIHsCRAj6A3g55kz0aD"

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

league_data = {}

ROSTER_DEBOUNCE_SEC = 8.0   # try 8s; tweak to 10–12s if needed
_roster_acc = {}            # {league_id: {"players_by_key": {}, "timer": Timer | None}}

batch_written = {
    "league": False,
    "stats": False,
    "roster": False
}

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
batch_timers = {}

POST_ROUND_TO_WEEK = {
    1: 19,  # Wild Card
    2: 20,  # Divisional
    3: 21,  # Conference Championship
    4: 22,  # Super Bowl (some leagues may use 4 here)
}

# --- Roster debounce state ---
_roster_pending: dict[str, list] = {}   # {league_id: [ {data, raw, len} , ... ]}
_roster_timers: dict[str, Timer] = {}   # {league_id: Timer}
_roster_state: dict[str, dict] = {}     # {league_id: {"last_hash": str, "last_len": int}}
_roster_lock = Lock()


def _hash_bytes(b: bytes) -> str:
    return sha256(b).hexdigest()


def _queue_roster_write(league_id: str, data: dict, raw_body: bytes, output_dir: str):
    """
    Debounce roster writes for a league; after a short window, write only the largest payload.
    Also avoids re-writing if content hash is unchanged.
    """
    with _roster_lock:
        buf = _roster_pending.setdefault(league_id, [])
        buf.append({
            "data": data,
            "raw": raw_body,
            "len": len(
                data.get("rosterInfoList")
                or data.get("players")
                or data.get("items")
                or []
            ),
        })

        # reset timer
        t = _roster_timers.get(league_id)
        if t:
            t.cancel()

        def _flush():
            with _roster_lock:
                entries = _roster_pending.pop(league_id, [])
            if not entries:
                return

            best = max(entries, key=lambda e: e["len"])
            new_hash = _hash_bytes(best["raw"])
            st = _roster_state.get(league_id, {})

            if st.get("last_hash") == new_hash:
                print("🟡 Roster unchanged; skipping write.")
                return

            os.makedirs(output_dir, exist_ok=True)
            out = os.path.join(output_dir, "rosters.json")
            with open(out, "w", encoding="utf-8") as f:
                json.dump(best["data"], f, indent=2)

            print(f"✅ Roster written once after debounce → {out} (players={best['len']})")

            # cache state, parse, and bust roster cache
            _roster_state[league_id] = {"last_hash": new_hash, "last_len": best["len"]}
            parse_rosters_data(best["data"], "roster", output_dir)
            _roster_cache.pop(league_id, None)

        _roster_timers[league_id] = Timer(2.0, _flush)  # 2s debounce window
        _roster_timers[league_id].start()

import tempfile

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

def _upsert_rosters(league_folder: str, incoming: list[dict]) -> list[dict]:
    """Merge incoming roster batch with existing league-wide rosters.json."""
    path = os.path.join(league_folder, "rosters.json")

    # 1) load current
    current: list[dict] = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            current = (raw.get("rosterInfoList") if isinstance(raw, dict) else raw) or []
        except Exception:
            current = []

    # 2) index by a stable key (prefer rosterId, fallback to playerId, else composite)
    def key(p):
        return str(
            p.get("rosterId")
            or p.get("playerId")
            or f"{p.get('teamId')}_{p.get('jerseyNum')}_{p.get('lastName')}_{p.get('firstName')}"
        )

    by_id = {key(p): p for p in current}
    for p in incoming or []:
        by_id[key(p)] = p   # last write wins per player

    merged = list(by_id.values())

    # 3) write back atomically
    payload = {"success": True, "rosterInfoList": merged}
    _atomic_write_json(path, payload)

    print(f"🧩 Upserted rosters: had {len(current)}, added/updated {len(incoming or [])}, now {len(merged)}")
    return merged

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

def _get_roster_acc(league_id: str) -> dict:
    acc = _roster_acc.get(league_id)
    if not acc:
        acc = {"players_by_key": {}, "timer": None}
        _roster_acc[league_id] = acc
    return acc

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

def _flush_roster(league_id: str, dest_folder: str):
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
            if isinstance(prev, list):
                for p in prev:
                    k = _player_key(p)
                    if k not in merged_map:
                        merged.append(p)
        except Exception as e:
            print(f"⚠️ Couldn’t union previous parsed_rosters.json: {e}")

    # Write a raw-style rosters.json and then run the parser on the merged data
    out_raw = {"rosterInfoList": merged}
    os.makedirs(dest_folder, exist_ok=True)
    raw_path = os.path.join(dest_folder, "rosters.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(out_raw, f, indent=2)
    print(f"✅ Roster merged → {raw_path} (players={len(merged)})")

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

def get_default_season_week():
    league_id = league_data.get("latest_league", "17287266")
    path = os.path.join("uploads", league_id, "default_week.json")
    try:
        with open(path) as f:
            data = json.load(f)
            return data.get("season", "season_0"), data.get("week", "week_0")
    except:
        return "season_0", "week_0"

def _load_json(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def load_team_records(root_dir: str) -> dict[str, tuple[int,int,int]]:
    """
    Returns {teamId(str): (wins, losses, ties)}.
    Looks in uploads/<league_id>/season_global/week_global for parsed_standings.json or standings.json.
    Robust to several common shapes.
    """
    candidates = [
        os.path.join(root_dir, "season_global", "week_global", "parsed_standings.json"),
        os.path.join(root_dir, "season_global", "week_global", "standings.json"),
    ]
    records: dict[str, tuple[int,int,int]] = {}

    def coerce_int(x, default=0):
        try: return int(x)
        except: return default

    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            data = _load_json(path)
        except Exception:
            continue

        lists_to_scan = []
        if isinstance(data, dict):
            for k in ("parsed_standings","standings","teams","teamStandingsInfoList","items"):
                if isinstance(data.get(k), list):
                    lists_to_scan.append(data[k])
        if isinstance(data, list):
            lists_to_scan.append(data)

        for lst in lists_to_scan:
            for item in lst:
                if not isinstance(item, dict):
                    continue
                tid = item.get("teamId") or item.get("teamID") or item.get("id")
                if tid is None:
                    continue
                tid = str(tid)

                w = item.get("wins") or item.get("overallWins") or item.get("totalWins") or 0
                l = item.get("losses") or item.get("overallLosses") or item.get("totalLosses") or 0
                t = item.get("ties") or item.get("overallTies") or item.get("totalTies") or 0
                records[tid] = (coerce_int(w), coerce_int(l), coerce_int(t))

        if records:
            break  # first file that yields data wins

    return records

def make_label_with_record(team_id_str: str, team_map: dict, records: dict, prefer="name") -> str:
    """
    Build 'Name(W-L)' or 'Name(W-L-T)' if ties > 0.
    prefer: 'name' (default) or 'abbr'
    """
    tm = team_map.get(team_id_str, {})
    name = (tm.get("name") or "").strip() if isinstance(tm, dict) else ""
    abbr = (tm.get("abbr") or "").strip() if isinstance(tm, dict) else ""
    base = (name if prefer=="name" else abbr) or name or abbr or f"Team{team_id_str}"

    wlt = records.get(team_id_str)
    if isinstance(wlt, tuple) and len(wlt) == 3:
        w,l,t = wlt
        if w is not None and l is not None:
            return f"{base}({w}-{l}-{t})" if t and t > 0 else f"{base}({w}-{l})"
    return base


# --- helpers ---
def _read_json_from_app_root(filename, default=None):
    path = os.path.join(app.root_path, filename)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default if default is not None else []

def _normalize(records):
    """Map mixed keys to a consistent shape for templates/leaderboards."""
    out = []
    for r in records or []:
        year = int(r.get("year", 0))
        team = r.get("team", "")
        uid = r.get("id") or r.get("discord_id")  # prefer numeric id if present
        handle = r.get("handle")
        alias = r.get("alias", "")
        out.append({"year": year, "team": team, "id": uid, "handle": handle, "alias": alias})
    # sort ascending by year for sections
    out.sort(key=lambda x: x["year"])
    return out

def build_leaderboards(champions, members=None):
    from collections import Counter
    members = members or {}

    # team leaderboard
    team_counts = Counter(c["team"] for c in champions if c.get("team"))

    # user key: prefer numeric id; else handle
    def user_key(c):
        return c.get("id") or (f"@{c['handle']}" if c.get("handle") else None)

    user_counts = Counter(k for c in champions if (k := user_key(c)))

    user_rows = []
    for key, titles in user_counts.most_common():
        if key.startswith("@"):                 # handle-only user
            display_name = key[1:]              # strip '@'
            mention_text = f"@{display_name}"   # readable as text
            alias = next((c.get("alias","") for c in champions if user_key(c) == key and c.get("alias")), "")
        else:                                   # numeric id user
            display_name = members.get(str(key))  # look up from discord_members.json
            mention_text = f"<@{key}>"            # raw mention text for fallback/tooltip
            alias = next((c.get("alias","") for c in champions if c.get("id") == key and c.get("alias")), "")

        user_rows.append({
            "display_name": display_name,  # preferred
            "mention": mention_text,       # fallback / tooltip
            "alias": alias,
            "titles": titles,
        })

    team_rows = [{"team": t, "titles": n} for t, n in team_counts.most_common()]
    return team_rows, user_rows

def enrich_with_names(records, members):
    """Add c['name'] from members[id] so templates can show a friendly name."""
    if not members:
        return records
    for c in records:
        uid = c.get("id")
        if uid is not None:
            c["name"] = members.get(str(uid))  # members keys are strings
    return records


# --- end helpers ---

CHAMPIONS_PATH = os.path.join(app.root_path, "wurd_champions_m25.json")

def load_wurd_champions():
    # keep your existing API fallback logic for m25
    if os.path.exists(CHAMPIONS_PATH):
        with open(CHAMPIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = [
            { "year": 2024, "team": "Detroit Lions",         "discord_id": "1221155508799668275" },
            { "year": 2025, "team": "Tampa Bay Buccaneers",  "discord_id": "960385056776527955" },
            { "year": 2026, "team": "Tampa Bay Buccaneers",  "discord_id": "960385056776527955" },
            { "year": 2027, "team": "Tampa Bay Buccaneers",  "discord_id": "960385056776527955" },
            { "year": 2028, "team": "Washington Commanders", "discord_id": "1274884416187007110", "alias": "dttmkammo" },
            { "year": 2029, "team": "Tampa Bay Buccaneers",  "discord_id": "960385056776527955" },
            { "year": 2030, "team": "Tampa Bay Buccaneers",  "discord_id": "960385056776527955" }
        ]
    # normalize keys for consistency
    for c in data:
        c["year"] = int(c["year"])
        # expose "id" so templates/leaderboards can use it
        if c.get("discord_id") and not c.get("id"):
            c["id"] = c["discord_id"]
    data.sort(key=lambda x: x["year"], reverse=True)
    return data

@app.route("/wurd_champions")
def wurd_champions():
    m24_raw = _read_json_from_app_root("wurd_champions_m24.json", [])
    m25_raw = _read_json_from_app_root("wurd_champions_m25.json", [])

    m24 = _normalize(m24_raw)
    m25 = _normalize(m25_raw)

    members = _read_json_from_app_root("discord_members.json", {})  # {"123...": "Display Name"}

    # ✅ add names to the era lists too
    m24 = enrich_with_names(m24, members)
    m25 = enrich_with_names(m25, members)

    team_rows, user_rows = build_leaderboards(m24 + m25, members)

    return render_template("champions.html",
                           m24=m24, m25=m25,
                           team_rows=team_rows, user_rows=user_rows)

# Optional: JSON API (kept as your m25 endpoint)
@app.route("/api/wurd/champions")
def wurd_champions_api():
    return jsonify(load_wurd_champions())


@app.route('/')
def home():
    base_path = app.config['UPLOAD_FOLDER']
    leagues = []
    latest_season = None
    latest_week = None
    latest_league_id = None

    if os.path.exists(base_path):
        for league_id in os.listdir(base_path):
            league_path = os.path.join(base_path, league_id)
            if os.path.isdir(league_path):
                seasons = []
                for season in os.listdir(league_path):
                    season_path = os.path.join(league_path, season)
                    if os.path.isdir(season_path):
                        weeks = [
                            w for w in os.listdir(season_path)
                            if os.path.isdir(os.path.join(season_path, w)) and re.match(r'^week_\d+$', w)
                        ]
                        weeks.sort(key=lambda x: int(x.replace("week_", "")))

                        seasons.append({'name': season, 'weeks': weeks})

                        if re.match(r'^season_\d+$', season):
                            if not latest_season or season > latest_season:
                                latest_season = season
                                latest_week = sorted(weeks)[-1] if weeks else None
                                latest_league_id = league_id

                leagues.append({'id': league_id, 'seasons': seasons})

    # ✅ Use default_week.json if it exists
    # ✅ Use default_week.json if it exists — but do NOT shift weeks
    if latest_league_id:
        season_from_default, week_from_default = get_default_season_week()

        # If the default paths exist on disk, trust them
        default_dir = os.path.join(base_path, latest_league_id, season_from_default, week_from_default)
        if os.path.isdir(default_dir):
            latest_season = season_from_default
            latest_week = week_from_default
        else:
            # Fallback: pick the latest week that actually exists for the latest season
            season_dir = os.path.join(base_path, latest_league_id, latest_season or "")
            weeks = []
            if os.path.isdir(season_dir):
                weeks = [w for w in os.listdir(season_dir)
                         if os.path.isdir(os.path.join(season_dir, w)) and re.match(r'^week_\d+$', w)]
                weeks.sort(key=lambda x: int(x.replace("week_", "")))
            latest_week = weeks[-1] if weeks else None

    # 💾 Save latest season/week to memory
    league_data["latest_season"] = latest_season
    league_data["latest_week"] = latest_week
    league_data["latest_league"] = latest_league_id

    # ✅ NEW: Compute latest_week_display (Week # for UI)
    if latest_week and latest_week.startswith("week_"):
        latest_week_display = int(latest_week.replace("week_", ""))
    else:
        latest_week_display = "?"

    print(f"latest_week passed to template: {latest_week}", flush=True)

    # turn "week_19" into int 19
    current_week = int(latest_week.replace("week_", "")) if (latest_week and latest_week.startswith("week_") and latest_week[5:].isdigit()) else 0

    return render_template(
        'index.html',
        leagues=leagues,
        latest_league=latest_league_id,
        latest_season=latest_season,
        latest_week=latest_week,
        latest_week_display=latest_week_display,
        current_week=current_week  # 👈 pass to template
    )


@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return 'No selected file', 400

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)
    with open(filepath) as f:
        data = json.load(f)
        league_data.clear()
        league_data.update(data)
    return 'File uploaded and data loaded', 200


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/teams', methods=['GET'])
def get_teams():
    # Try to find the key that contains the team list
    for key, value in league_data.items():
        if "leagueTeamInfoList" in value:
            return jsonify(value["leagueTeamInfoList"])
    return jsonify({'error': 'No team data found'}), 404



@app.route('/teams/<team_name>', methods=['GET'])
def get_team(team_name):
    for team in league_data.get('teams', []):
        if team['name'].lower() == team_name.lower():
            return jsonify(team)
    return jsonify({'message': 'Team not found'}), 404


@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    return jsonify(league_data.get('schedule', []))


@app.route('/webhook', defaults={'subpath': ''}, methods=['POST'])
@app.route('/webhook/<path:subpath>', methods=['POST'])
def webhook(subpath):
    print(f"🔔 Webhook hit! Subpath: {subpath}")

    try:
        data = request.get_json(force=True)
    except Exception as e:
        print(f"❌ Failed to parse JSON: {e}")
        return 'Invalid JSON', 400

    # Extract headers and body inside the request context
    headers = dict(request.headers)
    body = request.data

    # 🚫 Removed threading — now it runs immediately in order
    process_webhook_data(data, subpath, headers, body)

    return 'OK', 200


def get_latest_season_week():
    base_path = app.config['UPLOAD_FOLDER']
    for league_id in os.listdir(base_path):
        league_path = os.path.join(base_path, league_id)
        if os.path.isdir(league_path):
            seasons = [s for s in os.listdir(league_path) if s.startswith("season_")]
            seasons.sort(reverse=True)
            if seasons:
                latest_season = seasons[0]
                weeks_path = os.path.join(league_path, latest_season)
                weeks = [w for w in os.listdir(weeks_path) if w.startswith("week_")]
                weeks.sort(key=lambda x: int(x.replace("week_", "")), reverse=True)

                if weeks:
                    league_data["latest_league"] = league_id
                    league_data["latest_season"] = latest_season
                    league_data["latest_week"] = weeks[0]
                    return

def update_default_week(season_index, week_index):
    try:
        league_id = league_data.get("latest_league", "17287266")
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


def find_league_in_subpath(subpath: str | None) -> str | None:
    # Handles "ps5/17287266/league" or "17287266/league"
    for seg in (subpath or "").split("/"):
        if seg.isdigit() and 6 <= len(seg) <= 12:
            return seg
    return None

def resolve_league_id(payload: dict, subpath: str | None = None) -> str | None:
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


def process_webhook_data(data, subpath, headers, body):
    # ✅ 1. Save debug snapshot
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # ✅ 2. Determine storage path (league id)
    league_id = resolve_league_id(data, subpath)
    if not league_id:
        app.logger.error("No league_id found for webhook; skipping write.")
        return

    league_data["latest_league"] = league_id
    league_data["league_id"] = league_id
    print(f"📎 Using league_id: {league_id}")

    # 3) Classify batch for debug batching
    if "league" in subpath:
        batch_type = "league"
        filename = "webhook_debug_league.txt"
    elif any(x in subpath for x in ["passing", "kicking", "rushing", "receiving", "defense"]):
        batch_type = "stats"
        filename = "webhook_debug_stats.txt"
    elif "roster" in subpath:
        batch_type = "roster"
        filename = "webhook_debug_roster.txt"
    else:
        batch_type = "other"
        filename = "webhook_debug_misc.txt"

    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    # 4) Batch debug logs (unchanged behavior)
    if batch_type not in ["league", "stats", "roster"]:
        with open(debug_path, 'a') as f:
            f.write(f"\n===== NEW WEBHOOK: {subpath} =====\n")
            f.write("HEADERS:\n")
            for k, v in headers.items():
                f.write(f"{k}: {v}\n")
            f.write("\nBODY:\n")
            f.write(body.decode('utf-8', errors='replace'))
            f.write("\n\n")
    else:
        last_webhook_time[batch_type] = time()
        webhook_buffer[batch_type].append({
            "subpath": subpath,
            "headers": headers,
            "body": body.decode('utf-8', errors='replace'),
        })

        if batch_timers.get(batch_type):
            batch_timers[batch_type].cancel()

        def flush_batch(bt=batch_type):
            debug_path = os.path.join(app.config['UPLOAD_FOLDER'], f'webhook_debug_{bt}.txt')
            with open(debug_path, 'w') as f:
                for entry in webhook_buffer[bt]:
                    f.write(f"\n===== NEW WEBHOOK: {entry['subpath']} =====\n")
                    f.write("HEADERS:\n")
                    for k, v in entry['headers'].items():
                        f.write(f"{k}: {v}\n")
                    f.write("\nBODY:\n")
                    f.write(entry['body'])
                    f.write("\n\n")
            print(f"✅ Flushed {bt} batch with {len(webhook_buffer[bt])} webhooks.")
            webhook_buffer[bt] = []

        batch_timers[batch_type] = Timer(5.0, flush_batch)
        batch_timers[batch_type].start()

    # 5) Companion error?
    if 'error' in data:
        print(f"⚠️ Companion App Error: {data['error']}")
        error_filename = f"{subpath.replace('/', '_')}_error.json"
        with open(os.path.join(app.config['UPLOAD_FOLDER'], error_filename), 'w') as f:
            json.dump(data, f, indent=4)
        return

    # 6) Determine type-specific handling
    if "playerPassingStatInfoList" in data:
        filename = "passing.json"
    elif "playerReceivingStatInfoList" in data:
        filename = "receiving.json"
    elif "gameScheduleInfoList" in data:
        filename = "schedule.json"
    elif "rosterInfoList" in data:
        # Skip failed/empty exports so you don't overwrite a good file
        if data.get("success") is False and not data.get("rosterInfoList"):
            print("⚠️ Skipping roster write: export failed / empty list.")
            return

        # Always store rosters in global folder
        league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, "season_global", "week_global")
        os.makedirs(league_folder, exist_ok=True)

        roster_list = data.get("rosterInfoList") or []
        added, total = _add_roster_chunk(league_id, roster_list)
        print(f"📥 Roster chunk received ({len(roster_list)}); merged so far={total} (added={added}).")

        # debounce
        acc = _get_roster_acc(league_id)
        if acc["timer"]:
            acc["timer"].cancel()
        acc["timer"] = Timer(ROSTER_DEBOUNCE_SEC, _flush_roster, args=[league_id, league_folder])
        acc["timer"].start()

        # short-circuit so the generic writer doesn’t overwrite with a partial chunk
        return
    elif "teamInfoList" in data or "leagueTeamInfoList" in data:
        filename = "league.json"
        print("🏈 League Info received and saved!")
        if "leagueTeamInfoList" in data and "teamInfoList" not in data:
            data["teamInfoList"] = data["leagueTeamInfoList"]
        if "teamInfoList" in data:
            league_data["teams"] = data["teamInfoList"]
    elif "teamStandingInfoList" in data:
        filename = "standings.json"
        print("📊 Standings data received and saved!")
    else:
        filename = f"{subpath.replace('/', '_')}.json"

    # 7) Work out season/week (unchanged for non-roster)
    season_index = data.get("seasonIndex") or data.get("season")
    week_index = data.get("weekIndex") or data.get("week")

    stat_lists = [
        "gameScheduleInfoList",
        "playerPassingStatInfoList",
        "playerReceivingStatInfoList",
        "playerRushingStatInfoList",
        "playerKickingStatInfoList",
        "playerPuntingStatInfoList",
        "playerDefensiveStatInfoList",
        "teamStatInfoList",
    ]
    for key in stat_lists:
        if key in data and isinstance(data[key], list) and data[key]:
            first = data[key][0]
            if isinstance(first, dict):
                if not isinstance(season_index, int):
                    season_index = first.get("seasonIndex") or first.get("season")
                if not isinstance(week_index, int):
                    week_index = first.get("weekIndex") or first.get("week")
            break

    if "teamInfoList" in data or "leagueTeamInfoList" in data:
        season_index = "global"
        week_index = "global"

    phase = None
    week_from_path = None
    m = re.search(r'week/(reg|post|pre)/(\d+)', subpath or "")
    if m:
        phase = m.group(1)
        week_from_path = int(m.group(2))

    if "gameScheduleInfoList" in data and isinstance(data["gameScheduleInfoList"], list):
        for game in data["gameScheduleInfoList"]:
            if isinstance(game, dict):
                season_index = season_index or game.get("seasonIndex")
                week_index = week_index or game.get("weekIndex")
                break

    if "teamStandingInfoList" in data and isinstance(data["teamStandingInfoList"], list):
        for t in data["teamStandingInfoList"]:
            if isinstance(t, dict):
                season_index = season_index or t.get("seasonIndex")
                week_index = week_index or t.get("weekIndex")
                break

    def to_int_or_none(v):
        try:
            return int(v)
        except Exception:
            return None

    season_index_int = to_int_or_none(season_index)
    week_index_int_payload = to_int_or_none(week_index)
    week_index_int_path = to_int_or_none(week_from_path)
    raw_week_for_display = week_index_int_path if week_index_int_path is not None else week_index_int_payload
    display_week = compute_display_week(phase, raw_week_for_display)

    # 8) Destination folder (non-roster)
    if (season_index == "global" and week_index == "global") or \
       ("leagueteams" in (subpath or "")) or \
       ("standings" in (subpath or "")):
        season_dir = "season_global"
        week_dir = "week_global"
    else:
        if season_index_int is None:
            print("⚠️ No valid season_index; skipping default_week update.")
            return
        season_dir = f"season_{season_index_int}"

        effective_week = display_week if display_week is not None else week_index_int_payload
        if effective_week is None:
            print("⚠️ No valid week; skipping default_week update.")
            return

        week_dir = f"week_{effective_week}"
        print(f"📌 Auto-updating default_week.json: season_{season_index_int}, week_{effective_week}")
        update_default_week(season_index_int, effective_week)

    league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, season_dir, week_dir)
    os.makedirs(league_folder, exist_ok=True)

    # 9) Write + parse (non-roster)
    if filename == "league.json":
        parse_league_info_data(data, subpath, league_folder)

    # Special handling for roster chunks: merge instead of overwrite
    if filename == "rosters.json":
        merged_players = _upsert_rosters(league_folder, data.get("rosterInfoList") or [])
        # Build a dict for the parser so it sees rosterInfoList (no code change needed there)
        parse_rosters_data({"rosterInfoList": merged_players}, subpath, league_folder)
        # Update cache key and return early to avoid writing the small chunk over the merged file
        league_data[subpath] = {"success": True, "rosterInfoList": merged_players}
        return

    # Generic write for non-roster payloads
    output_path = os.path.join(league_folder, filename)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
    print(f"✅ Data saved to {output_path}")

    # Type-specific parse
    if "playerPassingStatInfoList" in data:
        parse_passing_stats(league_id, data, league_folder)
    elif "gameScheduleInfoList" in data:
        parse_schedule_data(data, subpath, league_folder)
    elif "teamInfoList" in data or "leagueTeamInfoList" in data:
        parse_league_info_data(data, subpath, league_folder)
    elif "teamStandingInfoList" in data:
        parse_standings_data(data, subpath, league_folder)
    elif "playerRushingStatInfoList" in data:
        from parsers.rushing_parser import parse_rushing_stats
        print(f"🐛 DEBUG: Detected rushing stats for season={season_index}, week={week_index}")
        parse_rushing_stats(league_id, data, league_folder)

    # 10) Cache copy
    league_data[subpath] = data


@app.route('/debug', methods=['GET'])
def get_debug_file():
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    if not os.path.exists(debug_path):
        return "No debug file found yet!", 404
    with open(debug_path) as f:
        return f"<pre>{f.read()}</pre>"


@app.route('/uploads', methods=['GET'])
def list_uploaded_files():
    files = os.listdir(app.config['UPLOAD_FOLDER'])
    return render_template('uploads.html', files=files)


def post_highlight_to_discord(message, file_path=None):
    data = {"content": message}
    files = {}
    if file_path and os.path.exists(file_path):
        files["file"] = open(file_path, "rb")
    response = requests.post(DISCORD_WEBHOOK_URL, data=data, files=files)
    if response.status_code == 204:
        print("✅ Highlight posted to Discord!")
    else:
        print(f"❌ Failed to post to Discord: {response.status_code} {response.text}")


import json

@app.route('/stats')
def show_stats():
    # Get league/season/week from query or cache
    league = request.args.get("league") or league_data.get("latest_league") or "17287266"

    if not league_data.get("latest_season") or not league_data.get("latest_week"):
        get_latest_season_week()

    season = request.args.get("season") or league_data.get("latest_season") or "season_0"
    week   = request.args.get("week")   or league_data.get("latest_week")   or "week_0"

    # Normalize folder names
    season = season if season.startswith("season_") else f"season_{season}"
    week   = week   if week.startswith("week_")     else f"week_{week}"

    try:
        base_path = os.path.join(app.config['UPLOAD_FOLDER'], league, season, week)
        filepath  = os.path.join(base_path, "passing.json")  # or "parsed_passing.json" if that's what you output

        players = []
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            players = data.get("playerPassingStatInfoList", [])

        # Load team_map.json for team name lookups
        teams = {}
        team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league, "team_map.json")
        if os.path.exists(team_map_path):
            with open(team_map_path, "r", encoding="utf-8") as f:
                teams = json.load(f)

        # Inject team name
        for p in players:
            team_id = str(p.get("teamId"))
            p["team"] = teams.get(team_id, {}).get("name", "Unknown")

    except FileNotFoundError:
        app.logger.warning(f"Passing file not found: {filepath}")
        players = []
    except Exception as e:
        app.logger.exception(f"❌ Error loading stats: {e}")
        players = []

    return render_template("stats.html", players=players, season=season, week=week, league=league)



@app.route('/receiving')
def show_receiving_stats():
    league = request.args.get("league")

    if not league_data.get("latest_season") or not league_data.get("latest_week"):
        get_latest_season_week()

    season = request.args.get("season") or league_data.get("latest_season")
    week = request.args.get("week") or league_data.get("latest_week")

    # Fix folder names
    season = "season_" + season if not season.startswith("season_") else season
    week = "week_" + week if not week.startswith("week_") else week

    print(f"league: {league}")
    print(f"season: {season}")
    print(f"week: {week}")

    if not league or not season or not week:
        return "Missing league, season, or week", 400

    try:
        base_path = os.path.join(app.config['UPLOAD_FOLDER'], league, season, week)
        filepath = os.path.join(base_path, "receiving.json")

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            players = data.get("playerReceivingStatInfoList", [])

        # Load team names
        team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league, "team_map.json")
        teams = {}
        if os.path.exists(team_map_path):
            with open(team_map_path, "r", encoding="utf-8") as f:
                teams = json.load(f)

        # Inject team name into each player
        for p in players:
            team_id = str(p.get("teamId"))
            team_info = teams.get(team_id, {})
            p["team"] = team_info.get("name", "Unknown")

    except Exception as e:
        print(f"❌ Error loading receiving stats: {e}")
        players = []

    return render_template("receiving.html", players=players, season=season, week=week)


@app.route('/rushing')
def show_rushing_stats():
    league = request.args.get("league")

    if not league_data.get("latest_season") or not league_data.get("latest_week"):
        get_latest_season_week()

    season = request.args.get("season") or league_data.get("latest_season")
    week = request.args.get("week") or league_data.get("latest_week")

    # Normalize folder names
    season = "season_" + season if not season.startswith("season_") else season
    week = "week_" + week if not week.startswith("week_") else week

    print(f"league: {league}")
    print(f"season: {season}")
    print(f"week: {week}")

    if not league or not season or not week:
        return "Missing league, season, or week", 400

    try:
        base_path = os.path.join(app.config['UPLOAD_FOLDER'], league, season, week)
        filepath = os.path.join(base_path, "parsed_rushing.json")

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            # works for both list and dict outputs:
            players = data if isinstance(data, list) else data.get("playerRushingStatInfoList", [])

        # Load team names
        team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league, "team_map.json")
        teams = {}
        if os.path.exists(team_map_path):
            with open(team_map_path, "r", encoding="utf-8") as f:
                teams = json.load(f)

        # Inject team name into each player
        for p in players:
            team_id = str(p.get("teamId"))
            team_info = teams.get(team_id, {})
            p["team"] = team_info.get("name", "Unknown")

    except Exception as e:
        print(f"❌ Error loading rushing stats: {e}")
        players = []

    return render_template("rushing.html", players=players, season=season, week=week)



@app.route("/teams")
def show_teams():
    league_id = "17287266"
    path = f"uploads/{league_id}/season_global/week_global/parsed_league_info.json"

    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as e:
        print(f"⚠️ Error loading league info: {e}")
        return "League info not found", 404

    calendar_year = data.get("calendarYear", "Unknown")
    teams = data.get("leagueTeamInfoList", [])

    for team in teams:
        raw_cap = team.get("capAvailable", "0")

        try:
            # Parse the cap as int
            cap = int(str(raw_cap).strip())

            # Detect and fix unsigned overflow
            if cap > 2_000_000_000:
                cap -= 4_294_967_296  # Fix for 32-bit signed overflow

            team["capAvailableFormatted"] = f"{cap / 1_000_000:.1f} M"
        except Exception as e:
            print(f"⚠️ Cap formatting error for {team.get('name')}: {e}")
            team["capAvailableFormatted"] = "0.0 M"

    # ✅ Sort by teamOvr (highest first)
    try:
        teams.sort(key=lambda x: int(x.get("teamOvr", 0)), reverse=True)
    except Exception as e:
        print(f"⚠️ Error sorting by teamOvr: {e}")

    return render_template("teams.html", calendar_year=calendar_year, teams=teams)

def format_cap(value):
    try:
        return f"{round(int(value)/1_000_000, 1)} M"
    except:
        return "N/A"


# ===== ROSTERS =====

# cache to avoid re-parsing huge files on every request
_roster_cache = {}  # {league_id: {"mtime": float, "players": [...], "positions": set()}}

def _normalize_player(p: dict) -> dict:
    """Return a compact player record with common keys; tolerate missing fields."""
    def g(*keys, default=None):
        for k in keys:
            if k in p and p[k] is not None:
                return p[k]
        return default

    first = g("firstName", "first_name", default="")
    last  = g("lastName", "last_name", default="")
    name  = (first + " " + last).strip() or g("fullName", "name", default="Unknown")

    team_id = str(g("teamId", "teamID", "team", default=""))
    pos     = g("position", "pos", default="UNK")

    # ratings — include Companion synonyms
    ovr = g("overallRating", "ovr", "overall", "playerBestOvr", "playerSchemeOvr", default=0)

    age = g("age", default=None)
    dev = g("devTrait", "developmentTrait", "dev", default=None)

    speed = g("speedRating", "spd", "speed", default=None)
    acc   = g("accelerationRating", "accelRating", "acc", default=None)
    agi   = g("agilityRating", "agi", "agility", default=None)
    strn  = g("strengthRating", "str", "strength", default=None)
    awa   = g("awarenessRating", "awareRating", "awr", default=None)

    thp   = g("throwPowerRating", "throwPower", default=None)
    # prefer single rating; else use short/mid/deep if present
    tha   = g("throwAccRating", "throwAccuracy", "throwAccuracyShort",
              "throwAccShortRating", "throwAccMidRating", "throwAccDeepRating",
              "throwAccShort", "throwAccMid", "throwAccDeep", default=None)

    cat   = g("catching", "catchRating", "catchingRating", default=None)
    cit   = g("catchInTraffic", "cITRating", "catchInTrafficRating", default=None)
    spc   = g("spectacularCatch", "specCatchRating", "spectacularCatchRating", default=None)
    car   = g("carrying", "carryRating", "carryingRating", default=None)
    btk   = g("breakTackleRating", "breakTackle", default=None)

    tak   = g("tackleRating", "tackle", default=None)
    bsh   = g("blockSheddingRating", "blockShedRating", "blockShed", default=None)
    pmv   = g("powerMovesRating", "powerMoves", default=None)
    fmv   = g("finesseMovesRating", "finesseMoves", default=None)
    prc   = g("playRecognitionRating", "playRecRating", "playRec", default=None)
    mcv   = g("manCoverageRating", "manCoverRating", "man", default=None)
    zcv   = g("zoneCoverageRating", "zoneCoverRating", "zone", default=None)
    prs   = g("pressRating", "press", default=None)

    pbk   = g("passBlockRating", "passBlockPowerRating", "passBlockFinesseRating", "pbk", default=None)
    rbk   = g("runBlockRating", "runBlockPowerRating", "runBlockFinesseRating", "rbk", default=None)
    ibl   = g("impactBlocking", "impactBlockRating", "impactBlock", default=None)

    kpw   = g("kickPowerRating", "kickPower", "kpw", default=None)
    kac   = g("kickAccRating", "kickAccuracy", "kac", default=None)

    # make sure OVR is an int if possible
    try:
        ovr = int(ovr)
    except Exception:
        ovr = ovr or 0

    return {
        "name": name, "teamId": team_id, "pos": pos, "ovr": ovr,
        "age": age, "dev": dev,
        "spd": speed, "acc": acc, "agi": agi, "str": strn, "awr": awa,
        "thp": thp, "tha": tha, "cth": cat, "cit": cit, "spc": spc,
        "car": car, "btk": btk,
        "tak": tak, "bsh": bsh, "pmv": pmv, "fmv": fmv, "prc": prc, "mcv": mcv, "zcv": zcv, "prs": prs,
        "pbk": pbk, "rbk": rbk, "ibl": ibl,
        "kpw": kpw, "kac": kac,
    }


def load_roster_index(league_id: str) -> dict:
    """
    Reads uploads/<league>/season_global/week_global/rosters.json (or parsed one),
    normalizes to a compact list and caches it.
    Returns {"players": [...], "positions": set([...])}
    """
    base = os.path.join(app.config['UPLOAD_FOLDER'], league_id, "season_global", "week_global")
    path_candidates = [
        os.path.join(base, "parsed_rosters.json"),
        os.path.join(base, "rosters.json")
    ]
    roster_path = next((p for p in path_candidates if os.path.exists(p)), None)
    if not roster_path:
        return {"players": [], "positions": set()}

    mtime = os.path.getmtime(roster_path)
    cached = _roster_cache.get(league_id)
    if cached and cached["mtime"] == mtime:
        return cached

    # load and normalize
    with open(roster_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    # Support either the Companion raw shape or your parsed shape
    if isinstance(raw, dict):
        players_raw = raw.get("rosterInfoList") or raw.get("players") or raw.get("items") or []
    elif isinstance(raw, list):
        players_raw = raw
    else:
        players_raw = []

    players = [_normalize_player(p) for p in players_raw]
    positions = {p["pos"] for p in players if p.get("pos")}
    out = {"players": players, "positions": positions, "mtime": mtime}
    _roster_cache[league_id] = out
    return out

# Position → columns to show (tweak freely)
POSITION_COLUMNS = {
    "QB":  ["name","pos","ovr","age","dev","thp","tha","awr","spd","acc"],
    "HB":  ["name","pos","ovr","age","dev","spd","acc","agi","car","btk","cth"],
    "FB":  ["name","pos","ovr","age","dev","spd","str","car","ibl","rbk"],
    "WR":  ["name","pos","ovr","age","dev","spd","acc","agi","cth","cit","spc"],
    "TE":  ["name","pos","ovr","age","dev","spd","str","cth","cit","rbk","ibl"],
    "LT":  ["name","pos","ovr","age","dev","str","pbk","rbk","ibl","awr"],
    "LG":  ["name","pos","ovr","age","dev","str","pbk","rbk","ibl","awr"],
    "C":   ["name","pos","ovr","age","dev","str","pbk","rbk","ibl","awr"],
    "RG":  ["name","pos","ovr","age","dev","str","pbk","rbk","ibl","awr"],
    "RT":  ["name","pos","ovr","age","dev","str","pbk","rbk","ibl","awr"],
    "LE":  ["name","pos","ovr","age","dev","spd","pmv","fmv","bsh","prc"],
    "RE":  ["name","pos","ovr","age","dev","spd","pmv","fmv","bsh","prc"],
    "DT":  ["name","pos","ovr","age","dev","str","pmv","fmv","bsh","prc"],
    "LOLB":["name","pos","ovr","age","dev","spd","pmv","fmv","bsh","prc","tak"],
    "MLB": ["name","pos","ovr","age","dev","spd","tak","prc","bsh","awr"],
    "ROLB":["name","pos","ovr","age","dev","spd","pmv","fmv","bsh","prc","tak"],
    "CB":  ["name","pos","ovr","age","dev","spd","mcv","zcv","prs","prc"],
    "FS":  ["name","pos","ovr","age","dev","spd","zcv","mcv","prc","tak"],
    "SS":  ["name","pos","ovr","age","dev","spd","zcv","mcv","prc","tak"],
    "K":   ["name","pos","ovr","age","dev","kpw","kac"],   # if you later add keys
    "P":   ["name","pos","ovr","age","dev","kpw","kac"],
}

# default when "Overall" is selected
OVERALL_COLUMNS = ["name","pos","ovr","age","dev","spd","acc","agi","str","awr"]

# human labels for the table header
COLUMN_LABELS = {
    "name":"Player", "pos":"Pos", "ovr":"OVR", "age":"Age", "dev":"Dev",
    "spd":"SPD","acc":"ACC","agi":"AGI","str":"STR","awr":"AWR",
    "thp":"THP","tha":"THA","cth":"CTH","cit":"CIT","spc":"SPC",
    "car":"CAR","btk":"BTK","tak":"TAK","bsh":"BSH","pmv":"PMV","fmv":"FMV",
    "prc":"PRC","mcv":"MCV","zcv":"ZCV","prs":"PRS","pbk":"PBK","rbk":"RBK","ibl":"IBL",
    "kpw":"KPW","kac":"KAC"
}


# dev trait template
DEV_LABELS = {0: "Normal", 1: "Star", 2: "Superstar", 3: "X-Factor"}

@app.route("/rosters")
def rosters():
    # defaults
    league = request.args.get("league") or league_data.get("latest_league") or "17287266"
    team   = request.args.get("team", "NFL")     # "NFL" = all teams
    pos    = request.args.get("pos", "ALL")      # "ALL" = Overall view
    page   = max(int(request.args.get("page", 1)), 1)
    per    = max(int(request.args.get("per", 50)), 10)

    # load players + positions
    idx = load_roster_index(league)
    players = idx["players"]
    print(f"🧮 rosters page: total players available={len(players)}")
    positions = sorted(list(idx["positions"]))
    positions = ["ALL"] + positions  # first option

    # team list from team_map.json
    team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league, "team_map.json")
    teams = {}
    if os.path.exists(team_map_path):
        with open(team_map_path, "r", encoding="utf-8") as f:
            teams = json.load(f)
    team_options = [{"id": "NFL", "name": "NFL (All Teams)"}] + \
                   [{"id": tid, "name": info.get("name","")} for tid, info in sorted(teams.items(), key=lambda x: x[1].get("name",""))]

    # filter by team
    if team and team != "NFL":
        players = [p for p in players if p.get("teamId") == str(team)]

    # filter by position
    if pos and pos != "ALL":
        players = [p for p in players if p.get("pos") == pos]

    # sort (overall first)
    players.sort(key=lambda p: (p.get("ovr") or 0, p.get("spd") or 0), reverse=True)

    # columns for this view
    columns = OVERALL_COLUMNS if pos == "ALL" else POSITION_COLUMNS.get(pos, OVERALL_COLUMNS)

    # pagination for huge leagues
    total = len(players)
    start = (page - 1) * per
    end   = start + per
    page_players = players[start:end]

    def _dev_to_label(v):
        try:
            return DEV_LABELS.get(int(v), v)
        except (TypeError, ValueError):
            return v or ""

    # make a UI-only copy with 'dev' replaced by its label
    page_players_ui = [{**p, "dev": _dev_to_label(p.get("dev"))} for p in page_players]

    return render_template(
        "rosters.html",
        league=league,
        team=team,
        pos=pos,
        positions=positions,
        teams=team_options,
        columns=columns,
        column_labels=COLUMN_LABELS,
        players=page_players_ui,
        total=total, page=page, per=per
    )


@app.route('/schedule')
def show_schedule():
    league_id = league_data.get("latest_league", "17287266")
    season = request.args.get("season") or league_data.get("latest_season")
    week = request.args.get("week") or league_data.get("latest_week")

    parsed_schedule = []
    if league_id and season and week:
        schedule_path = os.path.join(
            app.config['UPLOAD_FOLDER'],
            league_id,
            season,
            week,
            "parsed_schedule.json"
        )
        if os.path.exists(schedule_path):
            try:
                with open(schedule_path, encoding="utf-8") as f:
                    parsed_schedule = json.load(f)
            except json.JSONDecodeError:
                print("❌ Failed to parse JSON in schedule file.")

    # Load team_map.json (rich structure: id -> {abbr,name,user,...})
    team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league_id, "team_map.json")
    team_map = {}
    if os.path.exists(team_map_path):
        with open(team_map_path, encoding="utf-8") as f:
            team_map = json.load(f)

    # Load records once (from season_global/week_global)
    root_dir = os.path.join(app.config['UPLOAD_FOLDER'], league_id)
    records = load_team_records(root_dir)

    # Decorate labels (visitor first); choose 'name' or switch to 'abbr'
    prefer = "name"  # change to "abbr" if you want e.g., MIA(15-1)
    for game in parsed_schedule:
        away_id = str(game.get("awayTeamId") or game.get("awayTeam") or game.get("awayId"))
        home_id = str(game.get("homeTeamId") or game.get("homeTeam") or game.get("homeId"))

        game["awayName"] = make_label_with_record(away_id, team_map, records, prefer=prefer)
        game["homeName"] = make_label_with_record(home_id, team_map, records, prefer=prefer)

    # ✅ Compute BYE teams once (and hide in playoffs). Include record in BYE label too.
    bye_teams = []
    try:
        week_num = int(str(week).replace("week_", ""))
        if week_num <= 18:
            all_team_ids = set(team_map.keys())  # keys are strings
            teams_played = {str(g.get("homeTeamId")) for g in parsed_schedule} | {str(g.get("awayTeamId")) for g in parsed_schedule}
            bye_team_ids = all_team_ids - teams_played
            bye_teams = sorted([make_label_with_record(tid, team_map, records, prefer=prefer) for tid in bye_team_ids])
    except ValueError:
        print(f"⚠️ Could not parse week value: {week}")

    return render_template("schedule.html", schedule=parsed_schedule, season=season, week=week, bye_teams=bye_teams)


@app.route("/standings")
def show_standings():
    try:
        league_id = "17287266"
        folder = f"uploads/{league_id}/season_global/week_global"
        standings_file = os.path.join(folder, "parsed_standings.json")

        if not league_data.get("latest_season") or not league_data.get("latest_week"):
            get_latest_season_week()

        season = league_data.get("latest_season")
        week = league_data.get("latest_week")

        teams = []
        divisions = defaultdict(list)
        team_map_path = os.path.join("uploads", league_id, "team_map.json")
        team_id_to_info = {}

        def safe_int(val):
            try:
                return int(str(val).strip())
            except:
                return 0

        # Load team_map.json
        try:
            with open(team_map_path) as f:
                team_id_to_info = json.load(f)
        except:
            pass

        # Load standings
        if os.path.exists(standings_file):
            with open(standings_file) as f:
                standings_data = json.load(f)
                teams = standings_data.get("standings", [])

            # Update team_map with latest seed/rank
            updated = False
            for team in teams:
                tid = str(team["teamId"])
                info = team_id_to_info.get(tid, {})
                info["rank"] = team.get("rank")
                info["seed"] = team.get("seed")
                team_id_to_info[tid] = info
                updated = True

            if updated:
                with open(team_map_path, "w") as f:
                    json.dump(team_id_to_info, f, indent=2)

        # Accumulate pointsFor and pointsAgainst across weeks
        team_scores = defaultdict(lambda: {"pointsFor": 0, "pointsAgainst": 0})

        try:
            week_number = int(week.replace("week_", "")) if week.startswith("week_") else int(week)
        except:
            week_number = 0

        for w in range(1, week_number + 1):
            week_folder = os.path.join("uploads", league_id, season, f"week_{w}")
            schedule_path = os.path.join(week_folder, "parsed_schedule.json")

            if os.path.exists(schedule_path):
                with open(schedule_path) as f:
                    try:
                        weekly_games = json.load(f)
                    except:
                        continue

                    for game in weekly_games:
                        home_id = str(game["homeTeamId"])
                        away_id = str(game["awayTeamId"])
                        home_pts = int(game.get("homeScore", 0))
                        away_pts = int(game.get("awayScore", 0))

                        team_scores[home_id]["pointsFor"] += home_pts
                        team_scores[home_id]["pointsAgainst"] += away_pts

                        team_scores[away_id]["pointsFor"] += away_pts
                        team_scores[away_id]["pointsAgainst"] += home_pts

        # Enhance team data with name, division, and points
        for team in teams:
            tid = str(team["teamId"])
            info = team_id_to_info.get(tid, {})
            team["name"] = info.get("name", "")
            team["divisionName"] = info.get("divisionName", "Unknown Division")
            team["pointsFor"] = team_scores[tid]["pointsFor"]
            team["pointsAgainst"] = team_scores[tid]["pointsAgainst"]

            # Clean up streaks that are invalid (e.g., 255 = bugged/unknown)
            try:
                if 200 < int(str(team.get("streak")).strip()) <= 299:
                    team["streak"] = '0'
            except (ValueError, TypeError):
                team["streak"] = '0'

            division_name = team["divisionName"]
            divisions[division_name].append(team)

        # Sort and rank
        teams.sort(key=lambda t: safe_int(t.get("rank")) or 999)
        for div in divisions:
            divisions[div].sort(key=lambda t: safe_int(t.get("rank")) or 999)

        for i, team in enumerate(teams, start=1):
            team["overallRank"] = i

        for div in divisions:
            for i, team in enumerate(divisions[div], start=1):
                team["divisionRank"] = i

        return render_template("standings.html", teams=teams, divisions=divisions)

    except Exception as e:
            import traceback
            error_text = traceback.format_exc()
            print("❌ Standings Error:\n", error_text)
            return f"<pre>{error_text}</pre>", 500

# --- Streamers page ----------------------------------------------------------
@app.route("/streamers")
def streamers_hub():
    league = (request.args.get("league") or "").strip()

    # Try to recover from referrer (?league=... on the previous page)
    if not league and request.referrer:
        try:
            qs = parse_qs(urlparse(request.referrer).query)
            league = (qs.get("league", [None])[0] or "").strip()
        except Exception:
            pass

    # If still missing, auto-pick if there's exactly one league folder
    if not league:
        root = app.config["UPLOAD_FOLDER"]
        leagues = [d for d in os.listdir(root)
                   if os.path.isdir(os.path.join(root, d)) and not d.startswith(".")]
        if len(leagues) == 1:
            league = leagues[0]
        elif len(leagues) > 1:
            # Simple chooser page
            links = "".join(
                f'<li><a href="{url_for("streamers_hub", league=d)}">{d}</a></li>'
                for d in leagues
            )
            return f"<h2>Select league</h2><ul>{links}</ul>", 200

    if not league:
        return "Missing league", 400

    base_league_path = os.path.join(app.config["UPLOAD_FOLDER"], league)
    streamers_path   = os.path.join(base_league_path, "streamers.json")
    team_map_path    = os.path.join(base_league_path, "team_map.json")

    # (Optional) team name lookup
    teams = {}
    if os.path.exists(team_map_path):
        with open(team_map_path, "r", encoding="utf-8") as f:
            teams = json.load(f)

    def build_embed_url(url: str, parent_domain: str):
        """Return an embeddable URL or None if we can't safely embed."""
        if not url:
            return None

        # Twitch channel → embed
        if "twitch.tv" in url:
            m = re.search(r"twitch\.tv/([^/?#]+)", url)
            if m:
                channel = m.group(1)
                # parent must match the domain serving your Flask app
                return f"https://player.twitch.tv/?channel={channel}&parent={parent_domain}&muted=true"
            return None

        # YouTube → embed
        if "youtube.com" in url or "youtu.be" in url:
            if "watch?v=" in url:                  # https://www.youtube.com/watch?v=VIDEOID
                vid = url.split("watch?v=")[1].split("&")[0]
                return f"https://www.youtube.com/embed/{vid}"
            if "youtu.be/" in url:                 # https://youtu.be/VIDEOID
                vid = url.split("youtu.be/")[1].split("?")[0]
                return f"https://www.youtube.com/embed/{vid}"
            if "/live/" in url:                    # https://www.youtube.com/live/VIDEOID
                vid = url.split("/live/")[1].split("?")[0]
                return f"https://www.youtube.com/embed/{vid}"
            if "/channel/" in url:                 # channel page → live embed
                channel_id = url.split("/channel/")[1].split("?")[0].strip("/")
                return f"https://www.youtube.com/embed/live_stream?channel={channel_id}"
            # Handles (@name) or other forms: can’t reliably embed → open button only
            return None

        return None

    entries = []
    parent_domain = request.host.split(":")[0]  # used by Twitch embed

    if os.path.exists(streamers_path):
        with open(streamers_path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        for item in raw:
            team_name = ""
            team_id = str(item.get("teamId") or "")
            if team_id and team_id in teams:
                team_name = teams[team_id].get("name", "")

            url = item.get("url", "")
            embed_url = build_embed_url(url, parent_domain)

            entries.append({
                "name": item.get("name", "Unknown"),
                "team": team_name or item.get("team", ""),
                "platform": (item.get("platform") or
                             ("twitch" if "twitch.tv" in url else "youtube" if "youtu" in url else "link")),
                "url": url,
                "embed_url": embed_url
            })

    return render_template("streamers.html",
                           league=league,
                           entries=entries,
                           twitch_parent=parent_domain)


import os

if __name__ == '__main__':
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)


