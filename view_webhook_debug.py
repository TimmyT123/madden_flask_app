import os
import json
import re

# Define file paths
DEBUG_FOLDER = "uploads"
DEBUG_FILES = {
    "1": "webhook_debug.txt",
    "2": "webhook_debug_league.txt",
    "3": "webhook_debug_roster.txt",
    "4": "webhook_debug_stats.txt"
}

def print_menu():
    print("\nSelect a webhook debug file to view:")
    for key, filename in DEBUG_FILES.items():
        print(f"{key}. {filename}")
    print("5. Exit")

def try_pretty_json(line):
    stripped = line.strip()
    try:
        if stripped.startswith("{") or stripped.startswith("["):
            parsed = json.loads(stripped)
            return json.dumps(parsed, indent=2)
    except json.JSONDecodeError:
        pass
    return None

def extract_top_level_titles(lines):
    titles = []
    pattern = re.compile(r'"([^"]+?)"\s*:\s*\[')
    for i, line in enumerate(lines):
        matches = pattern.findall(line)
        for match in matches:
            titles.append((i + 1, match))  # (line number, key)
    return titles

def view_from_line(lines, start_line):
    print(f"\n📄 Viewing from line {start_line}:\n")
    for idx in range(start_line - 1, len(lines)):
        line = lines[idx]
        pretty = try_pretty_json(line)
        if pretty:
            print(f"{idx + 1:>4}: [JSON block]")
            for pline in pretty.splitlines():
                print(f"      {pline}")
        else:
            print(f"{idx + 1:>4}: {line.rstrip()}")

def read_debug_file(filename):
    path = os.path.join(DEBUG_FOLDER, filename)
    if not os.path.exists(path):
        print(f"\n❌ File not found: {path}\n")
        return

    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Show dictionary-style JSON block titles
    print(f"\n📂 Titles found in {filename}:\n")
    titles = extract_top_level_titles(lines)
    if not titles:
        print("No dictionary-style titles found.\n")
    else:
        for lineno, title in titles:
            print(f"🔹 Line {lineno}: \"{title}\"")

    print("\nOptions:")
    print("1. View entire file")
    print("2. Jump to a specific line number")
    print("3. Cancel")

    option = input("Enter option number (1-3): ").strip()

    if option == "1":
        view_from_line(lines, 1)
    elif option == "2":
        try:
            line_number = int(input("Enter line number to jump to: "))
            if 1 <= line_number <= len(lines):
                view_from_line(lines, line_number)
            else:
                print("⚠️ Line number out of range.")
        except ValueError:
            print("⚠️ Invalid number.")
    else:
        print("❌ Cancelled.")

def main():
    while True:
        print_menu()
        choice = input("Enter your choice (1-5): ").strip()
        if choice in DEBUG_FILES:
            read_debug_file(DEBUG_FILES[choice])
        elif choice == "5":
            print("👋 Exiting viewer.")
            break
        else:
            print("⚠️ Invalid selection. Try again.")

if __name__ == "__main__":
    main()
