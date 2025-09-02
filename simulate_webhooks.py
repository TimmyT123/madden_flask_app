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
    os.path.join(UPLOAD_FOLDER, "webhook_debug_stats.txt"):  "stats",
    # add one of these (or both) based on your app’s classifier:
    os.path.join(UPLOAD_FOLDER, "webhook_debug_standings.txt"): "standings",
    # os.path.join(UPLOAD_FOLDER, "webhook_debug_misc.txt"): "standings",
}


def extract_jsons_from_debug(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        pattern = r"(?:={5}|-{5})\s*NEW WEBHOOK:.*?BODY:\n(.*?)(?=\n(?:={5}|-{5})\s*NEW WEBHOOK:|\Z)"
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
        response = requests.post(url, json=data, headers={"X-Replay": "1"})
        print(f"✅ POST {url} — {response.status_code}")
        if response.status_code != 200:
            print("⚠️ Response:", response.text)
    except Exception as e:
        print(f"❌ Error sending to webhook {full_subpath}: {e}")

def simulate_all():
    # 1) Snapshot all payloads up-front
    replay = []  # list of (endpoint, league_id, payload)
    for file_path, _ in debug_files.items():
        blocks = extract_jsons_from_debug(file_path)
        if not blocks:
            print(f"⚠️ Skipped {file_path} (no data)")
            continue
        for data in blocks:
            endpoint  = endpoint_for_payload(data)  # league/roster/passing/...
            league_id = extract_league_id(data) or DEFAULT_LEAGUE_ID
            replay.append((endpoint, league_id, data))

    if not replay:
        print("No payloads to replay.")
        return

    # 2) Replay from the snapshot (files can change now—no effect)
    print(f"📦 Replaying {len(replay)} payload(s)")
    for i, (endpoint, league_id, data) in enumerate(replay, 1):
        full_subpath = f"{PLATFORM}/{league_id}/{endpoint}"
        print(f"➡️ [{i}/{len(replay)}] {endpoint} → {full_subpath}")
        send_to_webhook(full_subpath, data)

if __name__ == "__main__":
    simulate_all()
