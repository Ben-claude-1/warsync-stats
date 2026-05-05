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
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)
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
    resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
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

@app.route('/analyze', methods=['POST'])
def analyze():
    """Wüstensturm-Ergebnis analysieren (Gegner, Punkte, Spieler-Ranking)."""
    data = request.get_json(force=True)
    images = data.get('images', [])
    known_players = data.get('known_players', [])
    if not images:
        return jsonify({'error': 'Keine Bilder'}), 400

    known_str = ', '.join(known_players) if known_players else '(keine Liste)'
    prompt = f"""Analysiere den/die Screenshot(s) aus dem Mobile-Game "Last War: Survival", Wüstensturm-Event.

Antworte NUR mit diesem JSON:
{{
  "opponent": "Name der gegnerischen Allianz oder null",
  "our_pts": Unsere Gesamtpunktzahl als Integer,
  "opp_pts": Gegner-Gesamtpunktzahl als Integer,
  "result": "win" oder "loss" oder null,
  "players": [
    {{"name": "Spielername", "pts": Punkte als Integer, "rank": Platzierung als Integer oder null}}
  ]
}}

Bekannte Spielernamen: {known_str}
Zahlen ohne Tausendertrennzeichen (z.B. 327675).
NUR das JSON ausgeben."""

    try:
        text = _call_ollama(images, prompt)
        return jsonify(_extract_json(text))
    except json.JSONDecodeError as e:
        return jsonify({'error': f'JSON-Parse-Fehler: {e}'}), 500
    except requests.RequestException as e:
        return jsonify({'error': f'Ollama nicht erreichbar: {e}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/analyze-vs', methods=['OPTIONS'])
def analyze_vs_preflight():
    return '', 204

@app.route('/analyze-vs', methods=['POST'])
def analyze_vs():
    """VS-Duell Wochen-Rang analysieren (Spieler + Punkte)."""
    data = request.get_json(force=True)
    images = data.get('images', [])
    known_players = data.get('known_players', [])
    if not images:
        return jsonify({'error': 'Keine Bilder'}), 400

    known_str = ', '.join(known_players) if known_players else '(keine Liste)'
    prompt = f"""Analysiere den/die Screenshot(s) aus dem Mobile-Game "Last War: Survival", VS-Duell Wochen-Rang.

Der Screenshot zeigt eine Rangliste: Rang | Kommandant (Name oben, Allianz-Tag darunter) | Punkte.

Antworte NUR mit diesem JSON:
{{
  "players": [
    {{"name": "Spielername (NUR Name, KEIN Allianz-Tag wie [AR1S])", "pts": Punktzahl als Integer, "rank": Platzierung als Integer}}
  ]
}}

Bekannte Spielernamen: {known_str}
Punkte im deutschen Format (137.003.868) → als Integer 137003868.
NUR das JSON ausgeben."""

    try:
        text = _call_ollama(images, prompt)
        return jsonify(_extract_json(text))
    except json.JSONDecodeError as e:
        return jsonify({'error': f'JSON-Parse-Fehler: {e}'}), 500
    except requests.RequestException as e:
        return jsonify({'error': f'Ollama nicht erreichbar: {e}'}), 500
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
    __import__('flask').Flask.run(app, host='0.0.0.0', port=port, debug=False)
