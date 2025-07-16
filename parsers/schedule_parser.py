import json
import os
from datetime import datetime
from flask import current_app as app

def parse_schedule_data(data, subpath):
    parsed = []
    for game in data.get("gameScheduleInfoList", []):
        parsed.append({
            "week": game.get("weekIndex"),
            "season": game.get("seasonIndex"),
            "scheduleId": game.get("scheduleId"),
            "homeTeamId": game.get("homeTeamId"),
            "awayTeamId": game.get("awayTeamId"),
            "homeScore": game.get("homeScore"),
            "awayScore": game.get("awayScore"),
            "status": game.get("status"),
            "gameOfTheWeek": game.get("isGameOfTheWeek"),
        })

    filename = os.path.join(app.config['UPLOAD_FOLDER'], f"parsed_{subpath.replace('/', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(filename, "w") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed schedule data saved to {filename}")
