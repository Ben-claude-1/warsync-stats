#!/usr/bin/env python3
"""
WarSync Video Analyzer v1.0
============================
Analysiert Spielvideos (Bildschirmaufnahmen) und extrahiert automatisch
Truppendaten (T1/T2/T3/T4) sowie Match-Daten via Ollama Vision-KI.

Voraussetzungen (siehe setup_mac.sh):
  - Python 3.12+
  - Ollama mit qwen2.5vl oder llava
  - pip: opencv-python pillow

Verwendung:
  python3 warsync_analyzer.py profil.mp4                        # eigenes Profil
  python3 warsync_analyzer.py profil.mp4 --player Ben_the_men   # Spielername bekannt
  python3 warsync_analyzer.py match.mp4 --mode match            # Kampf-Analyse
  python3 warsync_analyzer.py profil.mp4 --dry-run              # Test ohne DB-Upload
  python3 warsync_analyzer.py ordner/                           # ganzen Ordner verarbeiten
"""

import cv2
import base64
import json
import os
import sys
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime

# ── Konfiguration ─────────────────────────────────────────────────────────────
OLLAMA_URL       = "http://localhost:11434"
VISION_MODEL     = "qwen2.5vl"   # Alternativ: "llava" — qwen2.5vl besser für Zahlen
SAMPLE_INTERVAL  = 5             # Sekunden zwischen Frame-Analysen
SKIP_INTERVAL    = 1             # Sekunden zwischen Screen-Typ-Checks (schneller)

SUPA_URL = 'https://ktdzxhyuvukontcxghte.supabase.co'
SUPA_KEY = 'sb_publishable_e88gpqka1Iom849Ope2mFw_i8tSWCS8'

# ── Supabase ──────────────────────────────────────────────────────────────────
def supa_get(path):
    req = urllib.request.Request(
        f'{SUPA_URL}/rest/v1/{path}',
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                 'Accept': 'application/json'}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'msg': e.read().decode()}

def supa_patch(table, name, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{SUPA_URL}/rest/v1/{table}?name=eq.{urllib.parse.quote(name)}',
        data=body, method='PATCH',
        headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
    )
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
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
    )
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
        resp = urllib.request.urlopen(f'{OLLAMA_URL}/api/tags', timeout=3)
        data = json.loads(resp.read())
        return [m['name'].split(':')[0] for m in data.get('models', [])]
    except:
        return []

def frame_to_b64(frame):
    _, buf = cv2.imencode('.png', frame)
    return base64.b64encode(buf.tobytes()).decode()

def ask(image_b64, prompt, timeout=60):
    """Ollama Vision-Anfrage — gibt Text-Antwort zurück"""
    body = json.dumps({
        "model": VISION_MODEL,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
        "options": {"temperature": 0, "seed": 42}
    }).encode()
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/generate', data=body,
        headers={'Content-Type': 'application/json'}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(resp.read()).get('response', '').strip()
    except Exception as e:
        return f"ERROR: {e}"

def parse_json(text):
    """JSON aus Antwort extrahieren — robust gegen Umgebungstext"""
    try:
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except:
        pass
    return None

# ── Prompts ───────────────────────────────────────────────────────────────────

CLASSIFY_PROMPT = """Look at this mobile game screenshot. Reply with ONLY one word:
TROOPS   — if you see troop groups "Erste Truppe", "Zweite Truppe", "Dritte Truppe" with numbers
POWER    — if you see "Details der Kampfkraft" popup/dialog
PROFILE  — if you see a player profile page with a player name
BATTLE   — if you see a war/battle map with colored zones or territories
SCORE    — if you see a scoreboard or final results with points
OTHER    — anything else
Reply with exactly one word."""

TROOPS_PROMPT = """This is a mobile game screenshot showing troop formation groups.
Extract the combat power number shown next to each troop group.

The groups are usually labeled:
- "Erste Truppe" (First Group) — this is T1
- "Zweite Truppe" (Second Group) — this is T2
- "Dritte Truppe" (Third Group) — this is T3
- "Vierte Truppe" (Fourth Group) — this is T4 (may not exist)

Also look for the player name at the very top of the screen.

Return ONLY valid JSON, nothing else:
{"player": "name_or_null", "t1": integer_or_null, "t2": integer_or_null, "t3": integer_or_null, "t4": integer_or_null}

Example: {"player": "Ben_the_men", "t1": 27252394, "t2": 21437261, "t3": 20011929, "t4": null}
Use raw integers without dots or commas. null if not visible."""

POWER_PROMPT = """This is a "Details der Kampfkraft" (Combat Power Details) screen.
Extract these values (raw integers, no formatting):
- The total power shown at top of screen
- "Einheiten-Kampfkraft" (Units Combat Power)

Return ONLY valid JSON:
{"total_power": integer_or_null, "units_power": integer_or_null}"""

BATTLE_PROMPT = """This is a war/battle map screenshot from a mobile strategy game.
Identify:
1. Which zones/territories are visible (e.g. Zone 1, Zone 3, Silo, etc.)
2. For each zone: which team controls it (Team A=blue or Team B=red, or neutral)
3. Any player names visible near zones

Return ONLY valid JSON:
{"zones": {"z1": "A/B/neutral", "z2": "A/B/neutral", "z3": "A/B/neutral", "z4": "A/B/neutral", "z5": "A/B/neutral"}, "players_visible": ["name1", "name2"]}
Use null for zones not visible. Only include zones you can clearly identify."""

SCORE_PROMPT = """This screenshot shows a scoreboard or results screen from a war game.
Extract team scores/points if visible.
Return ONLY valid JSON:
{"team_a_points": integer_or_null, "team_b_points": integer_or_null, "winner": "A/B/null"}"""

NAME_PROMPT = """What is the player name shown in this game profile screen?
Reply with ONLY the player name, nothing else. If no name is visible, reply: null"""

# ── Profil-Video Analyse ──────────────────────────────────────────────────────
def analyze_profile_video(video_path, known_player=None, dry_run=False):
    """
    Analysiert ein Profil-Video (Spieler scrollt durch Truppen/Kampfkraft-Screens).
    Extrahiert T1/T2/T3/T4 und total_power.
    """
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = total / fps if fps > 0 else 0

    check_interval = max(1, int(fps * SKIP_INTERVAL))
    detail_interval = max(1, int(fps * SAMPLE_INTERVAL))

    results = {}
    current_player = known_player
    frame_idx = 0
    analyzed = 0
    skipped_other = 0

    print(f"  Dauer: {duration:.0f}s | FPS: {fps:.1f} | Frames zu prüfen: ~{int(total/check_interval)}")
    print()

    while frame_idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break

        t = frame_idx / fps
        pct = int(frame_idx / total * 100)
        print(f"  [{pct:3d}%] {t:5.1f}s", end=' ', flush=True)

        b64 = frame_to_b64(frame)
        screen_type = classify_fast(b64)
        print(f"-> {screen_type:<8}", end=' ', flush=True)

        if screen_type == 'TROOPS':
            analyzed += 1
            data = parse_json(ask(b64, TROOPS_PROMPT))
            if data:
                pname = (data.get('player') or current_player or '').strip()
                if not pname or pname == 'null':
                    pname = current_player or 'UNBEKANNT'
                if pname and pname != 'UNBEKANNT':
                    if pname not in results:
                        results[pname] = {}
                    for tier in ['t1','t2','t3','t4']:
                        val = data.get(tier)
                        if val and isinstance(val, (int,float)) and val > 1000:
                            results[pname][tier] = round(val / 1e6, 2)
                    print(f"OK {pname}: T1={results[pname].get('t1','?')} T2={results[pname].get('t2','?')} T3={results[pname].get('t3','?')}")
                else:
                    print("WARNUNG Spielername unbekannt")
            else:
                print("FEHLER keine Daten extrahiert")
            frame_idx += detail_interval

        elif screen_type == 'POWER':
            analyzed += 1
            data = parse_json(ask(b64, POWER_PROMPT))
            if data and current_player:
                if current_player not in results:
                    results[current_player] = {}
                if data.get('total_power') and data['total_power'] > 1000:
                    results[current_player]['total_power'] = int(data['total_power'])
                    print(f"OK {current_player}: power={data['total_power']:,}")
                else:
                    print("FEHLER kein Power-Wert")
            else:
                print(f"WARNUNG Spieler unbekannt" if not current_player else "FEHLER Parse-Fehler")
            frame_idx += detail_interval

        elif screen_type == 'PROFILE':
            analyzed += 1
            name = ask(b64, NAME_PROMPT).strip().replace('"','')
            if name and name.lower() != 'null' and len(name) > 1:
                current_player = name
                print(f"OK Spieler: {current_player}")
            else:
                print("WARNUNG Name nicht lesbar")
            frame_idx += check_interval

        else:
            skipped_other += 1
            print("uebersprungen")
            frame_idx += check_interval

    cap.release()
    print()
    print(f"  Analysiert: {analyzed} relevante Frames, {skipped_other} uebersprungen")
    return results

def classify_fast(b64):
    resp = ask(b64, CLASSIFY_PROMPT, timeout=30).upper()
    for t in ['TROOPS','POWER','PROFILE','BATTLE','SCORE']:
        if t in resp:
            return t
    return 'OTHER'

# ── Match-Video Analyse ───────────────────────────────────────────────────────
def analyze_match_video(video_path, dry_run=False):
    """
    Analysiert ein 30-minutiges Match-Video.
    Extrahiert Zonen-Kontrolle, Spieler-Positionen, Endpunkte.
    """
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    duration = total / fps if fps > 0 else 0

    interval = max(1, int(fps * 10))
    frame_idx = 0
    timeline = []
    final_score = None
    players_seen = set()

    print(f"  Dauer: {duration:.0f}s | Analyse alle 10s | ~{int(total/interval)} Checkpoints")
    print()

    while frame_idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break

        t = frame_idx / fps
        pct = int(frame_idx / total * 100)
        print(f"  [{pct:3d}%] {t/60:.1f}min", end=' ', flush=True)

        b64 = frame_to_b64(frame)
        screen_type = classify_fast(b64)
        print(f"-> {screen_type:<8}", end=' ', flush=True)

        if screen_type == 'BATTLE':
            data = parse_json(ask(b64, BATTLE_PROMPT, timeout=45))
            if data:
                entry = {'time_s': round(t), 'zones': data.get('zones',{})}
                players = data.get('players_visible', [])
                if players:
                    entry['players'] = players
                    players_seen.update(players)
                timeline.append(entry)
                zones_str = ' '.join(f"{k}={v}" for k,v in (data.get('zones') or {}).items() if v)
                print(f"OK {zones_str or 'keine Zonen'}")
            else:
                print("FEHLER Parse-Fehler")

        elif screen_type == 'SCORE':
            data = parse_json(ask(b64, SCORE_PROMPT, timeout=30))
            if data:
                final_score = data
                print(f"OK A={data.get('team_a_points')} B={data.get('team_b_points')} Sieger={data.get('winner')}")
            else:
                print("FEHLER Parse-Fehler")
        else:
            print("uebersprungen")

        frame_idx += interval

    cap.release()

    match_result = {
        'video': os.path.basename(video_path),
        'duration_s': round(duration),
        'analyzed_at': datetime.now().isoformat(),
        'timeline': timeline,
        'final_score': final_score,
        'players_seen': list(players_seen),
    }

    print()
    print(f"  Timeline: {len(timeline)} Snapshots")
    if players_seen:
        print(f"  Spieler gesehen: {', '.join(players_seen)}")
    if final_score:
        print(f"  Endstand: Team A={final_score.get('team_a_points')} | Team B={final_score.get('team_b_points')}")

    return match_result

# ── Upload ────────────────────────────────────────────────────────────────────
def upload_troop_results(results, dry_run=False):
    if not results:
        print("\n  Keine Daten zum Hochladen.")
        return

    print("\n" + "="*60)
    print("ERGEBNISSE")
    print("="*60)
    for name, data in results.items():
        parts = [f"T{i+1}={data[f't{i+1}']}M" for i in range(4) if data.get(f't{i+1}')]
        tp = f"Power={data['total_power']:,}" if data.get('total_power') else ''
        print(f"  {name:<22} {' | '.join(parts)} {tp}")

    if dry_run:
        print("\n  [DRY RUN] Kein Upload")
        return

    print()
    existing_raw = supa_get('ws_players?select=name')
    known = {p['name'] for p in existing_raw} if isinstance(existing_raw, list) else set()

    uploaded = skipped = 0
    for name, data in results.items():
        update = {k: v for k, v in data.items() if v is not None}
        if not update:
            continue
        if name in known:
            ok = supa_patch('ws_players', name, update)
            tag = "OK aktualisiert" if ok else "FEHLER"
        else:
            print(f"  WARNUNG '{name}' nicht in DB -- wird neu angelegt")
            ok = supa_insert('ws_players', {'name': name, **update})
            tag = "OK neu angelegt" if ok else "FEHLER"
        print(f"  {tag}: {name}")
        if ok: uploaded += 1
        else: skipped += 1

    print(f"\n  {uploaded} Spieler gespeichert, {skipped} Fehler")

def save_match_result(match_result, dry_run=False):
    out = f"match_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(match_result, f, ensure_ascii=False, indent=2)
    print(f"\n  Match-Daten gespeichert: {out}")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='WarSync Video Analyzer')
    parser.add_argument('input', help='Video-Datei oder Ordner mit Videos')
    parser.add_argument('--player', '-p', help='Bekannter Spielername (bei Profil-Videos)')
    parser.add_argument('--mode', '-m', choices=['profile','match','auto'],
                        default='auto', help='Analyse-Modus (default: auto)')
    parser.add_argument('--model', default=VISION_MODEL,
                        help=f'Ollama-Modell (default: {VISION_MODEL})')
    parser.add_argument('--interval', '-i', type=int, default=SAMPLE_INTERVAL,
                        help=f'Sekunden zwischen Frames (default: {SAMPLE_INTERVAL})')
    parser.add_argument('--dry-run', action='store_true',
                        help='Kein Datenbank-Upload, nur Anzeige')
    args = parser.parse_args()

    global VISION_MODEL, SAMPLE_INTERVAL
    VISION_MODEL = args.model
    SAMPLE_INTERVAL = args.interval

    print()
    print("WarSync Video Analyzer v1.0")
    print("="*40)
    print()

    if not ollama_available():
        print("FEHLER Ollama laeuft nicht!")
        print("  Starte Ollama: ollama serve")
        print("  Modell laden:  ollama pull qwen2.5vl")
        sys.exit(1)

    models = ollama_models()
    if VISION_MODEL not in models:
        print(f"FEHLER Modell '{VISION_MODEL}' nicht installiert!")
        print(f"  Installieren: ollama pull {VISION_MODEL}")
        print(f"  Verfuegbar: {', '.join(models) or 'keine'}")
        sys.exit(1)

    print(f"OK Ollama: {VISION_MODEL}")
    print(f"OK Modus: {args.mode} | Interval: {SAMPLE_INTERVAL}s | Dry-Run: {args.dry_run}")
    print()

    videos = []
    if os.path.isdir(args.input):
        for f in sorted(os.listdir(args.input)):
            if f.lower().endswith(('.mp4','.mov','.avi','.mkv','.m4v')):
                videos.append(os.path.join(args.input, f))
        print(f"Ordner: {len(videos)} Video(s) gefunden")
    else:
        if not os.path.exists(args.input):
            print(f"FEHLER Datei nicht gefunden: {args.input}")
            sys.exit(1)
        videos = [args.input]

    all_troop_results = {}

    for i, vpath in enumerate(videos, 1):
        print(f"\n{'='*60}")
        print(f"Video {i}/{len(videos)}: {os.path.basename(vpath)}")
        print(f"{'='*60}")

        mode = args.mode
        if mode == 'auto':
            cap = cv2.VideoCapture(vpath)
            dur = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(cap.get(cv2.CAP_PROP_FPS),1)
            cap.release()
            mode = 'profile' if dur < 300 else 'match'
            print(f"Auto-Modus erkannt: {mode} ({dur:.0f}s)")

        t_start = time.time()

        if mode == 'profile':
            results = analyze_profile_video(vpath, known_player=args.player, dry_run=args.dry_run)
            all_troop_results.update(results)
        else:
            match_result = analyze_match_video(vpath, dry_run=args.dry_run)
            save_match_result(match_result, dry_run=args.dry_run)

        elapsed = time.time() - t_start
        print(f"\n  Verarbeitungszeit: {elapsed:.0f}s")

    if all_troop_results:
        upload_troop_results(all_troop_results, dry_run=args.dry_run)

    print("\nFertig!\n")

if __name__ == '__main__':
    main()
