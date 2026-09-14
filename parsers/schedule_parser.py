# schedule_parser_v2.py
# Version: 2.0
# Modified section: parse_schedule_data — preserve first webhook completion timestamp per game.

import os
import json
from datetime import datetime
from zoneinfo import ZoneInfo

ARIZONA_TZ = ZoneInfo("America/Phoenix")
COMPLETED_STATUSES = {2, 3}


def _game_key(game):
    """Stable key for matching the same game across schedule webhook updates."""
    schedule_id = game.get("scheduleId")
    if schedule_id not in (None, ""):
        return ("scheduleId", str(schedule_id))

    return (
        "matchup",
        str(game.get("seasonIndex") if "seasonIndex" in game else game.get("season")),
        str(game.get("weekIndex") if "weekIndex" in game else game.get("week")),
        str(game.get("awayTeamId")),
        str(game.get("homeTeamId")),
    )


def _load_existing_schedule(filename):
    if not os.path.exists(filename):
        return {}

    try:
        with open(filename, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(rows, list):
        return {}

    return {_game_key(game): game for game in rows if isinstance(game, dict)}


def parse_schedule_data(data, subpath, upload_folder, webhook_received_at=None):
    """
    Parse Madden schedule data and preserve the FIRST time a game is observed
    changing from not played (status 1) to completed (status 2/3).

    Historical games that were already completed before this feature existed
    are intentionally left without completedAt rather than assigning a false
    timestamp on the first webhook after deployment.
    """
    filename = os.path.join(upload_folder, "parsed_schedule.json")
    existing_by_game = _load_existing_schedule(filename)

    if webhook_received_at is None:
        webhook_received_at = datetime.now(ARIZONA_TZ).isoformat(timespec="seconds")

    parsed = []

    for game in data.get("gameScheduleInfoList", []):
        if not isinstance(game, dict):
            continue

        previous = existing_by_game.get(_game_key(game))
        previous_status = previous.get("status") if isinstance(previous, dict) else None
        completed_at = previous.get("completedAt") if isinstance(previous, dict) else None
        new_status = game.get("status")

        # Record the timestamp once, at the first observed completion transition.
        # - Existing completed games with no timestamp remain blank.
        # - A normal status 1 -> 2/3 transition gets stamped.
        # - If the first-ever observation of a game is already completed, stamp it
        #   because this webhook is our first known completion observation.
        if not completed_at and new_status in COMPLETED_STATUSES:
            if previous is None or previous_status == 1:
                completed_at = webhook_received_at

        parsed.append({
            "week": game.get("weekIndex"),
            "season": game.get("seasonIndex"),
            "scheduleId": game.get("scheduleId"),
            "homeTeamId": game.get("homeTeamId"),
            "awayTeamId": game.get("awayTeamId"),
            "homeScore": game.get("homeScore"),
            "awayScore": game.get("awayScore"),
            "status": new_status,
            "completedAt": completed_at,
            "gameOfTheWeek": game.get("isGameOfTheWeek"),
        })

    with open(filename, "w", encoding="utf-8") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed schedule data saved to {filename}")
