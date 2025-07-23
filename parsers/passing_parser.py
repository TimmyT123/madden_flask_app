import os
import json
from datetime import datetime

def parse_passing_stats(subpath, data, upload_folder):
    if "playerPassingStatInfoList" not in data:
        print("⚠️ No passing stats found")
        return None

    # Try to load league info for team name mapping
    league_path = os.path.join(upload_folder, "league.json")
    if os.path.exists(league_path):
        with open(league_path) as f:
            league_data = json.load(f)
        team_lookup = {team["teamId"]: team["displayName"] for team in league_data.get("leagueTeamInfoList", [])}
    else:
        team_lookup = {}

    parsed = []
    for player in data["playerPassingStatInfoList"]:
        team_id = player.get("teamId")
        parsed.append({
            "teamId": player.get("teamId"),
            "name": player.get("fullName"),
            "passYds": player.get("passYds", 0),
            "passComp": player.get("passComp", 0),
            "passAtt": player.get("passAtt", 0),
            "passTDs": player.get("passTDs", 0),
            "passINTs": player.get("passInts", 0),
            "passCompPct": player.get("passCompPct", 0.0),
            "passYdsPerGame": player.get("passYdsPerGame", 0.0),
            "passRating": player.get("passerRating", 0.0),
            "passYdsPerAtt": player.get("passYdsPerAtt", 0.0),
            "passLng": player.get("passLongest", 0),
            "passSacked": player.get("passSacks", 0),
            "season": player.get("seasonIndex"),
            "week": player.get("weekIndex"),
        })

    # Save timestamped version
    filename = f"parsed_{subpath.replace('/', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path = os.path.join(upload_folder, filename)
    with open(output_path, "w") as f:
        json.dump(parsed, f, indent=2)
    print(f"✅ Parsed passing stats saved to {output_path}")

    # Save shared version for website (/stats route)
    shared_path = os.path.join(upload_folder, "passing.json")
    with open(shared_path, "w") as f:
        json.dump({"playerPassingStatInfoList": parsed}, f, indent=2)
    print(f"🌐 Shared passing stats updated at {shared_path}")

    return output_path
