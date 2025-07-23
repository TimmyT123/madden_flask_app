import json
import os

def parse_standings_data(data, subpath, league_folder):

    standings = []

    try:
        team_standings = data.get("teamStandingInfoList", [])

        for entry in team_standings:
            team_id = entry.get("teamId")

            standings.append({
                "teamId": team_id,
                "wins": entry.get("totalWins"),
                "losses": entry.get("totalLosses"),
                "ties": entry.get("totalTies"),
                "pct": entry.get("winPct"),
                "pointsFor": entry.get("ptsForRank"),
                "pointsAgainst": entry.get("ptsAgainstRank"),
                "streak": f"{entry.get('streakType', '')} {entry.get('winLossStreak', 0)}",
                "divWins": entry.get("divWins"),
                "divLosses": entry.get("divLosses"),
                "divTies": entry.get("divTies"),
                "confWins": entry.get("confWins"),
                "confLosses": entry.get("confLosses"),
                "confTies": entry.get("confTies")
            })

        standings_path = os.path.join(league_folder, "parsed_standings.json")
        os.makedirs(os.path.dirname(standings_path), exist_ok=True)
        with open(standings_path, "w") as f:
            json.dump(standings, f, indent=2)

        print("✅ Standings parsed and saved to", standings_path)

    except Exception as e:
        print("❌ Error parsing standings:", e)
