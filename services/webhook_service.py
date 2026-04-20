import os
import json
import re
from pathlib import Path
from threading import Timer
from time import time
from hashlib import sha256

from parsers.passing_parser import parse_passing_stats
from parsers.schedule_parser import parse_schedule_data
from parsers.league_parser import parse_league_info_data
from parsers.standings_parser import parse_standings_data
from parsers.defense_parser import parse_defense_stats

from services.summary_service import generate_week_summaries_if_ready

import services.webhook_helpers as webhook_helpers

from services.webhook_helpers import (
    resolve_league_id,
    is_team_id,
    compute_display_week,
    _atomic_write_json,
    update_default_week,
    last_webhook_time,
    webhook_buffer,
    batch_timers,
    ROSTER_DEBOUNCE_SEC,
    _add_roster_chunk,
    _get_roster_acc,
    _flush_roster,
)



def process_webhook_data(
    data,
    subpath,
    headers,
    body,
    app,
    league_data
):
    # ✅ detect simulator replays (headers dict is passed in from the request)
    is_replay = (headers.get("X-Replay") == "1" or headers.get("x-replay") == "1")

    # ✅ 1. Save debug snapshot (skip for replays so we don't rewrite during sims)
    if not is_replay:
        debug_path = os.path.join(app.config['UPLOAD_FOLDER'], 'webhook_debug.txt')
        with open(debug_path, 'w', encoding='utf-8') as f:
            f.write(f"SUBPATH: {subpath}\n\nHEADERS:\n")
            for k, v in headers.items():
                f.write(f"{k}: {v}\n")
            f.write("\nBODY:\n")
            f.write(body.decode('utf-8', errors='replace'))

    # ✅ 2. Determine storage path (league id)
    league_id = resolve_league_id(data, subpath, league_data)
    if not league_id:
        app.logger.error("No league_id found")
        return

    # ✅ FORCE STRING (prevents path bugs)
    league_id = str(league_id)

    # 🔒 ABSOLUTE NORMALIZATION
    if is_team_id(league_id):
        real_league = (
                data.get("leagueId")
                or data.get("franchiseInfo", {}).get("leagueId")
                or league_data.get("latest_league")
        )
        if not real_league:
            # 🔁 FINAL fallback: extract leagueId from URL path
            # subpath example:
            # /rosters/ps5/3264906/team/774242331/roster
            parts = (subpath or "").split("/")
            try:
                idx = parts.index("ps5")
                real_league = parts[idx + 1]
                print(f"🧭 Fallback league from path → {real_league}")
            except Exception:
                raise RuntimeError(f"Cannot resolve real league for teamId {league_id}")

        print(f"🧭 Normalizing teamId {league_id} → league {real_league}")
        team_id = league_id
        league_id = str(real_league)
    else:
        team_id = None

    # 🔒 Invariant: after normalization, league_id must NOT be a teamId
    if is_team_id(league_id):
        raise RuntimeError(f"🚨 INTERNAL ERROR: league_id still a teamId after normalization: {league_id}")

    league_data["latest_league"] = league_id
    print(f"📎 Using league_id: {league_id}")

    # 3) Classify batch for debug batching (kept as-is: based on subpath)
    if "league" in (subpath or ""):
        batch_type = "league"
        filename = "webhook_debug_league.txt"
    elif any(x in (subpath or "") for x in ["passing", "kicking", "rushing", "receiving", "defense"]):
        batch_type = "stats"
        filename = "webhook_debug_stats.txt"
    elif "roster" in (subpath or ""):
        batch_type = "roster"
        filename = "webhook_debug_roster.txt"
    else:
        batch_type = "other"
        filename = "webhook_debug_misc.txt"

    # If this is a replay, redirect logs to a separate *_replay.txt file
    if is_replay:
        base, ext = os.path.splitext(filename)
        filename = f"{base}_replay{ext}"

    debug_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    # 4) Debug logging
    if batch_type not in ["league", "stats", "roster"]:
        # non-batched logs → just append (replay or normal)
        with open(debug_path, 'a', encoding='utf-8') as f:
            f.write(f"\n===== NEW WEBHOOK: {subpath} =====\n")
            f.write("HEADERS:\n")
            for k, v in headers.items():
                f.write(f"{k}: {v}\n")
            f.write("\nBODY:\n")
            f.write(body.decode('utf-8', errors='replace'))
            f.write("\n\n")
    else:
        if is_replay:
            # For replays, write immediately to *_replay.txt (no batching/timers)
            with open(debug_path, 'a', encoding='utf-8') as f:
                f.write(f"\n===== NEW WEBHOOK: {subpath} =====\n")
                f.write("HEADERS:\n")
                for k, v in headers.items():
                    f.write(f"{k}: {v}\n")
                f.write("\nBODY:\n")
                f.write(body.decode('utf-8', errors='replace'))
                f.write("\n\n")
        else:
            # Normal path: buffered batching with timer
            last_webhook_time[batch_type] = time()
            webhook_buffer[batch_type].append({
                "subpath": subpath,
                "headers": headers,
                "body": body.decode('utf-8', errors='replace'),
            })

            if batch_timers.get(batch_type):
                batch_timers[batch_type].cancel()

            def flush_batch(bt=batch_type):
                debug_path_flush = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                # NOTE: this still overwrites on each flush; switch to 'a' to append history
                with open(debug_path_flush, 'w', encoding='utf-8') as f:
                    for entry in webhook_buffer[bt]:
                        f.write(f"\n===== NEW WEBHOOK: {entry['subpath']} =====\n")
                        f.write("HEADERS:\n")
                        for k, v in entry['headers'].items():
                            f.write(f"{k}: {v}\n")
                        f.write("\nBODY:\n")
                        f.write(entry['body'])
                        f.write("\n\n")
                print(f"✅ Flushed {bt} batch with {len(webhook_buffer[bt])} webhooks.")
                webhook_buffer[bt] = []

            batch_timers[batch_type] = Timer(5.0, flush_batch)
            batch_timers[batch_type].start()

    # 5) Companion error?
    if 'error' in data:
        print(f"⚠️ Companion App Error: {data['error']}")
        error_filename = f"{subpath.replace('/', '_')}_error.json"
        with open(os.path.join(app.config['UPLOAD_FOLDER'], error_filename), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        return

    # 6) Determine type-specific handling
    if "playerPassingStatInfoList" in data:
        filename = "passing.json"
    elif "playerReceivingStatInfoList" in data:
        filename = "receiving.json"
    elif "playerDefensiveStatInfoList" in data:
        filename = "defense.json"
    elif "gameScheduleInfoList" in data:
        filename = "schedule.json"
    elif "rosterInfoList" in data:
        # 🔒 SAFETY ASSERT — normalization must already be done
        if is_team_id(league_id):
            raise RuntimeError(
                f"🚨 INTERNAL ERROR: league_id still a teamId inside roster handler: {league_id}"
            )

        # ✳️ Debug FA payloads specifically
        if "freeagents" in (subpath or "").lower():
            fa_count = len(data.get("rosterInfoList") or [])
            print(
                f"🧲 Free Agents payload: success={data.get('success')} "
                f"count={fa_count} "
                f"message={data.get('message') or data.get('error')}"
            )

            dump_root = Path(app.config["UPLOAD_FOLDER"])
            dump_dir = dump_root / str(league_id) / "season_global" / "week_global"
            dump_dir.mkdir(parents=True, exist_ok=True)

            raw_path = dump_dir / "freeagents_last_raw.json"
            with raw_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"🧲 Free Agents payload: wrote → {raw_path}")

        if data.get("success") is False and not data.get("rosterInfoList"):
            print("⚠️ Skipping roster write: export failed / empty list.")
            return

        league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, "season_global", "week_global")

        # 🔒 ROSTERS ARE GLOBAL SNAPSHOTS
        # They must ONLY ever write to season_global/week_global
        # Weekly season_X/week_Y folders must NEVER contain roster data

        if not league_folder.endswith(os.path.join("season_global", "week_global")):
            raise RuntimeError(
                f"🚨 INVALID ROSTER WRITE TARGET: {league_folder}"
            )

        os.makedirs(league_folder, exist_ok=True)

        roster_list = data.get("rosterInfoList") or []

        rosters_by_team_dir = os.path.join(
            app.config['UPLOAD_FOLDER'],
            league_id,
            "season_global",
            "week_global",
            "rosters_by_team"
        )
        os.makedirs(rosters_by_team_dir, exist_ok=True)

        # If this payload is team-scoped, persist it
        if team_id:
            team_path = os.path.join(rosters_by_team_dir, f"{team_id}.json")
            with open(team_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

        added, total = _add_roster_chunk(league_id, roster_list)
        print(f"📥 Roster chunk received ({len(roster_list)}); merged so far={total} (added={added}).")

        acc = _get_roster_acc(league_id)
        if acc["timer"]:
            acc["timer"].cancel()
        acc["timer"] = Timer(
            ROSTER_DEBOUNCE_SEC,
            _flush_roster,
            args=[league_id, league_folder, app.config["UPLOAD_FOLDER"]]
        )
        acc["timer"].start()

        return
    elif "teamInfoList" in data or "leagueTeamInfoList" in data:
        filename = "league.json"
        print("🏈 League Info received and saved!")
        if "leagueTeamInfoList" in data and "teamInfoList" not in data:
            data["teamInfoList"] = data["leagueTeamInfoList"]
        if "teamInfoList" in data:
            league_data["teams"] = data["teamInfoList"]
    elif "teamStandingInfoList" in data:
        filename = "standings.json"
        print("📊 Standings data received and saved!")
    else:
        filename = f"{subpath.replace('/', '_')}.json"

    # 7) Work out season/week (unchanged for non-roster)
    season_index = data.get("seasonIndex") or data.get("season")
    week_index = data.get("weekIndex") or data.get("week")

    stat_lists = [
        "gameScheduleInfoList",
        "playerPassingStatInfoList",
        "playerReceivingStatInfoList",
        "playerRushingStatInfoList",
        "playerKickingStatInfoList",
        "playerPuntingStatInfoList",
        "playerDefensiveStatInfoList",
        "teamStatInfoList",
    ]
    for key in stat_lists:
        if key in data and isinstance(data[key], list) and data[key]:
            first = data[key][0]
            if isinstance(first, dict):
                if not isinstance(season_index, int):
                    season_index = first.get("seasonIndex") or first.get("season")
                if not isinstance(week_index, int):
                    week_index = first.get("weekIndex") or first.get("week")
            break

    if "teamInfoList" in data or "leagueTeamInfoList" in data:
        season_index = "global"
        week_index = "global"

    print(f"📦 subpath raw: {subpath}")

    phase = None
    week_index_int_path = None

    # Detect from subpath
    if subpath:
        m = re.search(r'week/(reg|post|pre)/(\d+)', subpath)
        if m:
            phase = m.group(1)
            week_index_int_path = int(m.group(2))
        else:
            print("⚠️ Could not detect phase from subpath")

    # Fallback detection
    if not phase:
        stage = data.get("stage") or data.get("seasonStage")
        if stage and str(stage).lower().startswith("pre"):
            phase = "pre"
            print("🟡 Fallback detected preseason from payload")

    print(f"📊 FINAL PHASE: {phase}")
    print(f"📊 PATH WEEK: {week_index_int_path}")

    if "gameScheduleInfoList" in data and isinstance(data["gameScheduleInfoList"], list):
        for game in data["gameScheduleInfoList"]:
            if isinstance(game, dict):
                season_index = season_index or game.get("seasonIndex")
                week_index = week_index or game.get("weekIndex")
                break

    if "teamStandingInfoList" in data and isinstance(data["teamStandingInfoList"], list):
        for t in data["teamStandingInfoList"]:
            if isinstance(t, dict):
                season_index = season_index or t.get("seasonIndex")
                week_index = week_index or t.get("weekIndex")
                break

    def to_int_or_none(v):
        try:
            return int(v)
        except Exception:
            return None

    season_index_int = to_int_or_none(season_index)
    week_index_int_payload = to_int_or_none(week_index)
    raw_week_for_display = week_index_int_path if week_index_int_path is not None else week_index_int_payload
    display_week = compute_display_week(phase, raw_week_for_display)

    print(f"📊 PAYLOAD WEEK: {week_index_int_payload}")

    # 🔒 AUTHORITATIVE STATE UPDATE (ONE SOURCE OF TRUTH)
    if season_index_int is not None and display_week is not None:
        season_str = f"season_{season_index_int}"
        week_str = f"week_{display_week}"

        # 🚫 Skip preseason from becoming "latest"
        if not (phase and phase.startswith("pre")):
            league_data["latest_league"] = league_id
            league_data["latest_season"] = season_str
            league_data["latest_week"] = week_str

            print(
                f"🔒 Authoritative set → league={league_id} "
                f"season={season_str} week={week_str}",
                flush=True
            )

        # 💾 Persist latest league across restarts
        latest_path = os.path.join(app.config['UPLOAD_FOLDER'], "_latest.json")
        _atomic_write_json(latest_path, {
            "league": league_id,
            "season": season_str,
            "week": week_str
        })

    # 8) Destination folder (non-roster)
    if (season_index == "global" and week_index == "global") or \
       ("leagueteams" in (subpath or "")) or \
       ("standings" in (subpath or "")):
        season_dir = "season_global"
        week_dir = "week_global"
    else:
        if season_index_int is None:
            print("⚠️ No valid season_index; skipping default_week update.")
            return
        season_dir = f"season_{season_index_int}"

        effective_week = display_week if display_week is not None else week_index_int_payload

        if phase and phase.startswith("pre"):
            pre_week = week_index_int_path or week_index_int_payload

            if pre_week is None:
                print("⚠️ No valid preseason week")
                return

            week_dir = f"pre_week_{pre_week}"
            print(f"🟡 Preseason detected → {week_dir}")

        else:
            if effective_week is None:
                print("⚠️ No valid week; skipping")
                return

            week_dir = f"week_{effective_week}"

        # ✅ SAFETY CHECK (NOW VALID)
        if phase and phase.startswith("pre") and week_dir.startswith("week_"):
            print("🚨 ERROR: Preseason misrouted — blocking write")
            return

        else:
            if effective_week is None:
                print("⚠️ No valid week; skipping default_week update.")
                return

            week_dir = f"week_{effective_week}"
        if not (phase and phase.startswith("pre")):
            print(f"📌 Auto-updating default_week.json: season_{season_index_int}, week_{effective_week}")
            update_default_week(season_index_int, effective_week, league_data)

    league_folder = os.path.join(app.config['UPLOAD_FOLDER'], league_id, season_dir, week_dir)
    os.makedirs(league_folder, exist_ok=True)

    # 9) Write + parse (non-roster)
    if filename == "league.json":
        parse_league_info_data(data, subpath, league_folder)

    # Generic write for non-roster payloads
    output_path = os.path.join(league_folder, filename)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
    print(f"✅ Data saved to {output_path}")

    # Type-specific parse
    if "playerPassingStatInfoList" in data:
        parse_passing_stats(league_id, data, league_folder)
    elif "gameScheduleInfoList" in data:
        parse_schedule_data(data, subpath, league_folder)
    elif "teamInfoList" in data or "leagueTeamInfoList" in data:
        parse_league_info_data(data, subpath, league_folder)
    elif "teamStandingInfoList" in data:
        parse_standings_data(data, subpath, league_folder)
    elif "playerRushingStatInfoList" in data:
        from parsers.rushing_parser import parse_rushing_stats
        print(f"🐛 DEBUG: Detected rushing stats for season={season_index}, week={week_index}")
        parse_rushing_stats(league_id, data, league_folder)
    elif "playerDefensiveStatInfoList" in data:
        print(f"🛡️ DEBUG: Detected defensive stats for season={season_index}, week={week_index}")
        parse_defense_stats(league_id, data, league_folder)
        try:
            if not (phase and phase.startswith("pre")):
                generate_week_summaries_if_ready(
                    league_id=league_id,
                    season_dir=season_dir,
                    week_dir=week_dir,
                    upload_folder=app.config["UPLOAD_FOLDER"]
                )
        except Exception as e:
            print(f"❌ Summary generation failed: {e}")

    # 10) Cache copy
    league_data[subpath] = data

    # 🔐 Update stats hash after stats write
    try:
        webhook_helpers.current_stats_hash = sha256(
            json.dumps(data, sort_keys=True).encode()
        ).hexdigest()
        print(f"🔄 Stats hash updated → {webhook_helpers.current_stats_hash}")
    except Exception as e:
        print(f"⚠️ Failed to update stats hash: {e}")
