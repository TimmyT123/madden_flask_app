import os
import re

UPLOAD_FOLDER = "uploads"
# Match: parsed_17287266_20250804_180337.json
regex = re.compile(r"^parsed_\d{8,}_\d{8}_\d{6}\.json$")

def cleanup_parsed_debug_files():
    matched_files = []

    # Search recursively for matching files
    for root, _, files in os.walk(UPLOAD_FOLDER):
        for filename in files:
            if regex.match(filename):
                file_path = os.path.join(root, filename)
                matched_files.append(file_path)

    # Show files before deletion
    if not matched_files:
        print("✅ No debug parsed files to delete.")
        return

    print("🧾 The following parsed debug files will be deleted:\n")
    for path in matched_files:
        print(f" - {path}")

    confirm = input("\n❓ Are you sure you want to delete these files? (y/N): ").strip().lower()
    if confirm != 'y':
        print("\n❌ Deletion cancelled.")
        return

    # Proceed with deletion
    deleted = 0
    for path in matched_files:
        try:
            os.remove(path)
            print(f"🗑️ Deleted: {path}")
            deleted += 1
        except Exception as e:
            print(f"❌ Failed to delete {path}: {e}")

    print(f"\n✅ Deleted {deleted} parsed debug file(s).")

if __name__ == "__main__":
    cleanup_parsed_debug_files()

