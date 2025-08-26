from flask import Flask, request, jsonify
from flask import send_from_directory

from datetime import datetime
import os
import json
import requests
from threading import Timer
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

from dotenv import load_dotenv
load_dotenv()


print("🚀 Running Madden Flask App!")

DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1395202722227290213/fbpHTWl3nwq0XxD-AKriIJSUdBhgqGhGoGxBScUQLBK2d_SxSlIHsCRAj6A3g55kz0aD"

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

league_data = {}

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

    return render_template(
        'index.html',
        leagues=leagues,
        latest_league=latest_league_id,
        latest_season=latest_season,
        latest_week=latest_week,
        latest_week_display=latest_week_display  # ✅ pass this to template
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

    # ✅ 5. Determine storage path (league id)
    league_id = resolve_league_id(data, subpath)
    if not league_id:
        app.logger.error("No league_id found for webhook; skipping write.")
        return  # Do not silently default, fail fast so you see the issue

    # Keep a useful cache for later requests/routes
    league_data["latest_league"] = league_id
    league_data["league_id"] = league_id

    print(f"📎 Using league_id: {league_id}")

    # 1️⃣ Determine batch type
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

    # 🧠 Skip misc/other batches
    if batch_type not in ["league", "stats", "roster"]:
        # Write immediately for other types
        with open(debug_path, 'a') as f:
            f.write(f"\n===== NEW WEBHOOK: {subpath} =====\n")
            f.write("HEADERS:\n")
            for k, v in headers.items():
                f.write(f"{k}: {v}\n")
            f.write("\nBODY:\n")
            f.write(body.decode('utf-8', errors='replace'))
            f.write("\n\n")
    else:
        # Store current time
        last_webhook_time[batch_type] = time()

        # Buffer the data
        webhook_buffer[batch_type].append({
            "subpath": subpath,
            "headers": headers,
            "body": body.decode('utf-8', errors='replace')
        })

        # Cancel any existing flush timer
        if batch_type in batch_timers and batch_timers[batch_type]:
            batch_timers[batch_type].cancel()

        # Set new flush timer
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

        # Start or restart timer
        batch_timers[batch_type] = Timer(5.0, flush_batch)
        batch_timers[batch_type].start()

    # ✅ 3. Check for Companion App error
    if 'error' in data:
        print(f"⚠️ Companion App Error: {data['error']}")
        error_filename = f"{subpath.replace('/', '_')}_error.json"
        with open(os.path.join(app.config['UPLOAD_FOLDER'], error_filename), 'w') as f:
            json.dump(data, f, indent=4)
        return

    # ✅ 4. Determine filename
    if "playerPassingStatInfoList" in data:
        filename = "passing.json"
    elif "playerReceivingStatInfoList" in data:
        filename = "receiving.json"
    elif "gameScheduleInfoList" in data:
        filename = "schedule.json"
    elif "rosterInfoList" in data:
        filename = "rosters.json"
        print("📥 Roster data received and saved!")
    elif "teamInfoList" in data or "leagueTeamInfoList" in data:
        filename = "league.json"
        print("🏈 League Info received and saved!")

        # Normalize key
        if "leagueTeamInfoList" in data and "teamInfoList" not in data:
            data["teamInfoList"] = data["leagueTeamInfoList"]

        if "teamInfoList" in data:
            league_data["teams"] = data["teamInfoList"]

    elif "teamStandingInfoList" in data:
        filename = "standings.json"
        print("📊 Standings data received and saved!")

        # Don't touch league_data here — standings data doesn't contain team info

    else:
        filename = f"{subpath.replace('/', '_')}.json"

    season_index = data.get("seasonIndex") or data.get("season")
    week_index = data.get("weekIndex") or data.get("week")

    # Prefer extracting from stat blocks (schedule first)
    stat_lists = [
        "gameScheduleInfoList",  # ✅ Highest priority
        "playerPassingStatInfoList",
        "playerReceivingStatInfoList",
        "playerRushingStatInfoList",
        "playerKickingStatInfoList",
        "playerPuntingStatInfoList",
        "playerDefensiveStatInfoList",
        "teamStatInfoList"
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

    # Manually set season/week for league-wide files  ➜ never touch default week
    if "teamInfoList" in data or "leagueTeamInfoList" in data:
        season_index = "global"
        week_index = "global"
    elif "rosterInfoList" in data:
        season_index = "global"
        week_index = "global"

    # Try to parse weekIndex from subpath (e.g., "week/reg/1")
    phase = None
    week_from_path = None

    m = re.search(r'week/(reg|post|pre)/(\d+)', subpath or "")
    if m:
        phase = m.group(1)  # "reg" | "post" | "pre"
        week_from_path = int(m.group(2))

    # Try to extract season/week from gameScheduleInfoList
    if "gameScheduleInfoList" in data and isinstance(data["gameScheduleInfoList"], list):
        for game in data["gameScheduleInfoList"]:
            if isinstance(game, dict):
                season_index = season_index or game.get("seasonIndex")
                week_index = week_index or game.get("weekIndex")
                break

    # If still not found, try teamStandingInfoList
    if "teamStandingInfoList" in data and isinstance(data["teamStandingInfoList"], list):
        for t in data["teamStandingInfoList"]:
            if isinstance(t, dict):
                season_index = season_index or t.get("seasonIndex")
                week_index = week_index or t.get("weekIndex")
                break

    # Helper
    def to_int_or_none(v):
        try:
            return int(v)
        except Exception:
            return None

    # Normalize season/week from payload
    season_index_int = to_int_or_none(season_index)

    # Prefer week from URL path (reg/post/pre), else payload
    week_index_int_payload = to_int_or_none(week_index)
    week_index_int_path = to_int_or_none(week_from_path)
    raw_week_for_display = week_index_int_path if week_index_int_path is not None else week_index_int_payload

    # Map post rounds to 19..22
    display_week = compute_display_week(phase, raw_week_for_display)

    # Global data override (don’t create season/week folders for these)
    if "leagueteams" in subpath or "standings" in subpath:
        season_dir = "season_global"
        week_dir = "week_global"
    else:
        # Require a valid season index before creating folders or updating defaults
        if season_index_int is None:
            # We can't safely determine the season; skip default-week update and avoid season_0
            print("⚠️ No valid season_index; skipping default_week update.")
            return  # or, if you prefer, just set season_dir/ week_dir and continue writing file-free data
        season_dir = f"season_{season_index_int}"

        effective_week = display_week if display_week is not None else (
            week_index_int_payload if week_index_int_payload is not None else None
        )
        if effective_week is None:
            print("⚠️ No valid week; skipping default_week update.")
            return

        week_dir = f"week_{effective_week}"

        # Safe update now that we have real ints
        print(f"📌 Auto-updating default_week.json: season_{season_index_int}, week_{effective_week}")
        update_default_week(season_index_int, effective_week)

    league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, season_dir, week_dir)
    os.makedirs(league_folder, exist_ok=True)

    if filename == "league.json":
        parse_league_info_data(data, subpath, league_folder)

    output_path = os.path.join(league_folder, filename)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=4)

    # Only store flat files in root for global data
    if season_index == "global" and week_index == "global":
        latest_path = os.path.join(app.config['UPLOAD_FOLDER'], league_id, filename)
        with open(latest_path, 'w') as f:
            json.dump(data, f, indent=4)

    print(f"✅ Data saved to {output_path}")

    # ✅ 6. Parse based on data type
    if "playerPassingStatInfoList" in data:
        parse_passing_stats(league_id, data, league_folder)
    elif "gameScheduleInfoList" in data:
        parse_schedule_data(data, subpath, league_folder)
    elif "rosterInfoList" in data:
        parse_rosters_data(data, subpath, league_folder)
    elif "teamInfoList" in data:
        parse_league_info_data(data, subpath, league_folder)
    elif "teamStandingInfoList" in data:
        parse_standings_data(data, subpath, league_folder)
    elif "playerRushingStatInfoList" in data:
        from parsers.rushing_parser import parse_rushing_stats
        print(f"🐛 DEBUG: Detected rushing stats for season={season_index}, week={week_index}")
        parse_rushing_stats(league_id, data, league_folder)

    # ✅ 7. Save in-memory reference
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
            with open(schedule_path) as f:
                try:
                    parsed_schedule = json.load(f)
                except json.JSONDecodeError:
                    print("❌ Failed to parse JSON in schedule file.")

    # Load team_map.json
    team_map_path = os.path.join(app.config['UPLOAD_FOLDER'], league_id, "team_map.json")
    team_map = {}
    if os.path.exists(team_map_path):
        with open(team_map_path) as f:
            team_map = json.load(f)

    for game in parsed_schedule:
        game["homeName"] = team_map.get(str(game["homeTeamId"]), {}).get("name", str(game["homeTeamId"]))
        game["awayName"] = team_map.get(str(game["awayTeamId"]), {}).get("name", str(game["awayTeamId"]))

    # ✅ Compute BYE teams once (and hide in playoffs)
    bye_teams = []
    try:
        week_num = int(str(week).replace("week_", ""))
        if week_num <= 18:
            all_team_ids = set(team_map.keys())
            teams_played = {str(g["homeTeamId"]) for g in parsed_schedule} | {str(g["awayTeamId"]) for g in
                                                                              parsed_schedule}
            bye_team_ids = all_team_ids - teams_played
            bye_teams = sorted([team_map[tid]["name"] for tid in bye_team_ids])
    except ValueError:
        print(f"⚠️ Could not parse week value: {week}")

    return render_template("schedule.html", schedule=parsed_schedule, season=season, week=week, bye_teams=bye_teams)


from collections import defaultdict

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


