# parsers/enrich_helpers.py
import os, json, re

def _clean_name(s: str) -> str:
    if not s: return ""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def _name_keys(first: str | None, last: str | None, full: str | None) -> tuple[str, str, str]:
    first = (first or "").strip(); last = (last or "").strip(); full = (full or "").strip()
    clean_full = _clean_name(full or (first + " " + last))
    first_initial = (first[:1] or "").lower()
    clean_last = _clean_name(last)
    init_last = (first_initial + clean_last) if first_initial and clean_last else ""
    return clean_full, init_last, clean_last

def _load_roster_players(league_id: str) -> list[dict]:
    base = os.path.join("uploads", str(league_id), "season_global", "week_global")
    for fn in ("parsed_rosters.json", "rosters.json"):
        p = os.path.join(base, fn)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                return raw.get("rosterInfoList") or raw.get("players") or raw.get("items") or []
            return raw if isinstance(raw, list) else []
    return []

def enrich_with_pos_jersey(players: list[dict], league_id: str) -> list[dict]:
    """
    Mutates and returns `players`, filling `position` and `jerseyNum` using the league roster.
    Tries: rosterId → playerId → (full name,teamId) → (first-initial+last,teamId) → (last,teamId).
    Also standardizes `name` for display.
    """
    rplayers = _load_roster_players(league_id)

    # Build maps
    pos_by_rid, pos_by_pid = {}, {}
    pos_by_fullteam, pos_by_initlast, pos_by_last = {}, {}, {}
    jer_by_rid, jer_by_pid = {}, {}
    jer_by_fullteam, jer_by_initlast, jer_by_last = {}, {}, {}

    for rp in rplayers:
        raw = rp.get("_raw") or {}
        rid = str(raw.get("rosterId") or raw.get("id") or "")
        pid = str(
            rp.get("playerId")
            or raw.get("playerId")
            or raw.get("id")
            or raw.get("personaId")
            or ""
        )
        tid = str(rp.get("teamId") or raw.get("teamId") or raw.get("team") or "").strip()

        first = raw.get("firstName") or rp.get("firstName")
        last  = raw.get("lastName")  or rp.get("lastName")
        full  = (rp.get("name") or raw.get("fullName") or raw.get("playerName")
                 or ((first or "") + " " + (last or ""))).strip()

        clean_full, init_last, clean_last = _name_keys(first, last, full)

        pos = rp.get("pos") or raw.get("position") or raw.get("pos")
        jersey = (rp.get("jerseyNum") or raw.get("jerseyNum") or raw.get("uniformNumber")
                  or raw.get("jerseyNumber") or raw.get("jersey") or raw.get("number"))

        if pos:
            if rid: pos_by_rid[rid] = pos
            if pid: pos_by_pid[pid] = pos
            if tid:
                if clean_full: pos_by_fullteam[(clean_full, tid)] = pos
                if init_last:  pos_by_initlast[(init_last, tid)] = pos
                if clean_last: pos_by_last[(clean_last, tid)] = pos

        if jersey not in (None, "", -1):
            if rid: jer_by_rid[rid] = jersey
            if pid: jer_by_pid[pid] = jersey
            if tid:
                if clean_full: jer_by_fullteam[(clean_full, tid)] = jersey
                if init_last:  jer_by_initlast[(init_last, tid)] = jersey
                if clean_last: jer_by_last[(clean_last, tid)] = jersey

    # Enrich rows
    for p in players:
        rid  = str(p.get("rosterId") or p.get("id") or "")
        pid = str(
            p.get("playerId")
            or p.get("id")
            or p.get("personaId")
            or ""
        )
        tid = str(p.get("teamId") or p.get("team") or "").strip()

        disp = (p.get("playerName") or p.get("fullName") or p.get("name") or p.get("displayName") or "").strip()

        # Try to split formats like "C.Weigman"
        m = re.match(r"^\s*([A-Za-z])\s*[\.\-_\s]*([A-Za-z']+)\s*$", disp)
        if m:
            first_guess, last_guess = m.group(1), m.group(2)
        else:
            parts = re.split(r"[\s._-]+", disp) if disp else []
            first_guess = parts[0] if parts else ""
            last_guess  = parts[-1] if len(parts) > 1 else ""
        clean_full, init_last, clean_last = _name_keys(first_guess, last_guess, disp)

        if not (p.get("position") or p.get("pos")):
            pos = (pos_by_rid.get(rid) or pos_by_pid.get(pid)
                   or (pos_by_fullteam.get((clean_full, tid)) if clean_full and tid else None)
                   or (pos_by_initlast.get((init_last, tid)) if init_last and tid else None)
                   or (pos_by_last.get((clean_last, tid)) if clean_last and tid else None))
            if pos:
                p["position"] = pos

        if p.get("jerseyNum") in (None, "", -1):
            jersey = (jer_by_rid.get(rid) or jer_by_pid.get(pid)
                      or (jer_by_fullteam.get((clean_full, tid)) if clean_full and tid else None)
                      or (jer_by_initlast.get((init_last, tid)) if init_last and tid else None)
                      or (jer_by_last.get((clean_last, tid)) if clean_last and tid else None))
            if jersey not in (None, "", -1):
                p["jerseyNum"] = jersey

        # nice-to-have: ensure we have a 'name' key for templates
        if not p.get("name"):
            p["name"] = disp

    return players
