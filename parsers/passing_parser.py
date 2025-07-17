import json
from datetime import datetime
import os

def parse_passing_stats(subpath, data, upload_folder):
    if "playerPassingStatInfoList" not in data:
        print("⚠️ No passing stats found")
        return None

    parsed = []
    for player in data["playerPassingStatInfoList"]:
        parsed.append({
            "name": player.get("fullName"),
            "teamId": player.get("teamId"),
            "week": player.get("weekIndex"),
            "season": player.get("seasonIndex"),
            "passYds": player.get("passYds"),
            "passTDs": player.get("passTDs"),
            "passInts": player.get("passInts"),
            "passCompPct": player.get("passCompPct"),
            "passerRating": player.get("passerRating"),
        })

    filename = f"parsed_{subpath.replace('/', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    output_path = os.path.join(upload_folder, filename)

    with open(output_path, "w") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed passing stats saved to {output_path}")
    return output_path
