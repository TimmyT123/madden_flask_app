import json
import os
from datetime import datetime
from flask import current_app as app

def parse_passing_stats(data, subpath):
    parsed = []

    for player in data.get("playerPassingStatInfoList", []):
        parsed.append({
            "name": player.get("fullName"),
            "teamId": player.get("teamId"),
            "yards": player.get("passYds"),
            "tds": player.get("passTDs"),
            "ints": player.get("passInts"),
            "rating": player.get("passerRating"),
        })

    # Sort by yards
    parsed.sort(key=lambda x: x["yards"], reverse=True)

    filename = os.path.join(app.config['UPLOAD_FOLDER'], f"parsed_{subpath.replace('/', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(filename, "w") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed passing stats saved to {filename}")
