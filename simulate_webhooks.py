import requests
import json
import os

WEBHOOK_URL = "http://localhost:5000/webhook"

UPLOAD_FOLDER = "uploads"

debug_files = {
    os.path.join(UPLOAD_FOLDER, "webhook_debug_league.txt"): "league",
    os.path.join(UPLOAD_FOLDER, "webhook_debug_roster.txt"): "roster",
    os.path.join(UPLOAD_FOLDER, "webhook_debug_stats.txt"): "stats"
}

def extract_jsons_from_debug(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        chunks = content.split("===== NEW WEBHOOK:")
        json_blocks = []

        for chunk in chunks:
            body_start = chunk.find("BODY:\n")
            if body_start != -1:
                json_str = chunk[body_start + len("BODY:\n"):].strip()
                try:
                    json_data = json.loads(json_str)
                    json_blocks.append(json_data)
                except json.JSONDecodeError as e:
                    print(f"⚠️ Skipping malformed JSON block: {e}")

        return json_blocks
    except Exception as e:
        print(f"❌ Error reading {file_path}: {e}")
        return []


def send_to_webhook(subpath, data):
    try:
        response = requests.post(f"{WEBHOOK_URL}/{subpath}", json=data)
        print(f"✅ Sent {subpath} — Status: {response.status_code}")
        if response.status_code != 200:
            print("⚠️ Response:", response.text)
    except Exception as e:
        print(f"❌ Error sending to webhook {subpath}: {e}")

def simulate_all():
    for file_path, subpath in debug_files.items():
        json_blocks = extract_jsons_from_debug(file_path)
        if json_blocks:
            print(f"📦 Found {len(json_blocks)} webhook(s) in {file_path}")
            for i, data in enumerate(json_blocks):
                print(f"➡️ Sending {subpath} webhook #{i+1}")
                send_to_webhook(subpath, data)
        else:
            print(f"⚠️ Skipped {file_path} (no data)")


if __name__ == "__main__":
    simulate_all()
