"""WURD game recaps v2. Safe to run with the existing Flask summary route.

Backfill: python -m services.summary_service --league 1886931 --season season_0 --week week_8 --rebuild
Run from the madden_flask_app project directory. Rebuild never posts to Discord.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path

from services.summary_helpers import (
    _load_json_safe_path, _safe_int, _pick_winner, _team_name,
    _leaderboard, _rows, _storyline, _impact_defenders, post_summary_to_discord
)


def _atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.recaps_', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _week_record(upload_folder, league_id, season_dir, week_num, team_id):
    """Historical W-L-T entering this week; only count completed earlier games."""
    w = l = t = 0
    complete_history = True
    for n in range(1, week_num):
        path = Path(upload_folder) / str(league_id) / season_dir / f'week_{n}' / 'parsed_schedule.json'
        games = _load_json_safe_path(path, [])
        if not isinstance(games, list):
            complete_history = False
            continue
        for g in games:
            if not isinstance(g, dict) or str(team_id) not in (str(g.get('homeTeamId')), str(g.get('awayTeamId'))):
                continue
            if not _game_complete(g):
                continue
            a, b = _safe_int(g.get('homeScore')), _safe_int(g.get('awayScore'))
            if a == b: t += 1
            elif (a > b) == (str(g.get('homeTeamId')) == str(team_id)): w += 1
            else: l += 1
    return {'wins': w, 'losses': l, 'ties': t, 'verified_prior_games': w + l + t, 'history_complete': complete_history}


def _game_complete(game):
    # Match legacy behavior when there is no trustworthy completion flag.
    # Never invent a result for 0-0. Respect explicit incomplete flags.
    for key in ('isComplete', 'completed', 'gameComplete'):
        if key in game:
            if isinstance(game[key], bool) and not game[key]: return False
            if game[key] in (0, '0', 'false', 'False'): return False
    return bool(_safe_int(game.get('homeScore')) or _safe_int(game.get('awayScore')))


def _make_summary(game, team_map, passing, rushing, receiving, defense, upload_folder, league_id, season_dir, week_number):
    home_id, away_id = str(game.get('homeTeamId')), str(game.get('awayTeamId'))
    hs, aws = _safe_int(game.get('homeScore')), _safe_int(game.get('awayScore'))
    home, away = _team_name(team_map, home_id), _team_name(team_map, away_id)
    player_data = {tid: _leaderboard(tid, passing, rushing, receiving, defense) for tid in (home_id, away_id)}
    leader_pool = [(tid, p) for tid, players in player_data.items() for p in players]
    winner_id, loser_id = _pick_winner(home_id, away_id, hs, aws)
    winner, loser = (_team_name(team_map, winner_id), _team_name(team_map, loser_id)) if winner_id else (None, None)
    # A modest winning bonus helps choose the POG without excluding exceptional losers.
    chosen = max(leader_pool, key=lambda item: (item[1]['score'] + (4 if item[0] == winner_id else 0), item[1]['score'])) if leader_pool else None
    pog = chosen[1] if chosen else None
    pog_blurb = f"{pog['name']}: {pog['detail']}" if pog else None
    if winner_id:
        ws, ls = (hs, aws) if winner_id == home_id else (aws, hs)
        winner_leaders = player_data[winner_id]
        category, headline = _storyline(winner, loser, ws, ls, winner_leaders)
        paragraphs = [f'{winner} defeated {loser} {ws}–{ls} in Week {week_number}. The teams combined for {hs + aws} points, with a {abs(hs - aws)}-point final margin.']
        if pog:
            side = winner if chosen[0] == winner_id else loser
            paragraphs.append(f"{side}'s {pog['name']} stood out with {pog['detail']}.")
        other = [p for tid, p in leader_pool if (not chosen or p is not pog) and p['score'] > 0]
        other.sort(key=lambda p: -p['score'])
        if other:
            p = other[0]
            paragraphs.append(f"Another notable performance came from {p['name']}, who recorded {p['detail']}.")
    else:
        category, headline = 'Tie game', f'{home} and {away} Tie {hs}–{aws}'
        paragraphs = [f'{home} and {away} finished tied {hs}–{aws} in Week {week_number}.']
        if pog: paragraphs.append(f"{pog['name']} posted {pog['detail']}.")
    team_cards = []
    for tid, name, score in ((away_id, away, aws), (home_id, home, hs)):
        team_cards.append({
            'teamId': tid, 'name': name, 'score': score, 'won': tid == winner_id,
            'leaders': player_data[tid][:3],
            'offense': [p for p in player_data[tid] if p['kind'] != 'defense'][:3],
            'defense': [p for p in player_data[tid] if p['kind'] == 'defense'][:3],
            # Record only if historical weekly schedules can actually establish it.
            'record_before': _week_record(upload_folder, league_id, season_dir, week_number, tid) if week_number > 1 else {'wins': 0, 'losses': 0, 'ties': 0, 'verified_prior_games': 0, 'history_complete': True}
        })
    return {
        'gameId': str(game.get('scheduleId') or game.get('gameId')),
        'homeTeamId': home_id, 'awayTeamId': away_id,
        'homeScore': hs, 'awayScore': aws, 'headline': headline,
        'narrative': ' '.join(paragraphs), 'paragraphs': paragraphs,
        'storyline': category, 'week': week_number,
        'player_of_game': pog_blurb,
        'player_of_game_detail': ({'team': _team_name(team_map, chosen[0]), **pog} if chosen else None),
        'impact_defense': {
            home: _impact_defenders(home_id, defense, top_n=3),
            away: _impact_defenders(away_id, defense, top_n=3)
        },
        'teams': team_cards,
        'recap_version': 2
    }


def generate_week_summaries_if_ready(league_id, season_dir, week_dir, upload_folder, rebuild=False):
    """Normal webhooks only add new games; rebuild overwrites summaries but never reposts."""
    base = Path(upload_folder) / str(league_id) / str(season_dir) / str(week_dir)
    schedule = _load_json_safe_path(base / 'parsed_schedule.json', [])
    if not isinstance(schedule, list):
        print('⚠️ No parsed schedule found. Skipping recaps.')
        return
    week_number = int(str(week_dir).replace('week_', ''))
    sources = {
        'passing': _rows(_load_json_safe_path(base / 'passing.json', []), ['playerPassingStatInfoList']),
        'rushing': _rows(_load_json_safe_path(base / 'parsed_rushing.json', []), ['playerRushingStatInfoList']),
        'receiving': _rows(_load_json_safe_path(base / 'receiving.json', []), ['playerReceivingStatInfoList']),
        'defense': _rows(_load_json_safe_path(base / 'parsed_defense.json', []), ['playerDefensiveStatInfoList'])
    }
    team_map = _load_json_safe_path(Path(upload_folder) / str(league_id) / 'team_map.json', {})
    if not isinstance(team_map, dict): team_map = {}
    summary_path = base / 'game_summaries.json'
    existing = _load_json_safe_path(summary_path, {'games': []})
    if not isinstance(existing, dict) or not isinstance(existing.get('games'), list):
        raise ValueError(f'Unexpected game_summaries.json format: {summary_path}')
    games = existing['games']
    by_id = {str(g.get('gameId')): i for i, g in enumerate(games) if isinstance(g, dict)}
    added = []
    updated = 0
    for game in schedule:
        if not isinstance(game, dict) or not _game_complete(game): continue
        gid = game.get('scheduleId') or game.get('gameId')
        if gid is None or not str(gid).strip(): continue
        gid = str(gid)
        if gid in by_id and not rebuild: continue
        recap = _make_summary(game, team_map, sources['passing'], sources['rushing'], sources['receiving'], sources['defense'], upload_folder, str(league_id), str(season_dir), week_number)
        if gid in by_id:
            games[by_id[gid]] = recap
            updated += 1
        else:
            by_id[gid] = len(games)
            games.append(recap)
            if not rebuild: added.append(recap)
            else: updated += 1
    if not added and not updated: return
    _atomic_json(summary_path, existing)  # successful website write before any announcement
    print(f'📝 WURD recaps: {len(added)} new, {updated} rebuilt. Saved {summary_path}')
    if rebuild: return
    # Claim before posting prevents duplicate teasers on webhook retries/restarts.
    # Uncertain Discord failures are not retried automatically (at-most-once attempt).
    ledger = base / 'game_recap_discord_attempts.json'
    state = _load_json_safe_path(ledger, {'attempted': []})
    attempted = set(map(str, state.get('attempted', []))) if isinstance(state, dict) else set()
    for recap in added:
        gid = recap['gameId']
        if gid in attempted: continue
        attempted.add(gid)
        _atomic_json(ledger, {'attempted': sorted(attempted)})
        post_summary_to_discord(recap, week_number, league_id, season_dir, week_dir)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Rebuild WURD recaps without Discord reposts')
    parser.add_argument('--league', required=True)
    parser.add_argument('--season', required=True)
    parser.add_argument('--week', required=True)
    parser.add_argument('--uploads', default='uploads')
    parser.add_argument('--rebuild', action='store_true', required=True)
    args = parser.parse_args()
    generate_week_summaries_if_ready(args.league, args.season, args.week, args.uploads, rebuild=args.rebuild)
