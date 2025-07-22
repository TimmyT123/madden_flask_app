from flask import Flask, request, jsonify
from flask import send_from_directory

from datetime import datetime
import os
import json
import requests
from threading import Thread

from config import UPLOAD_FOLDER

from parsers.schedule_parser import parse_schedule_data
from parsers.rosters_parser import parse_rosters_data
from parsers.league_parser import parse_league_info_data
from parsers.passing_parser import parse_passing_stats

from flask import render_template

print("🚀 Running Madden Flask App!")

DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1395202722227290213/fbpHTWl3nwq0XxD-AKriIJSUdBhgqGhGoGxBScUQLBK2d_SxSlIHsCRAj6A3g55kz0aD"

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

league_data = {}

@app.route('/')
def home():
    uploads_dir = app.config['UPLOAD_FOLDER']
    leagues = []

    if os.path.exists(uploads_dir):
        for league_id in os.listdir(uploads_dir):
            league_path = os.path.join(uploads_dir, league_id)
            if os.path.isdir(league_path):
                league = {"id": league_id, "seasons": []}

                for season_name in os.listdir(league_path):
                    season_path = os.path.join(league_path, season_name)
                    if os.path.isdir(season_path):
                        season = {"name": season_name, "weeks": []}

                        for week_name in os.listdir(season_path):
                            week_path = os.path.join(season_path, week_name)
                            if os.path.isdir(week_path):
                                season["weeks"].append(week_name)

                        league["seasons"].append(season)

                leagues.append(league)

    return render_template("index.html", leagues=leagues)

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


@app.route('/teams', methods=['GET'])
def get_teams():
    return jsonify(league_data.get('teams', []))


@app.route('/teams/<team_name>', methods=['GET'])
def get_team(team_name):
    for team in league_data.get('teams', []):
        if team['name'].lower() == team_name.lower():
            return jsonify(team)
    return jsonify({'message': 'Team not found'}), 404


@app.route('/schedule', methods=['GET'])
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


def process_webhook_data(data, subpath, headers, body):
    # ✅ 1. Save debug snapshot
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # ✅ 2. Save timestamped archive
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"webhook_debug_{timestamp}.txt"
    archive_path = os.path.join(app.config['UPLOAD_FOLDER'], archive_name)
    with open(archive_path, 'w') as f:
        f.write(f"TIMESTAMP: {timestamp}\nSUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

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
    elif "scheduleInfoList" in data:
        filename = "schedule.json"
    elif "rosterInfoList" in data:
        filename = "rosters.json"
        print("📥 Roster data received and saved!")
    elif "teamInfoList" in data:
        filename = "league.json"
        print("🏈 League Info received and saved!")
    else:
        filename = f"{subpath.replace('/', '_')}.json"

    # ✅ 5. Determine storage path
    parts = subpath.split('/')
    league_id = parts[1] if len(parts) > 1 else "unknown_league"
    season_index = data.get("seasonIndex") or data.get("season")
    week_index = data.get("weekIndex") or data.get("week")

    # Prefer extracting from stat blocks (schedule first)
    stat_lists = [
        "scheduleInfoList",  # ✅ Highest priority
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
        season_index = season_index or "0"
        week_index = week_index or "0"

    # Try to parse weekIndex from subpath (e.g., "week/reg/1")
    import re
    match = re.search(r'week/reg/(\d+)', subpath)
    if match:
        week_index = match.group(1)

    # Fallbacks
    season_index = season_index if season_index is not None else "unknown_season"
    week_index = week_index if week_index is not None else "unknown_week"

    # Global data override
    if "leagueteams" in subpath or "standings" in subpath:
        season_index = "global"
        week_index = "global"

    league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, f"season_{season_index}", f"week_{week_index}")
    os.makedirs(league_folder, exist_ok=True)

    output_path = os.path.join(league_folder, filename)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=4)

    # Optional latest version copy in league root
    latest_path = os.path.join(app.config['UPLOAD_FOLDER'], league_id, filename)
    with open(latest_path, 'w') as f:
        json.dump(data, f, indent=4)

    print(f"✅ Data saved to {output_path}")

    # ✅ 6. Parse based on data type
    if "playerPassingStatInfoList" in data:
        parse_passing_stats(league_id, data, league_folder)
    elif "scheduleInfoList" in data:
        parse_schedule_data(data, subpath, league_folder)
    elif "rosterInfoList" in data:
        parse_rosters_data(data, subpath, league_folder)
    elif "teamInfoList" in data:
        parse_league_info_data(data, subpath, league_folder)

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


@app.route('/')
def index():
    base_path = app.config['UPLOAD_FOLDER']
    leagues = []

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
                leagues.append({'id': league_id, 'seasons': seasons})

    return render_template('index.html', leagues=leagues)


@app.route('/stats')
def show_stats():
    league = request.args.get("league")
    season = request.args.get("season")
    week = request.args.get("week")

    if not league or not season or not week:
        return "Missing league, season, or week", 400

    try:
        # Dynamic path based on user input
        base_path = os.path.join(app.config['UPLOAD_FOLDER'], league, f"season_{season}", f"week_{week}")
        filepath = os.path.join(base_path, "passing.json")

        with open(filepath) as f:
            data = json.load(f)
            players = data.get("playerPassingStatInfoList", [])

        # Load team info
        league_info_path = os.path.join(app.config['UPLOAD_FOLDER'], league, "league.json")
        teams = {}
        if os.path.exists(league_info_path):
            with open(league_info_path) as f:
                league_data_file = json.load(f)
                teams = {team["teamId"]: team["abbrName"] for team in league_data_file.get("teamInfoList", [])}

        for p in players:
            p["teamName"] = teams.get(p.get("teamId"), "Unknown")

    except Exception as e:
        print(f"Error loading stats: {e}")
        players = []

    return render_template("stats.html", players=players)


import os

if __name__ == '__main__':
    # Only run this if NOT on Render
    if not os.environ.get("RENDER"):
        app.run(host='0.0.0.0', port=5000, debug=True)

