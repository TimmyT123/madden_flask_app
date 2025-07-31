import json
import os

def parse_receiving_stats(stats_path, output_path):
    if not os.path.exists(stats_path):
        print(f"File not found: {stats_path}")
        return

    with open(stats_path, "r") as f:
        data = json.load(f)

    receiving_stats = data.get("playerReceivingStatInfoList", [])

    parsed = []
    for player in receiving_stats:
        parsed.append({
            "playerName": player.get("fullName"),
            "teamId": player.get("teamId"),
            "receptions": player.get("recCatches", 0),
            "yards": player.get("recYds", 0),
            "touchdowns": player.get("recTDs", 0),
            "drops": player.get("recDrops", 0),
            "longest": player.get("recLongest", 0),
            "yardsAfterCatch": player.get("recYdsAfterCatch", 0),
            "yardsPerCatch": player.get("recYdsPerCatch", 0.0),
            "yardsPerGame": player.get("recYdsPerGame", 0.0),
            "catchPercentage": player.get("recCatchPct", 0.0),
        })

    with open(output_path, "w") as f:
        json.dump(parsed, f, indent=2)

    print(f"✅ Parsed {len(parsed)} receiving stats to {output_path}")
