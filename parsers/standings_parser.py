import json
import os

def parse_standings_data(data, subpath, league_folder):
    standings = []

    team_standings = data.get("teamStandingInfoList", [])
    if not team_standings:
        print("⚠️ No teamStandingInfoList found in data.")
        return

    # 🔍 Extract calendarYear from one of the entries if present
    calendar_year = next((entry.get("calendarYear") for entry in team_standings if entry.get("calendarYear")), "Unknown")
    print(f"🗓️ Detected calendarYear: {calendar_year}")

    try:
        for entry in team_standings:
            team_id = entry.get("teamId")
            cap_available = entry.get("capAvailable", 0)
            entry_year = entry.get("calendarYear")

            print(f"🔍 Entry for teamId {team_id}: calendarYear = {entry_year}")

            standings.append({
                "teamId": team_id,
                "wins": entry.get("totalWins"),
                "losses": entry.get("totalLosses"),
                "ties": entry.get("totalTies"),
                "pct": entry.get("winPct"),
                "pointsFor": entry.get("ptsFor", 0) * 2,
                "pointsAgainst": entry.get("ptsAgainst", 0) * 2,
                "rank": entry.get("rank"),
                "seed": entry.get("seed"),
                "streak": f"{entry.get('streakType', '')} {entry.get('winLossStreak', 0)}",
                "divWins": entry.get("divWins"),
                "divLosses": entry.get("divLosses"),
                "divTies": entry.get("divTies"),
                "confWins": entry.get("confWins"),
                "confLosses": entry.get("confLosses"),
                "confTies": entry.get("confTies"),
                "capAvailable": cap_available,
                "teamOvr": entry.get("teamOvr", 0),
                "calendarYear": entry_year
            })

        standings_path = os.path.join(league_folder, "parsed_standings.json")
        os.makedirs(os.path.dirname(standings_path), exist_ok=True)
        with open(standings_path, "w") as f:
            json.dump({
                "calendarYear": calendar_year,
                "standings": standings
            }, f, indent=2)

        print("✅ Standings parsed and saved to", standings_path)

    except Exception as e:
        print("❌ Error parsing standings:", e)
