#!/usr/bin/env python3
"""
WarSync Video Analyzer v1.1
============================
Analysiert Spielvideos und extrahiert Truppendaten (T1/T2/T3/T4)
sowie Match-Verlauf via Ollama Vision-KI (laeuft lokal auf M4 Mac).

Adaptives Sampling:
  Jeder Frame wird per Pixel-Differenz geprueft (<1ms, kein Ollama).
  Ollama wird NUR bei signifikanter Bildaenderung aufgerufen.
  Dadurch werden kurz sichtbare Werte (Gegner-Stats im Match, schnelles
  Scrollen durch Spielerlisten) zuverlaessig erfasst.

Voraussetzungen:  siehe setup_mac.sh
Verwendung:
  python3 warsync_analyzer.py profil.mp4 --player Ben_the_men
  python3 warsync_analyzer.py match.mp4 --mode match
  python3 warsync_analyzer.py video.mp4 --dry-run
  python3 warsync_analyzer.py ~/Videos/warsync/
"""

import cv2, base64, json, os, sys, time, argparse
import urllib.request, urllib.parse, urllib.error
from datetime import datetime

# ── Konfiguration ─────────────────────────────────────────────────────────────
OLLAMA_URL      = "http://localhost:11434"
VISION_MODEL    = "qwen2.5vl"   # Alternativ: llava

# Adaptives Sampling
DIFF_SAMPLE_S   = 0.5    # Pixel-Check alle 0.5s (sehr schnell, <1ms pro Check)
DIFF_THRESH_LOW = 3.0    # % unter diesem Wert: identischer Screen -> ueberspringen
DIFF_THRESH_HIGH= 40.0   # % ueber diesem Wert: harter Schnitt -> Frame verwerfen
COOLDOWN_S      = 1.5    # Sekunden nach Analyse bevor gleicher Screen erneut ausgewertet wird

SUPA_URL = 'https://ktdzxhyuvukontcxghte.supabase.co'
SUPA_KEY = 'sb_publishable_e88gpqka1Iom849Ope2mFw_i8tSWCS8'

# ── Supabase ──────────────────────────────────────────────────────────────────
def supa_get(path):
    req = urllib.request.Request(
        f'{SUPA_URL}/rest/v1/{path}',
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                 'Accept': 'application/json'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'msg': e.read().decode()}

def supa_patch(table, name, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{SUPA_URL}/rest/v1/{table}?name=eq.{urllib.parse.quote(name)}',
        data=body, method='PATCH',
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except urllib.error.HTTPError as e:
        print(f"    PATCH Fehler {e.code}: {e.read().decode()}")
        return False

def supa_insert(table, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{SUPA_URL}/rest/v1/{table}',
        data=body, method='POST',
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except urllib.error.HTTPError as e:
        print(f"    INSERT Fehler {e.code}: {e.read().decode()}")
        return False

# ── Ollama ────────────────────────────────────────────────────────────────────
def ollama_available():
    try:
        urllib.request.urlopen(f'{OLLAMA_URL}/api/tags', timeout=3)
        return True
    except:
        return False

def ollama_models():
    try:
        data = json.loads(urllib.request.urlopen(f'{OLLAMA_URL}/api/tags', timeout=3).read())
        return [m['name'].split(':')[0] for m in data.get('models', [])]
    except:
        return []

def frame_to_b64(frame):
    _, buf = cv2.imencode('.png', frame)
    return base64.b64encode(buf.tobytes()).decode()

def ask(image_b64, prompt, timeout=60):
    body = json.dumps({
        "model": VISION_MODEL, "prompt": prompt,
        "images": [image_b64], "stream": False,
        "options": {"temperature": 0, "seed": 42}
    }).encode()
    req = urllib.request.Request(f'{OLLAMA_URL}/api/generate', data=body,
        headers={'Content-Type': 'application/json'})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read()).get('response','').strip()
    except Exception as e:
        return f"ERROR: {e}"

def parse_json(text):
    try:
        s, e = text.find('{'), text.rfind('}')+1
        if s >= 0 and e > s:
            return json.loads(text[s:e])
    except:
        pass
    return None

# ── Adaptives Sampling ────────────────────────────────────────────────────────
def frame_diff(prev, curr):
    """
    Pixel-Differenz in Prozent (0-100) — laeuft in <1ms.
    Frames werden auf 320px verkleinert und als Graustufen verglichen.
    """
    h, w = curr.shape[:2]
    scale = 320 / w
    size = (320, int(h * scale))
    g1 = cv2.cvtColor(cv2.resize(prev, size, interpolation=cv2.INTER_NEAREST), cv2.COLOR_BGR2GRAY).astype(float)
    g2 = cv2.cvtColor(cv2.resize(curr, size, interpolation=cv2.INTER_NEAREST), cv2.COLOR_BGR2GRAY).astype(float)
    return abs(g2 - g1).mean() / 255.0 * 100.0

def adaptive_frames(cap):
    """
    Generator: liefert (frame_idx, t, frame, diff_pct) fuer alle
    Frames mit signifikanter Bildaenderung.

    Logik:
      diff < LOW  -> identisch, ueberspringen
      diff > HIGH -> harter Schnitt (Szenenwechsel), Referenz aktualisieren aber NICHT analysieren
      sonst       -> relevante Aenderung, Ollama aufrufen (mit Cooldown)

    Ergebnis: kurz sichtbare Screens (z.B. Gegner-Profil fuer 2s)
    werden erfasst; lange gleichbleibende Screens nur einmal.
    """
    fps   = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    step  = max(1, int(fps * DIFF_SAMPLE_S))

    prev_frame      = None
    last_analyzed_t = -999.0
    frame_idx       = 0
    stats = {'checked': 0, 'ollama': 0, 'skipped_same': 0, 'skipped_cut': 0}

    while frame_idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break

        t = frame_idx / fps
        stats['checked'] += 1

        if prev_frame is None:
            prev_frame = frame
            stats['ollama'] += 1
            yield frame_idx, t, frame, 100.0, stats
            frame_idx += step
            continue

        diff = frame_diff(prev_frame, frame)

        if diff < DIFF_THRESH_LOW:
            stats['skipped_same'] += 1

        elif diff > DIFF_THRESH_HIGH:
            # Harter Schnitt: Referenz-Frame aktualisieren, aber nicht analysieren
            # (Ueberblendungen wuerden sonst als "halber Screen" falsch erkannt)
            prev_frame = frame
            stats['skipped_cut'] += 1

        else:
            # Signifikante Aenderung
            if (t - last_analyzed_t) >= COOLDOWN_S:
                prev_frame = frame
                last_analyzed_t = t
                stats['ollama'] += 1
                yield frame_idx, t, frame, diff, stats
            else:
                stats['skipped_same'] += 1

        frame_idx += step

# ── Prompts ───────────────────────────────────────────────────────────────────
CLASSIFY_PROMPT = """Look at this mobile game screenshot. Reply with ONLY one word:
TROOPS   -- troop groups "Erste Truppe", "Zweite Truppe", "Dritte Truppe" with numbers visible
POWER    -- "Details der Kampfkraft" popup visible
PROFILE  -- player profile page with player name
BATTLE   -- war/battle map with colored zones or territories
SCORE    -- scoreboard or final results with team points
OTHER    -- anything else
One word only."""

TROOPS_PROMPT = """Mobile game screenshot showing troop formation groups.
Extract the combat power number for each group:
- "Erste Truppe"  (First Group)  = T1
- "Zweite Truppe" (Second Group) = T2
- "Dritte Truppe" (Third Group)  = T3
- "Vierte Truppe" (Fourth Group) = T4 (may be absent)
Also extract the player name from the top of the screen if visible.
Return ONLY valid JSON:
{"player": "name_or_null", "t1": integer_or_null, "t2": integer_or_null, "t3": integer_or_null, "t4": integer_or_null}
Raw integers, no dots/commas. null if not visible.
Example: {"player": "Ben_the_men", "t1": 27252394, "t2": 21437261, "t3": 20011929, "t4": null}"""

POWER_PROMPT = """Screenshot of "Details der Kampfkraft" (Combat Power Details).
Extract (raw integers):
- Total power at the very top
- "Einheiten-Kampfkraft" (Units Combat Power)
Return ONLY valid JSON:
{"total_power": integer_or_null, "units_power": integer_or_null}"""

BATTLE_PROMPT = """War/battle map screenshot. Identify zone control:
- z1 through z5: which team controls each (A=blue, B=red, neutral, or null if not visible)
- Any player names visible on the map
Return ONLY valid JSON:
{"zones": {"z1": "A/B/neutral/null", "z2": "A/B/neutral/null", "z3": "A/B/neutral/null", "z4": "A/B/neutral/null", "z5": "A/B/neutral/null"}, "players_visible": []}"""

SCORE_PROMPT = """Scoreboard or results screen. Extract team points.
Return ONLY valid JSON:
{"team_a_points": integer_or_null, "team_b_points": integer_or_null, "winner": "A/B/null"}"""

NAME_PROMPT = "Player name shown in this profile screen? Reply with ONLY the name. If none: null"

def classify_fast(b64):
    resp = ask(b64, CLASSIFY_PROMPT, timeout=30).upper()
    for t in ['TROOPS','POWER','PROFILE','BATTLE','SCORE']:
        if t in resp:
            return t
    return 'OTHER'

# ── Profil-Video Analyse ──────────────────────────────────────────────────────
def analyze_profile_video(video_path, known_player=None):
    """
    Adaptives Sampling fuer Profil-Videos.
    Erkennt automatisch wenn durch Spielerlisten gescrollt wird und
    analysiert jeden neuen Screen sobald er stabil sichtbar ist.
    """
    cap = cv2.VideoCapture(video_path)
    fps   = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    dur   = total / fps if fps > 0 else 0
    est_checks = int(total / max(1, fps * DIFF_SAMPLE_S))

    results        = {}
    current_player = known_player
    analyzed       = 0

    print(f"  Dauer: {dur:.0f}s | FPS: {fps:.1f} | ~{est_checks} Pixel-Checks")
    print(f"  Diff-Schwelle: {DIFF_THRESH_LOW}%-{DIFF_THRESH_HIGH}% | Cooldown: {COOLDOWN_S}s")
    print()

    for frame_idx, t, frame, diff, stats in adaptive_frames(cap):
        pct = int(frame_idx / total * 100)
        print(f"  [{pct:3d}%] {t:5.1f}s  diff={diff:4.1f}%  ", end='', flush=True)

        b64          = frame_to_b64(frame)
        screen_type  = classify_fast(b64)
        print(f"-> {screen_type:<8} ", end='', flush=True)

        if screen_type == 'TROOPS':
            analyzed += 1
            data = parse_json(ask(b64, TROOPS_PROMPT))
            if data:
                pname = (data.get('player') or current_player or '').strip().strip('"')
                if not pname or pname.lower() == 'null':
                    pname = current_player or 'UNBEKANNT'
                if pname != 'UNBEKANNT':
                    if pname not in results:
                        results[pname] = {}
                    for tier in ['t1','t2','t3','t4']:
                        val = data.get(tier)
                        if isinstance(val, (int,float)) and val > 1000:
                            results[pname][tier] = round(val / 1e6, 2)
                    print(f"OK {pname}: "
                          f"T1={results[pname].get('t1','?')} "
                          f"T2={results[pname].get('t2','?')} "
                          f"T3={results[pname].get('t3','?')}")
                else:
                    print("WARNUNG Spielername unbekannt")
            else:
                print("FEHLER kein JSON")

        elif screen_type == 'POWER':
            analyzed += 1
            data = parse_json(ask(b64, POWER_PROMPT))
            if data and current_player:
                if current_player not in results:
                    results[current_player] = {}
                tp = data.get('total_power')
                if tp and tp > 1000:
                    results[current_player]['total_power'] = int(tp)
                    print(f"OK {current_player}: power={tp:,}")
                else:
                    print("FEHLER kein Wert")
            else:
                print("WARNUNG kein Spieler bekannt" if not current_player else "FEHLER")

        elif screen_type == 'PROFILE':
            analyzed += 1
            name = ask(b64, NAME_PROMPT).strip().strip('"')
            if name and name.lower() != 'null' and len(name) > 1:
                current_player = name
                print(f"OK Spieler: {current_player}")
            else:
                print("WARNUNG Name unlesbar")

        else:
            print("uebersprungen")

    cap.release()
    print()
    print(f"  Pixel-Checks: {stats['checked']} | "
          f"Ollama-Aufrufe: {stats['ollama']} | "
          f"Identisch: {stats['skipped_same']} | "
          f"Schnitte: {stats['skipped_cut']}")
    return results

# ── Match-Video Analyse ───────────────────────────────────────────────────────
def analyze_match_video(video_path):
    """
    Adaptives Sampling fuer Match-Videos (30min).
    Erkennt Zonen-Wechsel und kurz sichtbare Gegner-Profile automatisch.
    """
    cap   = cv2.VideoCapture(video_path)
    fps   = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    dur   = total / fps if fps > 0 else 0
    est_checks = int(total / max(1, fps * DIFF_SAMPLE_S))

    timeline     = []
    final_score  = None
    players_seen = set()
    troop_data   = {}   # Gegner-Truppendaten falls kurz sichtbar

    print(f"  Dauer: {dur:.0f}s ({dur/60:.1f}min) | ~{est_checks} Pixel-Checks")
    print()

    for frame_idx, t, frame, diff, stats in adaptive_frames(cap):
        pct = int(frame_idx / total * 100)
        print(f"  [{pct:3d}%] {t/60:4.1f}min  diff={diff:4.1f}%  ", end='', flush=True)

        b64         = frame_to_b64(frame)
        screen_type = classify_fast(b64)
        print(f"-> {screen_type:<8} ", end='', flush=True)

        if screen_type == 'BATTLE':
            data = parse_json(ask(b64, BATTLE_PROMPT, timeout=45))
            if data:
                entry = {'time_s': round(t), 'zones': data.get('zones', {})}
                pls = [p for p in data.get('players_visible',[]) if p]
                if pls:
                    entry['players'] = pls
                    players_seen.update(pls)
                timeline.append(entry)
                zstr = ' '.join(f"{k}={v}" for k,v in entry['zones'].items() if v and v != 'null')
                print(f"OK {zstr or '(keine Zonen)'}")
            else:
                print("FEHLER")

        elif screen_type == 'TROOPS':
            # Kurz sichtbares Gegner-Profil!
            data = parse_json(ask(b64, TROOPS_PROMPT))
            if data:
                pname = (data.get('player') or '').strip().strip('"')
                if pname and pname.lower() != 'null':
                    if pname not in troop_data:
                        troop_data[pname] = {}
                    for tier in ['t1','t2','t3','t4']:
                        val = data.get(tier)
                        if isinstance(val, (int,float)) and val > 1000:
                            troop_data[pname][tier] = round(val / 1e6, 2)
                    print(f"GEGNER {pname}: T1={troop_data[pname].get('t1','?')}")
                else:
                    print("OK (kein Name)")
            else:
                print("FEHLER")

        elif screen_type == 'SCORE':
            data = parse_json(ask(b64, SCORE_PROMPT, timeout=30))
            if data:
                final_score = data
                print(f"OK A={data.get('team_a_points')} B={data.get('team_b_points')} -> {data.get('winner')}")
            else:
                print("FEHLER")

        else:
            print("uebersprungen")

    cap.release()
    print()
    print(f"  Pixel-Checks: {stats['checked']} | Ollama: {stats['ollama']} | "
          f"Identisch: {stats['skipped_same']} | Schnitte: {stats['skipped_cut']}")

    return {
        'video':       os.path.basename(video_path),
        'duration_s':  round(dur),
        'analyzed_at': datetime.now().isoformat(),
        'timeline':    timeline,
        'final_score': final_score,
        'players_seen':list(players_seen),
        'troop_data':  troop_data,   # Gegner-Truppendaten
    }

# ── Upload ────────────────────────────────────────────────────────────────────
def upload_troop_results(results, dry_run=False):
    if not results:
        print("\n  Keine Daten.")
        return

    print("\n" + "="*60)
    print("ERGEBNISSE")
    print("="*60)
    for name, data in results.items():
        parts = [f"T{i+1}={data[f't{i+1}']}M" for i in range(4) if data.get(f't{i+1}')]
        tp = f"| Power={data['total_power']:,}" if data.get('total_power') else ''
        print(f"  {name:<22} {' '.join(parts)} {tp}")

    if dry_run:
        print("\n  [DRY RUN] kein Upload")
        return

    print()
    known = {p['name'] for p in (supa_get('ws_players?select=name') or [])}
    up = err = 0
    for name, data in results.items():
        update = {k: v for k, v in data.items() if v is not None}
        if not update:
            continue
        if name in known:
            ok = supa_patch('ws_players', name, update)
        else:
            print(f"  NEU: '{name}' wird angelegt")
            ok = supa_insert('ws_players', {'name': name, **update})
        print(f"  {'OK' if ok else 'FEHLER'}: {name}")
        if ok: up += 1
        else:  err += 1
    print(f"\n  {up} gespeichert, {err} Fehler")

def save_match_result(result, dry_run=False):
    fname = f"match_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(fname, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n  Gespeichert: {fname}")
    if result.get('final_score'):
        s = result['final_score']
        print(f"  Endstand: A={s.get('team_a_points','?')} | B={s.get('team_b_points','?')} | Sieger: {s.get('winner','?')}")
    if result.get('troop_data'):
        print(f"  Gegner-Truppendaten: {len(result['troop_data'])} Spieler erfasst")
        for name, td in result['troop_data'].items():
            parts = [f"T{i+1}={td[f't{i+1}']}M" for i in range(4) if td.get(f't{i+1}')]
            print(f"    {name}: {' '.join(parts)}")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(description='WarSync Video Analyzer v1.1')
    p.add_argument('input',           help='Video-Datei oder Ordner')
    p.add_argument('--player', '-p',  help='Spielername (fuer Profil-Videos)')
    p.add_argument('--mode',   '-m',  choices=['profile','match','auto'], default='auto')
    p.add_argument('--model',         default=VISION_MODEL, help=f'Ollama-Modell')
    p.add_argument('--diff-low',      type=float, default=DIFF_THRESH_LOW,
                   help=f'Diff-Schwelle unten %% (default {DIFF_THRESH_LOW})')
    p.add_argument('--diff-high',     type=float, default=DIFF_THRESH_HIGH,
                   help=f'Diff-Schwelle oben %% (default {DIFF_THRESH_HIGH})')
    p.add_argument('--cooldown',      type=float, default=COOLDOWN_S,
                   help=f'Cooldown Sekunden (default {COOLDOWN_S})')
    p.add_argument('--dry-run',       action='store_true')
    args = p.parse_args()

    global VISION_MODEL, DIFF_THRESH_LOW, DIFF_THRESH_HIGH, COOLDOWN_S
    VISION_MODEL     = args.model
    DIFF_THRESH_LOW  = args.diff_low
    DIFF_THRESH_HIGH = args.diff_high
    COOLDOWN_S       = args.cooldown

    print()
    print("WarSync Video Analyzer v1.1")
    print("="*40)
    print()

    if not ollama_available():
        print("FEHLER: Ollama laeuft nicht!")
        print("  ollama serve         -- Ollama starten")
        print("  ollama pull qwen2.5vl -- Modell laden")
        sys.exit(1)

    avail = ollama_models()
    if VISION_MODEL not in avail:
        print(f"FEHLER: Modell '{VISION_MODEL}' nicht installiert.")
        print(f"  ollama pull {VISION_MODEL}")
        print(f"  Verfuegbar: {', '.join(avail) or 'keine'}")
        sys.exit(1)

    print(f"OK Ollama: {VISION_MODEL}")
    print(f"OK Adaptiv: alle {DIFF_SAMPLE_S}s pruefen | "
          f"Diff {DIFF_THRESH_LOW}-{DIFF_THRESH_HIGH}% | Cooldown {COOLDOWN_S}s")
    print(f"OK Modus: {args.mode} | Dry-Run: {args.dry_run}")
    print()

    # Videos sammeln
    if os.path.isdir(args.input):
        videos = sorted(
            os.path.join(args.input, f) for f in os.listdir(args.input)
            if f.lower().endswith(('.mp4','.mov','.avi','.mkv','.m4v'))
        )
        print(f"Ordner: {len(videos)} Video(s)")
    else:
        if not os.path.exists(args.input):
            print(f"FEHLER: Datei nicht gefunden: {args.input}")
            sys.exit(1)
        videos = [args.input]

    all_troop = {}

    for i, vpath in enumerate(videos, 1):
        print(f"\n{'='*60}")
        print(f"Video {i}/{len(videos)}: {os.path.basename(vpath)}")
        print('='*60)

        # Modus bestimmen
        mode = args.mode
        if mode == 'auto':
            cap = cv2.VideoCapture(vpath)
            dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(cap.get(cv2.CAP_PROP_FPS), 1)
            cap.release()
            mode = 'profile' if dur < 300 else 'match'
            print(f"Auto: {mode} ({dur:.0f}s)")

        t0 = time.time()

        if mode == 'profile':
            results = analyze_profile_video(vpath, known_player=args.player)
            all_troop.update(results)
        else:
            result = analyze_match_video(vpath)
            save_match_result(result, dry_run=args.dry_run)
            # Gegner-Truppendaten auch in Supabase speichern
            if result.get('troop_data'):
                upload_troop_results(result['troop_data'], dry_run=args.dry_run)

        print(f"\n  Laufzeit: {time.time()-t0:.0f}s")

    if all_troop:
        upload_troop_results(all_troop, dry_run=args.dry_run)

    print("\nFertig!\n")

if __name__ == '__main__':
    main()
