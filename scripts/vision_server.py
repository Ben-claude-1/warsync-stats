#!/usr/bin/env python3
"""
WarSync Vision Server – analysiert Last-War-Screenshots via Claude API
und gibt strukturierte Ergebnisdaten zurück.

Voraussetzungen:
    pip install anthropic flask

Starten:
    ANTHROPIC_API_KEY=sk-ant-... python3 scripts/vision_server.py

Tailscale Funnel (einmalig einrichten):
    sudo tailscale funnel --bg --https=8444 8444
"""

import json
import os
import sys
from flask import Flask, request, jsonify
import anthropic

app = Flask(__name__)

# CORS: Erlaubt Anfragen von GitHub Pages und lokalen Dev-Servern
@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    return resp

@app.route('/analyze', methods=['OPTIONS'])
def analyze_preflight():
    return '', 204

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.get_json(force=True)
    images = data.get('images', [])
    known_players = data.get('known_players', [])

    if not images:
        return jsonify({'error': 'Keine Bilder übermittelt'}), 400

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return jsonify({'error': 'ANTHROPIC_API_KEY nicht gesetzt'}), 500

    client = anthropic.Anthropic(api_key=api_key)

    known_str = ', '.join(known_players) if known_players else '(keine Liste)'
    prompt = f"""Analysiere den/die Screenshot(s) aus dem Mobile-Game "Last War: Survival", Wüstensturm-Event (Desert Storm / WS).

Extrahiere alle sichtbaren Daten und antworte NUR mit einem JSON-Objekt:

{{
  "opponent": "Name der gegnerischen Allianz (String oder null)",
  "our_pts": Unsere Gesamtpunktzahl als Integer (keine Trennzeichen),
  "opp_pts": Gegner-Gesamtpunktzahl als Integer,
  "result": "win" oder "loss" oder null,
  "players": [
    {{
      "name": "Spielername (aus bekannter Liste, s.u.)",
      "pts": Individuelle Punkte als Integer,
      "rank": Platzierung im Ranking als Integer oder null
    }}
  ]
}}

Bekannte Spielernamen (möglichst auf diese mappen):
{known_str}

Hinweise:
- Zahlen ohne Tausendertrennzeichen (z.B. 327675, nicht 327.675)
- Screenshot-Namen so gut wie möglich auf die bekannten Namen mappen (Ähnlichkeit, Teilstrings)
- Wenn kein Ranking-Screen sichtbar: players = []
- Fehlende Felder auf null setzen
- NUR das JSON zurückgeben, keine Erklärungen"""

    content = []
    for img in images:
        # Datentyp aus Data-URL extrahieren oder JPEG annehmen
        media_type = 'image/jpeg'
        b64 = img
        if img.startswith('data:'):
            header, b64 = img.split(',', 1)
            if 'png' in header:
                media_type = 'image/png'
            elif 'webp' in header:
                media_type = 'image/webp'
            elif 'gif' in header:
                media_type = 'image/gif'
        content.append({
            'type': 'image',
            'source': {'type': 'base64', 'media_type': media_type, 'data': b64}
        })
    content.append({'type': 'text', 'text': prompt})

    try:
        msg = client.messages.create(
            model='claude-opus-4-5',
            max_tokens=1024,
            messages=[{'role': 'user', 'content': content}]
        )
        text = msg.content[0].text.strip()
        # JSON aus Antwort extrahieren (falls Markdown-Block)
        if '```' in text:
            text = text.split('```')[1]
            if text.startswith('json'):
                text = text[4:]
        result = json.loads(text.strip())
        return jsonify(result)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'JSON-Parse-Fehler: {e}', 'raw': text[:500]}), 500
    except anthropic.APIError as e:
        return jsonify({'error': f'Anthropic API: {e}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'api_key_set': bool(os.environ.get('ANTHROPIC_API_KEY'))})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8444))
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('FEHLER: ANTHROPIC_API_KEY Umgebungsvariable fehlt!', file=sys.stderr)
        print('  Starten mit: ANTHROPIC_API_KEY=sk-ant-... python3 scripts/vision_server.py', file=sys.stderr)
        sys.exit(1)
    print(f'Vision Server läuft auf Port {port}')
    print(f'Health: http://localhost:{port}/health')
    app.run(host='0.0.0.0', port=port, debug=False)
