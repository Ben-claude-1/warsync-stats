#!/usr/bin/env python3
"""
WarSync Vision Server – analysiert Last-War-Screenshots via lokales Ollama
(qwen2.5vl:7b, num_ctx=4096). Kein Anthropic-API-Key erforderlich.

Voraussetzungen:
    pip install flask requests
    Ollama läuft lokal mit: ollama run qwen2.5vl:7b

Starten:
    python3 scripts/vision_server.py

Tailscale Funnel (einmalig):
    sudo tailscale funnel --bg --https=8444 8444
"""

import json
import sys
import re
import traceback
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB
OLLAMA_URL = 'http://localhost:11434/api/chat'
MODEL = 'qwen2.5vl:7b'

@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    return resp


def _b64(img: str) -> str:
    """Entfernt data:-Prefix und gibt reines Base64 zurück."""
    if img.startswith('data:'):
        return img.split(',', 1)[1]
    return img


def _call_ollama(images: list, prompt: str) -> str:
    """Ruft Ollama mit Vision-Modell auf und gibt den Text zurück."""
    payload = {
        'model': MODEL,
        'messages': [{
            'role': 'user',
            'content': prompt,
            'images': [_b64(img) for img in images]
        }],
        'stream': False,
        'options': {'num_ctx': 4096}
    }
    resp = requests.post(OLLAMA_URL, json=payload, timeout=300)
    if not resp.ok:
        body = resp.text[:500]
        print(f'[Ollama] {resp.status_code}: {body}', file=sys.stderr)
        resp.raise_for_status()
    return resp.json()['message']['content']


def _extract_json(text: str) -> dict:
    """Extrahiert JSON aus Modellantwort (auch wenn in Markdown-Block)."""
    text = text.strip()
    if '```' in text:
        text = text.split('```')[1]
        if text.startswith('json'):
            text = text[4:]
        text = text.strip()
    # Fallback: ersten { ... } Block suchen
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if m:
        text = m.group(0)
    return json.loads(text)


@app.route('/analyze', methods=['OPTIONS'])
def analyze_preflight():
    return '', 204

MEMBER_PROMPT = """This is a screenshot from the mobile game "Last War: Survival" showing an alliance member list.

Extract ALL visible player names. Return ONLY this JSON (no markdown, no explanation):
{
  "players": [
    {"name": "PlayerName"}
  ]
}

Rules:
- Extract every visible name, even if partially cut off
- Do NOT include alliance tags like [AR1S] in the name
- Output ONLY the JSON"""

@app.route('/analyze', methods=['POST'])
def analyze():
    """Allianzmitglieder aus Screenshot analysieren."""
    data = request.get_json(force=True)
    images = data.get('images', [])
    if not images:
        return jsonify({'error': 'Keine Bilder'}), 400

    all_players = []
    seen = set()
    warnings = []

    for i, img in enumerate(images):
        try:
            text = _call_ollama([img], MEMBER_PROMPT)
            r = _extract_json(text)
            for p in r.get('players', []):
                name = (p.get('name') or '').strip()
                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    all_players.append(p)
        except Exception as e:
            warnings.append(f'Bild {i+1}: {e}')

    result = {'players': all_players}
    if warnings:
        result['warnings'] = warnings
    return jsonify(result)


@app.route('/analyze-ws', methods=['OPTIONS'])
def analyze_ws_preflight():
    return '', 204

WS_PROMPT = """Analysiere diesen Screenshot aus dem Mobile-Game "Last War: Survival", Wüstensturm-Event.

Der Screenshot zeigt eine oder mehrere dieser Ansichten:
- Rangliste der Spieler mit individuellen Punkten (Spalten: Rang / Name / Punkte)
- Gesamtergebnis: Unsere Allianz vs. Gegner-Allianz mit Gesamtpunkten
- Teilnehmerliste ohne Punktzahlen

Extrahiere ALLE sichtbaren Spielernamen und ihre Punkte.

Antworte NUR mit diesem JSON (kein Markdown, kein Text davor/danach):
{
  "opponent": "Name der gegnerischen Allianz oder null",
  "our_pts": Unsere Gesamtpunktzahl als Integer oder null,
  "opp_pts": Gegner-Gesamtpunktzahl als Integer oder null,
  "result": "win" oder "loss" oder null,
  "players": [
    {"name": "Spielername", "pts": Individuelle Punkte als Integer oder null, "rank": Platzierung als Integer oder null}
  ]
}

Regeln:
- ALLE sichtbaren Spieler extrahieren, nicht nur die ersten paar
- Allianz-Tags in eckigen Klammern (z.B. [AR1S]) NICHT in den Namen aufnehmen
- Punkte mit Punkt als Tausendertrennzeichen → Integer (z.B. 327.675 → 327675)
- Falls kein Punktwert sichtbar, pts auf null setzen
- NUR das JSON ausgeben"""

@app.route('/analyze-ws', methods=['POST'])
def analyze_ws():
    """Wüstensturm-Ergebnis analysieren – jedes Bild einzeln, dann zusammenführen."""
    data = request.get_json(force=True)
    images = data.get('images', [])
    if not images:
        return jsonify({'error': 'Keine Bilder'}), 400

    combined = {'opponent': None, 'our_pts': None, 'opp_pts': None, 'result': None, 'players': []}
    seen_players = set()
    warnings = []

    for i, img in enumerate(images):
        try:
            text = _call_ollama([img], WS_PROMPT)
            r = _extract_json(text)
            if r.get('opponent') and not combined['opponent']:
                combined['opponent'] = r['opponent']
            if r.get('our_pts') is not None and combined['our_pts'] is None:
                combined['our_pts'] = r['our_pts']
            if r.get('opp_pts') is not None and combined['opp_pts'] is None:
                combined['opp_pts'] = r['opp_pts']
            if r.get('result') and not combined['result']:
                combined['result'] = r['result']
            for p in r.get('players', []):
                name = (p.get('name') or '').strip()
                if name and name.lower() not in seen_players:
                    seen_players.add(name.lower())
                    combined['players'].append(p)
        except Exception as e:
            warnings.append(f'Bild {i+1}: {e}')
            print(f'[analyze-ws] Bild {i+1} Fehler: {e}', file=sys.stderr)

    if warnings:
        combined['warnings'] = warnings
    return jsonify(combined)


@app.route('/analyze-vs', methods=['OPTIONS'])
def analyze_vs_preflight():
    return '', 204

VS_PROMPT = """Analysiere diesen Screenshot aus dem Mobile-Game "Last War: Survival", VS-Duell Wochen-Rang.

Der Screenshot zeigt eine Rangliste mit Zeilen: Rang | Spielername (oben) + Allianz-Tag (darunter) | Punkte.
Extrahiere JEDEN sichtbaren Spieler vollständig.

Antworte NUR mit diesem JSON (kein Markdown, kein Text davor/danach):
{
  "players": [
    {"name": "Spielername (NUR der Name, OHNE Allianz-Tag wie [AR1S])", "pts": Punktzahl als Integer, "rank": Platzierung als Integer}
  ]
}

Regeln:
- Allianz-Tags in eckigen Klammern NICHT in den Namen aufnehmen
- Punkte: deutsches Format 137.003.868 → Integer 137003868
- Alle sichtbaren Zeilen extrahieren, auch wenn viele
- NUR das JSON ausgeben"""

@app.route('/analyze-vs', methods=['POST'])
def analyze_vs():
    """VS-Duell Wochen-Rang analysieren – jedes Bild einzeln, Ergebnisse zusammenführen."""
    data = request.get_json(force=True)
    images = data.get('images', [])
    if not images:
        return jsonify({'error': 'Keine Bilder'}), 400

    all_players = []
    seen = set()
    warnings = []
    per_image = []

    for i, img in enumerate(images):
        try:
            text = _call_ollama([img], VS_PROMPT)
            result = _extract_json(text)
            found = []
            for p in result.get('players', []):
                name = (p.get('name') or '').strip()
                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    all_players.append(p)
                    found.append(name)
            per_image.append(f'Bild {i+1}: {len(found)} Spieler')
        except Exception as e:
            warnings.append(f'Bild {i+1}: Fehler – {e}')
            per_image.append(f'Bild {i+1}: Fehler')

    resp = {'players': all_players, 'per_image': per_image}
    if warnings:
        resp['warnings'] = warnings
    return jsonify(resp)


STRENGTH_PROMPT = """This is a Last War game screenshot showing troop defense setup. Find the troop counts for: Erste Truppe (T1), Zweite Truppe (T2), Dritte Truppe (T3), Vierte Truppe (T4). Each has a number below the label. Return ONLY valid JSON with no explanation: {"t1":NUMBER,"t2":NUMBER,"t3":NUMBER,"t4":NUMBER} using the raw integer values. Omit any troop type not visible."""

@app.route('/analyze-strength', methods=['OPTIONS'])
def analyze_strength_preflight():
    return '', 204

@app.route('/analyze-strength', methods=['POST'])
def analyze_strength():
    """Truppenstärke aus Screenshot lesen."""
    data = request.get_json(force=True)
    image = data.get('image')
    if not image:
        return jsonify({'error': 'Kein Bild'}), 400
    try:
        text = _call_ollama([image], STRENGTH_PROMPT)
        result = _extract_json(text)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    try:
        r = requests.get('http://localhost:11434/api/tags', timeout=3)
        models = [m['name'] for m in r.json().get('models', [])]
        return jsonify({'status': 'ok', 'ollama': True, 'models': models})
    except Exception as e:
        return jsonify({'status': 'ok', 'ollama': False, 'error': str(e)})


if __name__ == '__main__':
    port = int(__import__('os').environ.get('PORT', 8444))
    print(f'WarSync Vision Server (Ollama/{MODEL}) auf Port {port}')
    print(f'Health: http://localhost:{port}/health')
    print('Tailscale Funnel: sudo tailscale funnel --bg --https=8444 8444')
    __import__('flask').Flask.run(app, host='127.0.0.1', port=port, debug=False)
