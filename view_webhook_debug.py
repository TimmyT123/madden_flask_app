from flask import Flask, render_template_string, send_from_directory
import os

app = Flask(__name__)

UPLOADS_DIR = "uploads"

DEBUG_FILES = [
    "webhook_debug.txt",
    "webhook_debug_league.txt",
    "webhook_debug_roster.txt",
    "webhook_debug_stats.txt"
]

@app.route("/")
def index():
    return render_template_string("""
        <h2>Webhook Debug Viewer</h2>
        <ul>
        {% for file in files %}
            <li><a href="/debug/{{ file }}">{{ file }}</a></li>
        {% endfor %}
        </ul>
    """, files=DEBUG_FILES)

@app.route("/debug/<filename>")
def view_debug(filename):
    if filename not in DEBUG_FILES:
        return "❌ Invalid file requested.", 403

    file_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(file_path):
        return f"❌ File not found: {filename}", 404

    with open(file_path, encoding="utf-8", errors="replace") as f:
        content = f.read()

    return f"<h3>{filename}</h3><pre style='white-space: pre-wrap'>{content}</pre>"

if __name__ == "__main__":
    app.run(debug=True, port=5050)
