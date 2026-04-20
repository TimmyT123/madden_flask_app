
import os
import json
import requests


DISCORD_RECAP_WEBHOOK_URL = os.getenv("DISCORD_RECAP_WEBHOOK_URL")

def _load_json_safe_path(path, default):
    try:
        if not os.path.exists(path):
            return default
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _safe_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default

def _safe_float(x, default=0.0):
    try:
        return float(x)
    except Exception:
        return default

def _pick_winner(home_id, away_id, home_score, away_score):
    if home_score > away_score:
        return str(home_id), str(away_id)
    if away_score > home_score:
        return str(away_id), str(home_id)
    return None, None  # tie

def _team_name(team_map: dict, tid: str) -> str:
    return (team_map.get(str(tid), {}) or {}).get("name") or f"Team {tid}"

def _tone_from_scores(home_score: int, away_score: int) -> str:
    diff = abs(home_score - away_score)
    total = home_score + away_score

    if diff <= 3:
        return "a nail-biter"
    if diff <= 7:
        return "a tight battle"
    if diff >= 35:
        return "a complete blowout"
    if diff >= 21:
        return "a dominant win"
    if total >= 70:
        return "an offensive shootout"
    return "a convincing win"

def _best_offense_player(team_id: str, passing_rows: list, rushing_rows: list):
    """
    Returns (player_dict, score_float, blurb_str)
    """
    team_id = str(team_id)
    candidates = []

    # Passing candidates
    for p in passing_rows or []:
        if str(p.get("teamId")) != team_id:
            continue
        name = p.get("playerName") or p.get("fullName") or p.get("name")
        yds  = _safe_int(p.get("passYds") or p.get("passingYards") or p.get("yards") or 0)
        tds  = _safe_int(p.get("passTDs") or p.get("passingTDs") or p.get("tds") or 0)
        ints = _safe_int(p.get("int") or p.get("ints") or p.get("interceptions") or 0)
        comp = _safe_int(p.get("completions") or p.get("comp") or 0)
        att  = _safe_int(p.get("attempts") or p.get("att") or 0)

        # Simple POG score
        score = (yds / 25.0) + (tds * 6.0) - (ints * 5.0)
        blurb = f"{yds} pass yds, {tds} TD, {ints} INT" + (f" ({comp}/{att})" if att else "")
        candidates.append(("pass", p, score, name, blurb))

    # Rushing candidates
    for r in rushing_rows or []:
        if str(r.get("teamId")) != team_id:
            continue
        name = r.get("playerName") or r.get("fullName") or r.get("name")
        yds  = _safe_int(r.get("rushYds") or r.get("rushingYards") or r.get("yards") or 0)
        tds  = _safe_int(r.get("rushTDs") or r.get("rushingTDs") or r.get("tds") or 0)
        att  = _safe_int(r.get("rushAtt") or r.get("attempts") or r.get("att") or 0)

        score = (yds / 12.0) + (tds * 6.0)
        blurb = f"{yds} rush yds, {tds} TD" + (f" ({att} carries)" if att else "")
        candidates.append(("rush", r, score, name, blurb))

    if not candidates:
        return None, 0.0, ""

    _, row, score, name, blurb = max(candidates, key=lambda x: x[2])
    return row, float(score), f"{name}: {blurb}"

def _impact_defenders(team_id: str, defense_rows: list, top_n: int = 3):
    """
    Returns list of small blurbs like:
      "J. Smith: 2 sacks, 1 INT"
    """
    team_id = str(team_id)
    defenders = []

    for d in defense_rows or []:
        if str(d.get("teamId")) != team_id:
            continue
        name = d.get("playerName") or d.get("fullName") or d.get("name")

        sacks = _safe_float(d.get("sacks") or d.get("sack") or 0)
        ints  = _safe_int(d.get("ints") or d.get("int") or d.get("interceptions") or 0)
        tfl   = _safe_float(d.get("tfl") or d.get("tacklesForLoss") or 0)
        ff    = _safe_int(d.get("forcedFumbles") or d.get("ff") or 0)
        td    = _safe_int(d.get("defTDs") or d.get("td") or 0)

        # Impact score: prioritize sacks + picks
        score = (sacks * 4.0) + (ints * 5.0) + (tfl * 2.0) + (ff * 3.0) + (td * 6.0)
        if score <= 0:
            continue

        bits = []
        if sacks: bits.append(f"{sacks:g} sacks")
        if ints:  bits.append(f"{ints} INT")
        if tfl:   bits.append(f"{tfl:g} TFL")
        if ff:    bits.append(f"{ff} FF")
        if td:    bits.append(f"{td} DEF TD")

        defenders.append((score, f"{name}: " + ", ".join(bits)))

    defenders.sort(key=lambda x: x[0], reverse=True)
    return [txt for _, txt in defenders[:top_n]]

def post_summary_to_discord(summary, week_number, league_id, season_dir, week_dir):
    base_url = os.getenv("SITE_BASE_URL", "https://wurd-madden.com")
    webhook_url = os.getenv("DISCORD_RECAP_WEBHOOK_URL")

    if not webhook_url:
        print("⚠️ No DISCORD_RECAP_WEBHOOK_URL set. Skipping Discord post.")
        return

    recap_url = f"{base_url}/summary/{summary['gameId']}?league={league_id}&season={season_dir}&week={week_dir}"

    separator = "\n══════════════════════\n"

    message = (
        f"{separator}\n"
        f"📰 **WURD Game Recap – Week {week_number}**\n\n"
        f"**{summary['headline']}**\n\n"
        f"🌐 Read the full recap:\n{recap_url}"
    )

    try:
        response = requests.post(webhook_url, json={"content": message})
        if response.status_code in (200, 204):
            print("✅ Recap teaser posted to Discord")
        else:
            print(f"❌ Failed to post recap teaser: {response.status_code} {response.text}")
    except Exception as e:
        print(f"❌ Discord recap error: {e}")


