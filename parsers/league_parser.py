import os
import json

def parse_league_info_data(data, subpath, output_folder):
    print(f"📘 Parsing league info data from {subpath}")

    team_info = data.get("teamInfoList") or data.get("leagueTeamInfoList") or []
    if not team_info:
        print("⚠️ No teamInfoList found in data.")
        return

    # ✅ Try loading capAvailable and calendarYear from parsed_standings.json
    standings_lookup = {}
    calendar_year = data.get("calendarYear")

    # 🧭 Fallback: Try pulling calendarYear from a team entry
    if not calendar_year:
        print("🧐 Trying to extract calendarYear from a team entry...")
        for team in team_info:
            calendar_year = team.get("calendarYear")
            if calendar_year:
                print(f"✅ Found calendarYear in team: {calendar_year}")
                break

    # 📂 Fallback: Try loading from parsed_standings.json
    if not calendar_year:
        try:
            standings_path = os.path.join(output_folder, "..", "..", "season_global", "week_global",
                                          "parsed_standings.json")
            print(f"📂 Checking standings file: {standings_path}")
            if os.path.exists(standings_path):
                with open(standings_path) as sf:
                    standings_data = json.load(sf)

                    if isinstance(standings_data, dict):
                        calendar_year = standings_data.get("calendarYear")
                        if calendar_year:
                            print(f"🗓️ Found calendarYear in standings: {calendar_year}")
                        standings_list = standings_data.get("standings", [])
                    else:
                        standings_list = standings_data

                    for s in standings_list:
                        if isinstance(s, dict) and "teamId" in s:
                            standings_lookup[str(s["teamId"])] = s.get("capAvailable", 0)
        except Exception as e:
            print(f"⚠️ Couldn't enrich with standings capAvailable or calendarYear: {e}")

    # ❌ Final fallback
    if not calendar_year:
        calendar_year = "Unknown"
        print("❌ calendarYear is still missing; setting to 'Unknown'")

    team_map = {}
    league_info_list = []

    for team in team_info:
        team_id = str(team.get("teamId"))
        cap_available = standings_lookup.get(team_id, team.get("capAvailable", 0))

        team_data = {
            "abbr": team.get("abbrName", ""),
            "name": team.get("displayName", ""),
            "user": team.get("userName", ""),
            "divisionName": team.get("divName", "Unknown Division"),
            "teamOvr": team.get("ovrRating", 0),
            "capAvailable": cap_available,
        }

        team_map[team_id] = team_data
        league_info_list.append({
            "teamId": int(team_id),
            **team_data
        })

    # Save team_map.json (for mapping lookups)
    league_id = subpath.split('/')[1] if len(subpath.split('/')) > 1 else "unknown_league"
    league_root = os.path.join(output_folder, "..", "..")
    team_map_path = os.path.abspath(os.path.join(league_root, "team_map.json"))
    os.makedirs(os.path.dirname(team_map_path), exist_ok=True)
    with open(team_map_path, "w") as f:
        json.dump(team_map, f, indent=4)
    print(f"✅ Saved cleaned team map to {team_map_path}")

    # Save parsed_league_info.json (for /teams page)
    parsed_league_info_path = os.path.join(output_folder, "parsed_league_info.json")
    with open(parsed_league_info_path, "w") as f:
        json.dump({
            "calendarYear": calendar_year,
            "leagueTeamInfoList": league_info_list
        }, f, indent=2)
    print(f"✅ Saved parsed league info to {parsed_league_info_path}")
