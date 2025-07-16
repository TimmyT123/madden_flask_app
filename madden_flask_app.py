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
@app.route('/webhook', defaults={'subpath': ''}, methods=['POST'])
@app.route('/webhook/<path:subpath>', methods=['POST'])
def webhook(subpath):
    print(f"🔔 Webhook hit! Subpath: {subpath}")

    headers = dict(request.headers)
    body = request.data

    print("HEADERS:", headers)
    print("BODY:", body.decode('utf-8', errors='replace'))

    # Save raw body always
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    with open(debug_path, 'w') as f:
        f.write(f"SUBPATH: {subpath}\n\n")
        f.write("HEADERS:\n")
        for k, v in headers.items():
            f.write(f"{k}: {v}\n")
        f.write("\nBODY:\n")
        f.write(body.decode('utf-8', errors='replace'))

    # Parse JSON safely
    try:
        data = request.get_json(force=True)
    except Exception as e:
        print(f"❌ Failed to parse JSON: {e}")
        return 'Invalid JSON', 400

    # Check for Companion App error
    if 'error' in data:
        print(f"⚠️ Companion App Error: {data['error']}")
        # Save it too
        error_filename = f"{subpath.replace('/', '_')}_error.json"
        error_path = os.path.join(app.config['UPLOAD_FOLDER'], error_filename)
        with open(error_path, 'w') as f:
            json.dump(data, f, indent=4)
        return 'Error received', 200

    # If valid, save to separate file per subpath
    output_filename = f"{subpath.replace('/', '_')}.json"
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=4)

    print(f"✅ Valid data saved to {output_filename}")

    # Optionally load into in-memory store
    league_data[subpath] = data

    return 'OK', 200


@app.route('/debug', methods=['GET'])
def get_debug_file():
    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
    if not os.path.exists(debug_path):
        return "No debug file found yet!", 404

    with open(debug_path) as f:
        content = f.read()

    # Return as HTML <pre> for readability
    return f"<pre>{content}</pre>"





# if __name__ == "__main__":
#     app.run(debug=True)
