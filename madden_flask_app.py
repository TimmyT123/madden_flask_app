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
    return render_template("index.html")


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

    # Extract what you need *now*, inside request context
    headers = dict(request.headers)
    body = request.data
    Thread(target=process_webhook_data, args=(data, subpath, headers, body)).start()
    return 'OK', 200


def process_webhook_data(data, subpath, headers, body):
    # ✅ 1. Overwrite the latest debug (just like before)
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # ✅ 2. Append full webhook output to a timestamped log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"webhook_debug_{timestamp}.txt"
    archive_path = os.path.join(app.config['UPLOAD_FOLDER'], archive_name)
    with open(archive_path, 'w') as f:
        f.write(f"TIMESTAMP: {timestamp}\nSUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # Save raw debug log
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # Check for Companion App error payload
    if 'error' in data:
        print(f"⚠️ Companion App Error: {data['error']}")
        error_filename = f"{subpath.replace('/', '_')}_error.json"
        with open(os.path.join(app.config['UPLOAD_FOLDER'], error_filename), 'w') as f:
            json.dump(data, f, indent=4)
        return

    # Determine correct file name based on content
    if "playerPassingStatInfoList" in data:
        filename = "passing.json"
    elif "playerReceivingStatInfoList" in data:
        filename = "receiving.json"
    elif "scheduleInfoList" in data:
        filename = "schedule.json"
    elif "rosterInfoList" in data:
        filename = "rosters.json"
    elif "teamInfoList" in data:
        filename = "league.json"
    else:
        filename = f"{subpath.replace('/', '_')}.json"

    output_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=4)

    print(f"✅ Data saved to {filename}")

    # Optional: parse known types
    if subpath.endswith("passing") and "playerPassingStatInfoList" in data:
        parse_passing_stats(subpath, data, app.config["UPLOAD_FOLDER"])
    elif "schedules" in subpath and "week" in subpath:
        parse_schedule_data(data, subpath, app.config["UPLOAD_FOLDER"])
    elif "rosters" in subpath:
        parse_rosters_data(data, subpath, app.config["UPLOAD_FOLDER"])
    elif "league" in subpath:
        parse_league_info_data(data, subpath, app.config["UPLOAD_FOLDER"])

    # ✅ Keep the in-memory record
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


@app.route('/stats')
def show_stats():
    try:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], 'passing.json')
        with open(filepath) as f:
            data = json.load(f)
            players = data.get("playerPassingStatInfoList", [])  # <-- FIXED
    except Exception as e:
        print(f"Error loading stats: {e}")
        players = []
    return render_template("stats.html", players=players)



import os

if __name__ == '__main__':
    # Only run this if NOT on Render
    if not os.environ.get("RENDER"):
        app.run(host='0.0.0.0', port=5000, debug=True)

