from flask import Flask, request, jsonify
from flask import send_from_directory

from datetime import datetime
import os
import json
import requests
from threading import Timer
from time import time

from config import UPLOAD_FOLDER

from parsers.schedule_parser import parse_schedule_data
from parsers.rosters_parser import parse_rosters_data
from parsers.league_parser import parse_league_info_data
from parsers.passing_parser import parse_passing_stats
from parsers.standings_parser import parse_standings_data


from flask import render_template

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

import re

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
                        weeks = [w for w in os.listdir(season_path) if os.path.isdir(os.path.join(season_path, w))]
                        seasons.append({'name': season, 'weeks': sorted(weeks)})

                        if re.match(r'^season_\d+$', season):
                            if not latest_season or season > latest_season:
                                latest_season = season
                                latest_week = sorted(weeks)[-1] if weeks else None
                                latest_league_id = league_id

                leagues.append({'id': league_id, 'seasons': seasons})

    # ✅ Use default_week.json if it exists
    if latest_league_id:
        season_from_default, week_from_default = get_default_season_week()
        latest_season = season_from_default
        latest_week = week_from_default

    # 💾 Save latest season/week to memory
    league_data["latest_season"] = latest_season
    league_data["latest_week"] = latest_week
    league_data["latest_league"] = latest_league_id

    return render_template(
        'index.html',
        leagues=leagues,
        latest_league=latest_league_id,
        latest_season=latest_season,
        latest_week=latest_week
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
                weeks.sort(reverse=True)
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

def process_webhook_data(data, subpath, headers, body):
    # ✅ 1. Save debug snapshot
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

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

    # ✅ 5. Determine storage path
    parts = subpath.split('/')
    league_id = parts[1] if len(parts) > 1 else "unknown_league"
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
                season_index = season_index or first.get("seasonIndex") or first.get("season")
                week_index = week_index or first.get("weekIndex") or first.get("week")
            break

    # Manually set season/week for league-wide files
    if "teamInfoList" in data:
        season_index = season_index or "0"
        week_index = week_index or "0"
    elif "rosterInfoList" in data:
        season_index = "global"
        week_index = "global"

    # Try to parse weekIndex from subpath (e.g., "week/reg/1")
    import re
    match = re.search(r'week/reg/(\d+)', subpath)
    if match:
        week_index = match.group(1)

    # Try to extract season/week from gameScheduleInfoList
    if "gameScheduleInfoList" in data and isinstance(data["gameScheduleInfoList"], list):
        for game in data["gameScheduleInfoList"]:
            if isinstance(game, dict):
                season_index = season_index or game.get("seasonIndex")
                week_index = week_index or game.get("weekIndex")
                break

    # If still not found, try teamStandingInfoList
    if "teamStandingInfoList" in data and isinstance(data["teamStandingInfoList"], list):
        for team in data["teamStandingInfoList"]:
            if isinstance(team, dict):
                season_index = season_index or team.get("seasonIndex")
                week_index = week_index or team.get("weekIndex")
                break

    # ✅ Only update if both values are valid integers
    if isinstance(season_index, int) and isinstance(week_index, int):
        print(f"📌 Auto-updating default_week.json: season_{season_index}, week_{week_index}")
        update_default_week(season_index, week_index)

    # Fallbacks
    season_index = season_index if season_index is not None else "unknown_season"
    week_index = week_index if week_index is not None else "unknown_week"

    # Global data override
    if "leagueteams" in subpath or "standings" in subpath:
        season_index = "global"
        week_index = "global"

    league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, f"season_{season_index}", f"week_{week_index}")
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
    league = request.args.get("league")
    season = request.args.get("season") or league_data.get("latest_season")
    week = request.args.get("week") or league_data.get("latest_week")

    if not league or not season or not week:
        return "Missing league, season, or week", 400

    try:
        # Build full path to passing.json
        base_path = os.path.join(app.config['UPLOAD_FOLDER'], league, f"season_{season}", f"week_{week}")
        filepath = os.path.join(base_path, "passing.json")

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            players = data.get("playerPassingStatInfoList", [])

        # Load team_map.json for team name lookups
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
        print(f"❌ Error loading stats: {e}")
        players = []

    return render_template("stats.html", players=players, season=season, week=week)



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


import glob

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

    return render_template("schedule.html", schedule=parsed_schedule)


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


import os

if __name__ == '__main__':
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)


