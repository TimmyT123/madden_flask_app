# parsers/rushing_parser.py

import json
# rushing_parser.py

import json
import os

def parse_rushing_stats(data, output_path):
    """
    Parses player rushing statistics and saves them as a JSON file.

    :param data: The full JSON data containing 'playerRushingStatInfoList'
    :param output_path: Full path where the parsed_rushing.json will be saved
    """
    rushing_stats = data.get("playerRushingStatInfoList", [])

    # Ensure the directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Save parsed rushing stats
    with open(output_path, "w") as f:
        json.dump(rushing_stats, f, indent=2)

    print(f"✅ Parsed rushing stats saved to {output_path}")
