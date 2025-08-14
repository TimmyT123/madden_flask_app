import requests
import json
import os
import re

# Use the /webhook base only; we'll append platform/league/endpoint per call
WEBHOOK_URL = "http://localhost:5000/webhook"
PLATFORM = "ps5"  # or "xbox" if that's your flow
DEFAULT_LEAGUE_ID = os.getenv("DEFAULT_LEAGUE_ID", "17287266")

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
        pattern = r"===== NEW WEBHOOK:.*?BODY:\n(.*?)(?=\n===== NEW WEBHOOK:|\Z)"
        matches = re.findall(pattern, content, flags=re.DOTALL)

        json_blocks = []
        for i, match in enumerate(matches):
            json_str = match.strip()
            try:
                json_blocks.append(json.loads(json_str))
            except json.JSONDecodeError as e:
                print(f"⚠️ Skipping malformed JSON block #{i+1}: {e}")
        return json_blocks
    except Exception as e:
        print(f"❌ Error reading {file_path}: {e}")
        return []

def endpoint_for_payload(d: dict) -> str:
    if "teamInfoList" in d or "leagueTeamInfoList" in d:
        return "league"
    if "rosterInfoList" in d:
        return "roster"
    if "playerPassingStatInfoList" in d:
        return "passing"
    if "playerReceivingStatInfoList" in d:
        return "receiving"
    if "playerRushingStatInfoList" in d:
        return "rushing"
    if "teamStandingInfoList" in d:
        return "standings"
    if "gameScheduleInfoList" in d:
        return "schedule"
    return "misc"

def extract_league_id(d: dict) -> str | None:
    return (
        d.get("leagueId")
        or d.get("leagueInfo", {}).get("leagueId")
        or d.get("franchiseInfo", {}).get("leagueId")
    )

def send_to_webhook(full_subpath, data):
    try:
        url = f"{WEBHOOK_URL}/{full_subpath}"
        response = requests.post(url, json=data)
        print(f"✅ POST {url} — {response.status_code}")
        if response.status_code != 200:
            print("⚠️ Response:", response.text)
    except Exception as e:
        print(f"❌ Error sending to webhook {full_subpath}: {e}")

def simulate_all():
    for file_path, _ in debug_files.items():
        json_blocks = extract_jsons_from_debug(file_path)
        if not json_blocks:
            print(f"⚠️ Skipped {file_path} (no data)")
            continue

        print(f"📦 Found {len(json_blocks)} webhook(s) in {file_path}")
        for i, data in enumerate(json_blocks, 1):
            endpoint = endpoint_for_payload(data)
            league_id = extract_league_id(data) or DEFAULT_LEAGUE_ID
            full_subpath = f"{PLATFORM}/{league_id}/{endpoint}"
            print(f"➡️ Sending {endpoint} webhook #{i} → {full_subpath}")
            send_to_webhook(full_subpath, data)

if __name__ == "__main__":
    simulate_all()
