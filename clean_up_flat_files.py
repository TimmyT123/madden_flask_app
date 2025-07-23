import os

LEAGUE_ID = "17287266"
UPLOADS_FOLDER = "uploads"
league_root = os.path.join(UPLOADS_FOLDER, LEAGUE_ID)

# Files we want to keep (because they belong in the root)
whitelist = {"league.json", "ps5_17287266_league_ps5_17287266_standings.json", "team_map.json"}

for filename in os.listdir(league_root):
    full_path = os.path.join(league_root, filename)

    if os.path.isfile(full_path) and filename.endswith(".json") and filename not in whitelist:
        print(f"🗑️ Deleting: {filename}")
        os.remove(full_path)
