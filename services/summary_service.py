

import os
import json

from services.summary_helpers import (
    _load_json_safe_path,
    _safe_int,
    _pick_winner,
    _team_name,
    _tone_from_scores,
    _best_offense_player,
    _impact_defenders,
    post_summary_to_discord,
)

def generate_week_summaries_if_ready(league_id, season_dir, week_dir, upload_folder):
    """
    Generates one summary per completed game.
    Runs after defensive stats webhook (stats complete signal).
    """

    base_path = os.path.join(
        upload_folder,
        league_id,
        season_dir,
        week_dir
    )

    week_number = int(str(week_dir).replace("week_", ""))

    schedule_path = os.path.join(base_path, "parsed_schedule.json")
    passing_path  = os.path.join(base_path, "passing.json")
    rushing_path  = os.path.join(base_path, "parsed_rushing.json")
    defense_path  = os.path.join(base_path, "parsed_defense.json")

    passing_data = _load_json_safe_path(passing_path, {})
    passing_rows = passing_data.get("playerPassingStatInfoList", []) if isinstance(passing_data, dict) else (
                passing_data or [])

    rushing_data = _load_json_safe_path(rushing_path, {})
    rushing_rows = rushing_data.get("playerRushingStatInfoList", []) if isinstance(rushing_data, dict) else (
                rushing_data or [])

    defense_data = _load_json_safe_path(defense_path, {})
    defense_rows = defense_data.get("playerDefensiveStatInfoList", []) if isinstance(defense_data, dict) else (
                defense_data or [])

    if not os.path.exists(schedule_path):
        print("⚠️ No schedule found. Skipping summaries.")
        return

    # Load schedule
    with open(schedule_path, "r", encoding="utf-8") as f:
        schedule = json.load(f)

    # Load summaries file (if exists)
    summaries_path = os.path.join(base_path, "game_summaries.json")

    if os.path.exists(summaries_path):
        with open(summaries_path, "r", encoding="utf-8") as f:
            summaries_data = json.load(f)
    else:
        summaries_data = {"games": []}

    existing_ids = {g["gameId"] for g in summaries_data.get("games", [])}

    # Load team_map
    team_map_path = os.path.join(
        upload_folder,
        league_id,
        "team_map.json"
    )

    team_map = {}
    if os.path.exists(team_map_path):
        with open(team_map_path, "r", encoding="utf-8") as f:
            team_map = json.load(f)

    new_games_added = False

    for game in schedule:
        game_id = str(game.get("scheduleId") or game.get("gameId"))
        if not game_id:
            continue

        if game_id in existing_ids:
            continue

        home_id = str(game.get("homeTeamId"))
        away_id = str(game.get("awayTeamId"))
        home_score = _safe_int(game.get("homeScore"))
        away_score = _safe_int(game.get("awayScore"))

        # Skip incomplete games
        if home_score == 0 and away_score == 0:
            continue

        winner_id, loser_id = _pick_winner(home_id, away_id, home_score, away_score)

        home_name = _team_name(team_map, home_id)
        away_name = _team_name(team_map, away_id)

        if winner_id is None:
            # 🟡 TIE GAME
            headline = f"{home_name} and {away_name} tie {home_score}–{away_score}"
            narr = (
                f"In a hard-fought battle, {home_name} and {away_name} "
                f"finished deadlocked at {home_score}–{away_score}."
            )

            pog_blurb = None
            impact = []

        else:
            winner_name = _team_name(team_map, winner_id)
            loser_name = _team_name(team_map, loser_id)

            if winner_id == str(home_id):
                winner_score = home_score
                loser_score = away_score
            else:
                winner_score = away_score
                loser_score = home_score

            tone = _tone_from_scores(home_score, away_score)

            headline = f"{winner_name} defeat {loser_name} {winner_score}–{loser_score}"

            pog_row, pog_score, pog_blurb = _best_offense_player(
                winner_id, passing_rows, rushing_rows
            )

            impact = _impact_defenders(winner_id, defense_rows, top_n=3)

            narr = f"In {tone}, {winner_name} took down {loser_name} {winner_score}–{loser_score}."

            if pog_blurb:
                narr += f" Player of the Game: {pog_blurb}."
            if impact:
                narr += " Defensive impact: " + "; ".join(impact) + "."

        summary_obj = {
            "gameId": game_id,
            "homeTeamId": home_id,
            "awayTeamId": away_id,
            "homeScore": home_score,
            "awayScore": away_score,
            "headline": headline,
            "narrative": narr,
            "player_of_game": pog_blurb or None,
            "impact_defense": impact or []
        }

        summaries_data["games"].append(summary_obj)
        post_summary_to_discord(
            summary_obj,
            week_number,
            league_id,
            season_dir,
            week_dir
        )
        new_games_added = True

        print(f"📝 Generated summary for game {game_id}")

    # Write file only if new games added
    if new_games_added:
        with open(summaries_path, "w", encoding="utf-8") as f:
            json.dump(summaries_data, f, indent=2)
