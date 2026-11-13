# summary_helpers.py

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
        ints = _safe_int(
            p.get("passINTs")
            or p.get("int")
            or p.get("ints")
            or p.get("interceptions")
            or 0
        )
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
        ints = _safe_int(
            d.get("passINTs")
            or d.get("int")
            or d.get("ints")
            or d.get("interceptions")
            or 0
        )
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



# --- Rich recap helpers (v2; original helpers retained for compatibility) ---
def _first(row, *keys, default=0):
    """Select first present value, including a legitimate zero."""
    for k in keys:
        if k in row and row[k] is not None and row[k] != '':
            return row[k]
    return default


def _rows(data, keys):
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list):
                return [x for x in data[key] if isinstance(x, dict)]
    return []


def _leaderboard(team_id, passing, rushing, receiving, defense):
    """Ordered, source-grounded player leaders and comparable POG candidates."""
    team_id = str(team_id)
    leaders = []
    def add(rows, kind):
        for p in rows:
            if str(p.get('teamId', '')) != team_id:
                continue
            name = _first(p, 'playerName', 'fullName', 'name', default='Unknown player')
            if kind == 'passing':
                yd = _safe_int(_first(p, 'passYds', 'passingYards', 'yards'))
                td = _safe_int(_first(p, 'passTDs', 'passingTDs', 'tds'))
                ints = _safe_int(_first(p, 'passINTs', 'int', 'ints', 'interceptions'))
                att = _safe_int(_first(p, 'passAtt', 'passAttempts', 'attempts', 'att'))
                comp = _safe_int(_first(p, 'passComp', 'completions', 'comp'))
                if yd == td == att == 0: continue
                detail = f'{yd} passing yards, {td} TD, {ints} INT' + (f', {comp}/{att} passing' if att else '')
                score = yd / 25 + td * 6 - ints * 5
                notable = (td >= 4 or yd >= 350)
            elif kind == 'rushing':
                yd = _safe_int(_first(p, 'rushYds', 'rushingYards', 'yards'))
                td = _safe_int(_first(p, 'rushTDs', 'rushingTDs', 'tds'))
                att = _safe_int(_first(p, 'rushAtt', 'attempts', 'att'))
                if yd == td == att == 0: continue
                detail = f'{yd} rushing yards, {td} TD' + (f' on {att} carries' if att else '')
                score = yd / 12 + td * 6
                notable = (td >= 3 or yd >= 180)
            elif kind == 'receiving':
                yd = _safe_int(_first(p, 'recYds', 'receivingYards', 'yards'))
                td = _safe_int(_first(p, 'recTDs', 'receivingTDs', 'tds'))
                catches = _safe_int(_first(p, 'receptions', 'rec', 'catches', 'recCatches'))
                if yd == td == catches == 0: continue
                detail = f'{catches} catches, {yd} receiving yards, {td} TD'
                score = yd / 12 + td * 7 + catches * .25
                notable = (td >= 3 or yd >= 180)
            else:
                sack = _safe_float(_first(p, 'sacks', 'sack'))
                ints = _safe_int(_first(p, 'passINTs', 'int', 'ints', 'interceptions'))
                ff = _safe_int(_first(p, 'forcedFumbles', 'ff'))
                tfl = _safe_float(_first(p, 'tfl', 'tacklesForLoss'))
                td = _safe_int(_first(p, 'defTDs', 'td'))
                if not any((sack, ints, ff, tfl, td)): continue
                parts = ([f'{sack:g} sacks'] if sack else []) + ([f'{ints} INT'] if ints else []) + ([f'{ff} FF'] if ff else []) + ([f'{tfl:g} TFL'] if tfl else []) + ([f'{td} defensive TD'] if td else [])
                detail = ', '.join(parts)
                score = sack * 4 + ints * 7 + ff * 3 + tfl * 2 + td * 10
                notable = sack >= 3 or ints >= 2 or td >= 2
            leaders.append({'name': str(name), 'kind': kind, 'detail': detail, 'score': round(score, 2), 'notable': notable})
    add(passing, 'passing'); add(rushing, 'rushing'); add(receiving, 'receiving'); add(defense, 'defense')
    return sorted(leaders, key=lambda x: (-x['score'], x['name']))


def _storyline(winner, loser, winner_score, loser_score, leaders):
    margin = winner_score - loser_score
    notable = [p for p in leaders if p['notable']]
    best = max(notable, key=lambda x: x['score']) if notable else None
    if best and best['kind'] == 'rushing':
        return 'Rushing showcase', f"{best['name']} Runs Wild as {winner} Beat {loser} {winner_score}–{loser_score}"
    if best and best['kind'] == 'passing':
        return 'Passing showcase', f"{best['name']} Leads {winner} Past {loser} {winner_score}–{loser_score}"
    if best and best['kind'] == 'receiving':
        return 'Receiving showcase', f"{best['name']} Shines as {winner} Top {loser} {winner_score}–{loser_score}"
    if best and best['kind'] == 'defense':
        return 'Defensive standout', f"{best['name']} Makes an Impact in {winner}'s {winner_score}–{loser_score} Win"
    if margin <= 3:
        return 'Close contest', f'{winner} Edge {loser} {winner_score}–{loser_score} in Close Contest'
    if margin >= 28:
        return 'Blowout', f'{winner} Dominate {loser} {winner_score}–{loser_score}'
    if winner_score + loser_score >= 70:
        return 'High-scoring game', f'{winner} Outscore {loser} {winner_score}–{loser_score}'
    return 'Game recap', f'{winner} Defeat {loser} {winner_score}–{loser_score}'
