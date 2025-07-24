import os
import json

def parse_league_info_data(data, subpath, output_folder):
    print(f"📘 Parsing league info data from {subpath}")

    team_info = data.get("teamInfoList", [])
    if not team_info:
        print("⚠️ No teamInfoList found in data.")
        return

    team_map = {}

    for team in team_info:
        team_id = str(team.get("teamId"))
        team_map[team_id] = {
            "abbr": team.get("abbrName", ""),
            "name": team.get("displayName", ""),
            "user": team.get("userName", ""),
            "divisionName": team.get("divName", "Unknown Division")
        }

    # Figure out where to store it
    league_id = subpath.split('/')[1] if len(subpath.split('/')) > 1 else "unknown_league"
    league_root = os.path.join(output_folder, "..", "..")  # Climb up from season_X/week_X/
    team_map_path = os.path.abspath(os.path.join(league_root, "team_map.json"))

    os.makedirs(os.path.dirname(team_map_path), exist_ok=True)
    with open(team_map_path, "w") as f:
        json.dump(team_map, f, indent=4)

    print(f"✅ Saved cleaned team map to {team_map_path}")
