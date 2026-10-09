"""Review-Seite fuers Handy: Suchlauf-Belege ansehen und korrigieren.

Der Suchlauf (`suchlauf.py`) schlaegt jeden Kadernamen einzeln im Spiel nach
und legt je Spieler eine Beleg-Tafel ab (`belege.py`) — bei zwei Zeit-Balken
(„beide Zeiten gemeldet") stehen beide Ausschnitte schon uebereinander auf
einem Bild. Dieser Dienst macht daraus eine Seite, auf der man jeden Beleg
sieht und den Wert pro Spieler von Hand uebersteuern kann, bevor irgendetwas
ins Tool geschrieben wird.

    .venv/bin/python -m scripts.ws_service.review_server     # Port 8852

Korrekturen landen in `belege/korrekturen.json` im jeweiligen Laufordner —
nicht sofort in der Datenbank. Erst „Ins Tool uebernehmen" schreibt
(ersetzend, mit Sicherung vorher — wie `suchlauf.py --schreiben`).
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

from . import tool

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "ws_service"

# (Wert, Beschriftung) — dieselben sieben REG_WERTE wie in src/core/rotation.js,
# plus der leere Wert fuer "nicht angemeldet".
WERTE = [
    ("", "nicht angemeldet"),
    ("A", "A — gesetzt"),
    ("AE", "A — Ersatz"),
    ("AC", "A — angemeldet, kein Platz"),
    ("B", "B — gesetzt"),
    ("BE", "B — Ersatz"),
    ("BC", "B — angemeldet, kein Platz"),
    ("ABC", "beide Zeiten — kein Platz"),
]

app = Flask(__name__)


def _laeufe() -> list[Path]:
    return sorted((p for p in BERICHTE.glob("suche_*") if p.is_dir()), reverse=True)


def _lauf(stempel: str | None) -> Path:
    if stempel:
        p = BERICHTE / stempel
        if not p.is_dir():
            abort(404)
        return p
    laeufe = _laeufe()
    if not laeufe:
        abort(404, "Kein Suchlauf unter " + str(BERICHTE) + " gefunden.")
    return laeufe[0]


def _json(pfad: Path, default):
    return json.loads(pfad.read_text()) if pfad.exists() else default


def _korrekturen_pfad(lauf: Path) -> Path:
    return lauf / "belege" / "korrekturen.json"


@app.get("/")
def seite():
    lauf = _lauf(request.args.get("lauf"))
    idx = _json(lauf / "belege" / "index.json", {"spieler": {}, "ohne_beleg": [], "kopf": "", "hinweis": ""})
    ber = _json(lauf / "bericht.json", {})
    korrekturen = _json(_korrekturen_pfad(lauf), {})
    laeufe = [p.name for p in _laeufe()]
    return _html(lauf.name, idx, ber, korrekturen, laeufe)


@app.get("/bild/<lauf>/<datei>")
def bild(lauf, datei):
    ordner = BERICHTE / lauf / "belege"
    if not ordner.is_dir():
        abort(404)
    return send_from_directory(ordner, datei)


@app.post("/api/korrektur")
def korrektur():
    daten = request.get_json(force=True)
    lauf = _lauf(daten.get("lauf"))
    name = daten["name"]
    wert = daten.get("wert", "")
    pfad = _korrekturen_pfad(lauf)
    k = _json(pfad, {})
    # Leerer Wert heisst hier "wie automatisch erkannt" (Korrektur zurueckgenommen),
    # nicht "nicht angemeldet" — dafuer gibt es den eigenen Eintrag "__leer__".
    if wert == "__zuruecksetzen__":
        k.pop(name, None)
    else:
        k[name] = wert
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(json.dumps(k, ensure_ascii=False, indent=1))
    return jsonify({"ok": True})


@app.post("/api/uebernehmen")
def uebernehmen():
    daten = request.get_json(force=True)
    lauf = _lauf(daten.get("lauf"))
    ber = _json(lauf / "bericht.json", {})
    zuordnung = dict(ber.get("zuordnung") or {})
    korrekturen = _json(_korrekturen_pfad(lauf), {})
    for name, wert in korrekturen.items():
        if wert == "__leer__" or wert == "":
            zuordnung.pop(name, None)
        else:
            zuordnung[name] = wert
    tag = ber.get("allianz") or "XP33"
    aid = tool.allianz_id(tag)
    sicherung = tool.sicherung_schreiben(aid, BERICHTE / "sicherungen")
    tool.schreibe_teamassign(aid, zuordnung)
    (lauf / "belege" / "uebernommen.json").write_text(json.dumps(
        {"zeitpunkt": datetime.now().isoformat(timespec="seconds"),
         "zuordnung": zuordnung, "sicherung": str(sicherung)},
        ensure_ascii=False, indent=1))
    return jsonify({"ok": True, "geschrieben": len(zuordnung), "sicherung": str(sicherung)})


def _html(lauf_name: str, idx: dict, ber: dict, korrekturen: dict, laeufe: list[str]) -> str:
    spieler = idx.get("spieler", {})
    ohne_beleg = set(idx.get("ohne_beleg") or [])
    unsicher = set(ber.get("unsicher") or [])
    nicht_gefunden = set(ber.get("nicht_gefunden") or [])
    konflikte = {k["spieler"]: k["werte"] for k in (ber.get("konflikte") or [])}
    heldenkraft = ber.get("heldenkraft") or {}

    alle_namen = sorted(set(spieler) | ohne_beleg | unsicher | nicht_gefunden | set(konflikte))

    def karte(name: str) -> str:
        a = spieler.get(name, {})
        aktueller = korrekturen.get(name, a.get("wert") or "")
        bild_html = (f'<img loading="lazy" src="/bild/{lauf_name}/{a["datei"]}" alt="{name}">'
                     if a.get("datei") else
                     '<div class="keinbild">kein Beleg — ' +
                     ("im Spiel nicht gefunden" if name in nicht_gefunden else "nicht gesehen") +
                     '</div>')
        warnungen = []
        if name in unsicher:
            warnungen.append("⚠ Zeile nicht sicher diesem Spieler zugeordnet")
        if name in konflikte:
            warnungen.append(f"⚠ widersprüchliche Lesung: {', '.join(konflikte[name])}")
        if aktueller == "ABC" and (a.get("ausschnitte") or 0) < 2:
            warnungen.append('⚠ „beide Zeiten" gewählt, aber nur 1 Beleg vorhanden')
        korrigiert = name in korrekturen
        optionen = "".join(
            f'<option value="{w}"{" selected" if w == aktueller else ""}>{label}</option>'
            for w, label in WERTE)
        hk = heldenkraft.get(name)
        if hk and hk.get("vorher") and hk.get("nachher"):
            delta = hk["nachher"] - hk["vorher"]
            pfeil = "→" if abs(delta) < hk["vorher"] * 0.005 else ("↑" if delta > 0 else "↓")
            kraft = (f' · Heldenkraft {hk["vorher"]/1e6:.1f} {pfeil} '
                     f'{hk["nachher"]/1e6:.1f} Mio')
        elif a.get("kraft"):
            kraft = f' · Heldenkraft {a["kraft"]:.1f} Mio'
        else:
            kraft = ""
        return f"""
<div class="karte{' korrigiert' if korrigiert else ''}" data-name="{name}">
  <div class="kopf"><b>{name}</b><span class="kraft">{kraft}</span></div>
  {bild_html}
  {"".join(f'<div class="warnung">{w}</div>' for w in warnungen)}
  <select class="wert">{optionen}</select>
  <div class="status"></div>
</div>"""

    laeufe_optionen = "".join(
        f'<option value="{l}"{" selected" if l == lauf_name else ""}>{l}</option>' for l in laeufe)

    karten = "".join(karte(n) for n in alle_namen)

    return f"""<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<title>WS-Anmeldung prüfen · {lauf_name}</title>
<style>
body{{font:16px system-ui;margin:0;padding:1rem 1rem 6rem;background:#f3f4f6;color:#1a1a1a}}
h1{{font-size:1.1rem;margin:.2rem 0 1rem}}
.kopfzeile{{position:sticky;top:0;background:#f3f4f6;padding:.5rem 0;z-index:5;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}}
select{{font-size:1rem;padding:.4rem;border-radius:8px;border:1px solid #bbb;width:100%}}
.karte{{background:#fff;border-radius:10px;padding:.8rem;margin-bottom:.9rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}}
.karte.korrigiert{{border:2px solid #d97706}}
.kopf{{display:flex;justify-content:space-between;margin-bottom:.4rem;font-size:1.05rem}}
.kraft{{color:#666;font-weight:normal;font-size:.9rem}}
img{{max-width:100%;border-radius:6px;border:1px solid #ddd;display:block;margin-bottom:.5rem}}
.keinbild{{background:#eee;color:#888;padding:1.5rem;text-align:center;border-radius:6px;margin-bottom:.5rem}}
.warnung{{color:#92400e;background:#fef3c7;padding:.4rem .6rem;border-radius:6px;margin-bottom:.5rem;font-size:.9rem}}
.status{{font-size:.85rem;color:#16a34a;height:1.2rem;margin-top:.3rem}}
.leiste{{position:fixed;bottom:0;left:0;right:0;background:#111827;color:#fff;padding:.8rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}}
.leiste button{{background:#2563eb;color:#fff;border:none;padding:.7rem 1.2rem;border-radius:8px;font-size:1rem}}
.zaehler{{font-size:.85rem;color:#cbd5e1}}
</style>
<div class="kopfzeile">
  <h1>WS-Anmeldung prüfen</h1>
  <select id="laufwahl" onchange="location.href='/?lauf='+this.value">{laeufe_optionen}</select>
</div>
<p style="color:#555;font-size:.9rem">{ber.get('team_blatt', '')} · {len(alle_namen)} Spieler ·
gescannt {ber.get('zeitpunkt', '')[:16].replace('T',' ')}</p>
{karten}
<div class="leiste">
  <span class="zaehler" id="zaehler"></span>
  <button onclick="uebernehmen()">Ins Tool übernehmen</button>
</div>
<script>
const LAUF = {json.dumps(lauf_name)};
let geaendert = 0;
function zaehlerAktualisieren(){{
  document.getElementById('zaehler').textContent = geaendert + ' Korrektur(en) seit dem Laden';
}}
document.querySelectorAll('.karte').forEach(karte => {{
  const name = karte.dataset.name;
  const sel = karte.querySelector('select.wert');
  const status = karte.querySelector('.status');
  sel.addEventListener('change', async () => {{
    status.textContent = 'speichere …';
    try {{
      const r = await fetch('/api/korrektur', {{method:'POST',
        headers:{{'Content-Type':'application/json'}},
        body: JSON.stringify({{lauf: LAUF, name, wert: sel.value}})}});
      if (!r.ok) throw new Error(await r.text());
      status.textContent = 'gespeichert ✓';
      karte.classList.add('korrigiert');
      geaendert++; zaehlerAktualisieren();
    }} catch (e) {{
      status.textContent = 'Fehler: ' + e.message;
    }}
  }});
}});
zaehlerAktualisieren();
async function uebernehmen(){{
  if (!confirm('Die aktuelle Zuordnung ins Tool schreiben? Das ersetzt die bisherige Anmeldung komplett (mit Sicherung vorher).')) return;
  const r = await fetch('/api/uebernehmen', {{method:'POST',
    headers:{{'Content-Type':'application/json'}},
    body: JSON.stringify({{lauf: LAUF}})}});
  const d = await r.json();
  if (d.ok) alert(d.geschrieben + ' Werte geschrieben. Sicherung: ' + d.sicherung);
  else alert('Fehler beim Übernehmen.');
}}
</script>"""


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8852, debug=False)
