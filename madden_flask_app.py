from flask import Flask, request, jsonify
import os
import json

print("🚀 Running Madden Flask App!")

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory store (for example) — use a DB in production!
league_data = {}

@app.route('/')
def home():
    return "Madden Franchise API is running!"

# 1️⃣ Upload endpoint
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return 'No selected file', 400

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    file.save(filepath)

    # Parse and load into memory
    with open(filepath) as f:
        data = json.load(f)
        league_data.clear()
        league_data.update(data)

    return 'File uploaded and data loaded', 200

# 2️⃣ Example: Get all teams
@app.route('/teams', methods=['GET'])
def get_teams():
    teams = league_data.get('teams', [])
    return jsonify(teams)

# 3️⃣ Example: Get single team
@app.route('/teams/<team_name>', methods=['GET'])
def get_team(team_name):
    for team in league_data.get('teams', []):
        if team['name'].lower() == team_name.lower():
            return jsonify(team)
    return jsonify({'message': 'Team not found'}), 404

# 4️⃣ Example: Get schedule
@app.route('/schedule', methods=['GET'])
def get_schedule():
    schedule = league_data.get('schedule', [])
    return jsonify(schedule)

# 🆕 Webhook endpoint for Companion App export
@app.route('/webhook', methods=['POST'])
def webhook():
    print("🔔 Webhook hit!")
    headers = dict(request.headers)
    body = request.data  # raw bytes

    print("Headers:", headers)
    print("Body:", body)

    # Save to a debug file
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    with open(debug_path, 'w') as f:
        f.write("HEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # Try to parse JSON normally
    data = request.get_json(silent=True)
    if not data:
        return 'Invalid JSON (but raw body saved)', 400

    league_data.clear()
    league_data.update(data)

    export_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_export.json')
    with open(export_path, 'w') as f:
        json.dump(data, f, indent=4)

    print("✅ League data received and saved to disk!")
    return 'League data received!', 200





# if __name__ == "__main__":
#     app.run(debug=True)
