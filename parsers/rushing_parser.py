# parsers/rushing_parser.py

import json
import os

def parse_rushing_stats(league_id, data, output_folder):
    rushing_list = data.get("playerRushingStatInfoList", [])
    parsed = []

    for player in rushing_list:
        parsed.append({
            "fullName": player.get("fullName"),
            "teamId": player.get("teamId"),
            "rosterId": player.get("rosterId"),
            "rushAtt": player.get("rushAtt", 0),
            "rushYds": player.get("rushYds", 0),
            "rushTDs": player.get("rushTDs", 0),
            "rushLongest": player.get("rushLongest", 0),
            "rushFum": player.get("rushFum", 0),
            "rushBrokenTackles": player.get("rushBrokenTackles", 0),
            "rushYdsAfterContact": player.get("rushYdsAfterContact", 0),
            "rush20PlusYds": player.get("rush20PlusYds", 0),
            "rushYdsPerAtt": player.get("rushYdsPerAtt", 0),
            "rushYdsPerGame": player.get("rushYdsPerGame", 0),
            "scheduleId": player.get("scheduleId"),
            "seasonIndex": player.get("seasonIndex"),
            "weekIndex": player.get("weekIndex"),
            "statId": player.get("statId"),
        })

    parsed.sort(key=lambda x: x.get("rushYds", 0), reverse=True)

    output_path = os.path.join(output_folder, "parsed_rushing.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed rushing stats saved to {output_path}")
