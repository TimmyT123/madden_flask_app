# parsers/rosters_parser.py
import json, os
from collections import Counter

def parse_rosters_data(data: dict, subpath: str, output_folder: str) -> None:
    """
    Merge the incoming team roster into a league-wide aggregate:
      uploads/<league>/season_global/week_global/parsed_rosters.json

    We keep the RAW player dicts so the Flask app can normalize/map fields
    however it wants (and you can add columns later without re-parsing).
    """
    try:
        os.makedirs(output_folder, exist_ok=True)
        out_path = os.path.join(output_folder, "parsed_rosters.json")

        # ---- load existing aggregate (tolerate dict/list/empty)
        agg_players = []
        if os.path.exists(out_path):
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    old = json.load(f)
                    if isinstance(old, list):
                        agg_players = old
                    elif isinstance(old, dict):
                        agg_players = (old.get("players")
                                       or old.get("rosterInfoList")
                                       or old.get("items")
                                       or [])
            except Exception:
                pass

        # ---- incoming players from this webhook
        incoming = []
        if isinstance(data, dict):
            if isinstance(data.get("rosterInfoList"), list):
                incoming = data["rosterInfoList"]
            elif isinstance(data.get("players"), list):  # future-proof
                incoming = data["players"]

        if not incoming:
            print("ℹ️ parse_rosters_data: no players in webhook – nothing to merge.")
            return

        # ---- drop any existing entries for the teams in this batch
        team_ids_in = {str(p.get("teamId")) for p in incoming if "teamId" in p}
        if team_ids_in:
            agg_players = [p for p in agg_players if str(p.get("teamId")) not in team_ids_in]

        # ---- merge with de-dupe (prefer rosterId, else a stable fallback)
        def k(p):
            rid = p.get("rosterId") or p.get("id")
            if rid is not None:
                return ("RID", str(rid))
            return ("FALLBACK",
                    str(p.get("teamId")),
                    p.get("firstName",""),
                    p.get("lastName",""),
                    str(p.get("jerseyNum","")),
                    p.get("position",""))

        index = {k(p): i for i, p in enumerate(agg_players)}
        for p in incoming:
            key = k(p)
            if key in index:
                agg_players[index[key]] = p
            else:
                index[key] = len(agg_players)
                agg_players.append(p)

        # ---- optional: sort a bit for readability (won’t affect filtering later)
        def safe_int(x, d=0):
            try: return int(x)
            except: return d
        agg_players.sort(
            key=lambda p: (
                safe_int(p.get("playerBestOvr") or p.get("overallRating") or p.get("ovr"), 0),
                safe_int(p.get("speedRating") or p.get("spd"), 0)
            ),
            reverse=True
        )

        # ---- write atomically with a small meta block
        payload = {
            "players": agg_players,
            "meta": {
                "count": len(agg_players),
                "teams": len([t for t in Counter(str(p.get("teamId")) for p in agg_players) if t and t != "None"])
            }
        }
        tmp = out_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

        # Only replace if tmp was actually written
        if os.path.exists(tmp):
            os.replace(tmp, out_path)

        print(f"✅ parsed_rosters.json updated → {out_path} "
              f"(players={payload['meta']['count']}, teams={payload['meta']['teams']})")

        # ---- (nice-to-have) keep a per-team snapshot of this batch for debugging
        try:
            if team_ids_in:
                by_team_dir = os.path.join(output_folder, "rosters_by_team")
                os.makedirs(by_team_dir, exist_ok=True)
                for tid in sorted(team_ids_in):
                    team_players = [p for p in incoming if str(p.get("teamId")) == tid]
                    if team_players:
                        with open(os.path.join(by_team_dir, f"{tid}.json"), "w", encoding="utf-8") as tf:
                            json.dump(team_players, tf, indent=2)
        except Exception:
            # non-fatal
            pass

    except Exception as e:
        print(f"❌ parse_rosters_data failed: {e}")

def rebuild_parsed_rosters(output_folder: str) -> None:
    """
    Rebuild parsed_rosters.json ONLY from rosters_by_team/*.json
    This avoids partial merges and guarantees all teams are included.
    """
    by_team_dir = os.path.join(output_folder, "rosters_by_team")
    if not os.path.isdir(by_team_dir):
        print("❌ rebuild_parsed_rosters: rosters_by_team folder not found")
        return

    all_players = []

    for fname in sorted(os.listdir(by_team_dir)):
        if not fname.endswith(".json"):
            continue

        path = os.path.join(by_team_dir, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

                if isinstance(data, list):
                    players = data
                elif isinstance(data, dict):
                    players = data.get("rosterInfoList", []) or data.get("players", [])
                else:
                    players = []

                all_players.extend(players)

        except Exception as e:
            print(f"⚠️ Failed reading {fname}: {e}")

    out_path = os.path.join(output_folder, "parsed_rosters.json")
    payload = {
        "players": all_players,
        "meta": {
            "count": len(all_players),
            "teams": len([f for f in os.listdir(by_team_dir) if f.endswith('.json')])
        }
    }

    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    os.replace(tmp, out_path)

    print(
        f"✅ REBUILT parsed_rosters.json "
        f"(players={payload['meta']['count']}, teams={payload['meta']['teams']})"
    )

