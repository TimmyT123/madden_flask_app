# parsers/defense_parser.py

import json, os

# ✅ Include the "def*" keys from your export
DEF_KEYS = {
    "playerId":    ["playerId", "rosterId", "id"],
    "playerName":  ["playerName", "fullName", "name", "displayName"],
    "teamId":      ["teamId", "teamID", "team"],
    "position":    ["position", "pos"],

    # Totals & events
    "tackles":     ["defTotalTackles", "tackles", "totalTackles", "tkls"],
    "sacks":       ["defSacks", "sacks", "sk"],
    "ints":        ["defInts", "interceptions", "ints"],
    "intYds":      ["defIntReturnYds", "interceptionYds", "intYds"],
    # Your payload only has overall defensive TDs; keep both fields so UI can show either
    "defTds":      ["defTDs", "defensiveTDs", "defTd", "tds"],
    "intTd":       ["interceptionTDs", "intTd"],  # often missing; we’ll derive 0 if absent

    "pd":          ["defDeflections", "passesDefended", "passDeflections", "pd"],
    "ff":          ["defForcedFum", "forcedFumbles", "ff"],
    "fr":          ["defFumRec", "fumblesRecovered", "fr"],
    "safeties":    ["defSafeties", "safeties", "safety"],
    "points":      ["defPts", "defPoints", "points"],
    "catchAllowed":["defCatchAllowed", "catchesAllowed"],
    # Sometimes exports include TFL or solos/assists; default 0 when absent
    "tfl":         ["defTFL", "defTacklesForLoss", "tacklesForLoss", "tfl"],
    "solo":        ["soloTackles", "solo", "tacklesSolo"],
    "assisted":    ["assistedTackles", "assisted", "tacklesAssisted"],
}

def _pick(row, keys, default=0):
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return default

def _pick_str(row, keys, default=""):
    v = _pick(row, keys, default)
    return "" if v is None else str(v)

def _as_int(v, default=0):
    try: return int(v)
    except Exception:
        try: return int(float(str(v).replace("½", ".5")))
        except Exception: return default

def _as_float(v, default=0.0):
    try: return float(v)
    except Exception:
        try: return float(str(v).replace("½", ".5"))
        except Exception: return default

def _norm_one(r: dict) -> dict:
    name = _pick_str(r, DEF_KEYS["playerName"], "Unknown")
    pid  = _pick_str(r, DEF_KEYS["playerId"], "")
    tid  = _pick_str(r, DEF_KEYS["teamId"], "")
    pos  = _pick_str(r, DEF_KEYS["position"], "")

    # core stats (default to 0 when missing)
    tkls = _as_int(_pick(r, DEF_KEYS["tackles"], 0))
    solo = _as_int(_pick(r, DEF_KEYS["solo"], 0))
    ast  = _as_int(_pick(r, DEF_KEYS["assisted"], 0))
    if not tkls:  # derive total if only solo/assist present
        tkls = solo + ast

    tfl   = _as_int(_pick(r, DEF_KEYS["tfl"], 0))
    sacks = _as_float(_pick(r, DEF_KEYS["sacks"], 0.0))
    ints  = _as_int(_pick(r, DEF_KEYS["ints"], 0))
    intyd = _as_int(_pick(r, DEF_KEYS["intYds"], 0))

    # touchdowns: keep both (INT TD often absent in this feed)
    def_tds = _as_int(_pick(r, DEF_KEYS["defTds"], 0))
    int_td  = _as_int(_pick(r, DEF_KEYS["intTd"], 0))  # stays 0 if not present

    pd   = _as_int(_pick(r, DEF_KEYS["pd"], 0))
    ff   = _as_int(_pick(r, DEF_KEYS["ff"], 0))
    fr   = _as_int(_pick(r, DEF_KEYS["fr"], 0))
    sfty = _as_int(_pick(r, DEF_KEYS["safeties"], 0))
    pts  = _as_int(_pick(r, DEF_KEYS["points"], 0))
    ca   = _as_int(_pick(r, DEF_KEYS["catchAllowed"], 0))

    return {
        "playerId": pid,
        "playerName": name,
        "teamId": tid,
        "position": pos,

        "tackles": tkls,
        "solo": solo,
        "assisted": ast,
        "tfl": tfl,
        "sacks": sacks,
        "ints": ints,
        "intYds": intyd,
        "intTd": int_td,
        "pd": pd,
        "ff": ff,
        "fr": fr,
        "defTds": def_tds,
        "safeties": sfty,
        "catchAllowed": ca,
        "points": pts,
    }

def parse_defense_stats(league_id: str, payload: dict, out_dir: str):
    items = payload.get("playerDefensiveStatInfoList") or payload.get("items") or []
    rows  = [_norm_one(p) for p in items]

    # Sort: INTs → Sacks → Tackles → PD → FF (tweak to taste)
    rows.sort(key=lambda r: (r["ints"], r["sacks"], r["tackles"], r["pd"], r["ff"]), reverse=True)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "parsed_defense.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print(f"🛡️ Wrote parsed defense → {out_path} (rows={len(rows)})")
