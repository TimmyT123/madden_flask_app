#  python discord_members_output.py --nicknames
#  python discord_members_output.py --usernames
#  python discord_members_output.py --id 960385056776527955
#  python discord_members_output.py -f /mnt/data/discord_members.json --nicknames
#!/usr/bin/env python3
import json
import argparse
import sys
from pathlib import Path

def load_members(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: JSON file not found at {path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse JSON ({e})", file=sys.stderr)
        sys.exit(1)

def print_only(members: dict, field: str):
    for _id, info in members.items():
        val = info.get(field, "")
        if val is None:
            val = ""
        print(val)

def print_by_id(members: dict, member_id: str):
    # keys in JSON are strings; accept numeric input too
    if member_id in members:
        info = members[member_id]
    else:
        # try converting to int then back to string to normalize
        try:
            normalized = str(int(member_id))
            info = members.get(normalized)
        except ValueError:
            info = None

    if not info:
        print(f"ID not found: {member_id}", file=sys.stderr)
        sys.exit(2)

    nickname = info.get("nickname", "")
    username = info.get("username", "")
    print(f"Nickname: {nickname}")
    print(f"Username: {username}")

def main():
    p = argparse.ArgumentParser(
        description="Print Discord nicknames, usernames, or details for a specific ID."
    )
    p.add_argument(
        "-f", "--file",
        default="discord_members.json",
        help="Path to discord_members.json (default: ./discord_members.json)"
    )
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--nicknames", action="store_true", help="Print only nicknames")
    group.add_argument("--usernames", action="store_true", help="Print only usernames")
    group.add_argument("--id", metavar="DISCORD_ID", help="Print nickname and username for a specific ID")

    args = p.parse_args()
    members = load_members(Path(args.file))

    if args.nicknames:
        print_only(members, "nickname")
    elif args.usernames:
        print_only(members, "username")
    elif args.id:
        print_by_id(members, args.id)

if __name__ == "__main__":
    main()
