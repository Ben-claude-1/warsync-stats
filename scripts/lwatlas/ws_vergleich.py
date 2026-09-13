"""Warum ein Wüstensturm verloren ging — als Bild, aus belegten Zahlen.

    .venv/bin/python -m scripts.lwatlas.ws_vergleich --datum 2026-09-11

Unsere Seite kommt aus der Datenbank (wer laut `ws_participation` **gespielt**
hat), die Gegnerseite aus den Mitgliederlisten von LW Atlas. Verglichen wird
gleich viele gegen gleich viele: unsere Angetretenen gegen die ebenso vielen
stärksten des Gegners — denn genau die stellt eine Allianz auf.

**Die Gegner-Allianz wird über die Warzone bestimmt, nicht über den Namen.**
Die Kampfmail nennt Server *und* Namen; die Zahl liest jede Erkennung richtig,
den Namen nicht — aus `雞排不切不辣` wurde `RIST#`, und danach gesucht landet man
bei `Rival Storm` auf Warzone 1572, die mit dem Kampf nichts zu tun hatte. Erst
der Server, dann der Name: nur wenn die Warzone stimmt, kann die Allianz stimmen.

Der erwartete Punktanteil ist bewusst schlicht — Kraft geteilt durch Kraft
beider Seiten. Er behauptet keine Prognose, sondern beantwortet eine Frage:
Wieviel vom Ergebnis erklärt schon das Material, und wieviel bleibt für alles
andere übrig?
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.karten_archiv.lwatlas import _aehnlich, _norm          # noqa: E402
from scripts.ws_service.tool import _anfrage                         # noqa: E402

ABLAGE = Path.home() / ".local/state/warsync/lwatlas"
SCHRIFT = "/Library/Fonts/Arial Unicode.ttf"
SCHRIFT_FETT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

BG = (247, 248, 250)
KOPF = (28, 42, 68)
TEXT = (26, 32, 44)
GRAU = (120, 130, 145)
UNS = (41, 128, 185)
SIE = (192, 57, 43)

# Gegner je Team: (Anzeigename, Warzone, Datei mit der Mitgliederliste).
# Die Dateien legt der Abruf gegen /alliances/{id}/members an.
GEGNER = {
    "A": ("TW2N · 雞排不切不辣", 1669, "members_TW2N.json"),
    "B": ("aly1 · Alliance 1", 1664, "members_aly1.json"),
}


def unsere_seite(tag: str, datum: str, team: str) -> tuple[list[dict], dict]:
    aid = {a["tag"]: a["id"] for a in _anfrage("alliances?select=id,tag")}[tag]
    ev = _anfrage(f"ws_events?select=id,time_slot,our_pts,opp_pts,opponent"
                  f"&alliance_id=eq.{aid}&event_date=eq.{datum}&team=eq.{team}&mode=eq.ws")[0]
    teil = _anfrage(f"ws_participation?select=player_name,played&event_id=eq.{ev['id']}&limit=100")
    lwa = _anfrage(f"lwa_spieler?server=eq.%23{{}}&allianz=eq.{tag}"
                   "&select=name,power,army_kill&limit=500".format(1668))
    idx = {_norm(s["name"]): s for s in lwa}

    def finde(n):
        k = _norm(n)
        if k in idx:
            return idx[k]
        b = max(idx.items(), key=lambda kv: _aehnlich(k, kv[0]))
        return b[1] if _aehnlich(k, b[0]) >= 0.62 else None

    gespielt = [finde(t["player_name"]) for t in teil if t["played"]]
    ev["fehlend"] = [t["player_name"] for t in teil if not t["played"]]
    ev["bestmoeglich"] = sorted((s.get("power") or 0) for s in lwa)[-30:]
    return [g for g in gespielt if g], ev


def balken(d, x, y, breite, hoehe, anteil, farbe, beschriftung, f):
    d.rounded_rectangle([x, y, x + breite, y + hoehe], 6, fill=(225, 230, 237))
    if anteil > 0:
        d.rounded_rectangle([x, y, x + max(14, int(breite * anteil)), y + hoehe], 6, fill=farbe)
    d.text((x + breite + 12, y + hoehe // 2 - 11), beschriftung, font=f, fill=TEXT)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--tag", default="XP33")
    p.add_argument("--datum", default="2026-09-11")
    p.add_argument("--datei", default="Pics/ws_vergleich.png")
    a = p.parse_args()

    f_t = ImageFont.truetype(SCHRIFT_FETT, 38)
    f_u = ImageFont.truetype(SCHRIFT, 19)
    f_h = ImageFont.truetype(SCHRIFT_FETT, 25)
    f_n = ImageFont.truetype(SCHRIFT, 19)
    f_b = ImageFont.truetype(SCHRIFT_FETT, 21)
    f_k = ImageFont.truetype(SCHRIFT, 16)

    B, H = 1180, 1120
    bild = Image.new("RGB", (B, H), BG)
    d = ImageDraw.Draw(bild)
    d.rectangle([0, 0, B, 118], fill=KOPF)
    d.text((34, 24), f"Wüstensturm {a.datum[8:10]}.{a.datum[5:7]}. — warum wir unterlegen waren",
           font=f_t, fill=(255, 255, 255))
    d.text((34, 76), "Angetretene gegen ebenso viele der stärksten des Gegners · Quelle LW Atlas",
           font=f_u, fill=(165, 180, 205))

    y = 150
    bestm = None
    for team in ("A", "B"):
        uns, ev = unsere_seite(a.tag, a.datum, team)
        bestm = ev["bestmoeglich"]
        name, wz, datei = GEGNER[team]
        g = json.load(open(ABLAGE / datei))["members"]
        n = len(uns)
        gt = sorted(g, key=lambda x: -(x.get("power") or 0))[:n]
        ukr = sum(u.get("power") or 0 for u in uns)
        gkr = sum(x.get("power") or 0 for x in gt)
        ukl = sum(u.get("army_kill") or 0 for u in uns)
        gkl = sum(x.get("armyKill") or 0 for x in gt)
        ist = ev["our_pts"] / (ev["our_pts"] + ev["opp_pts"])
        erw = ukr / (ukr + gkr)

        d.rounded_rectangle([28, y, B - 28, y + 400], 12, fill=(255, 255, 255))
        d.text((50, y + 18), f"Team {team} · {ev['time_slot']}", font=f_h, fill=TEXT)
        d.text((50, y + 52), f"gegen {name}  ·  Warzone #{wz}", font=f_n, fill=GRAU)
        erg = f"{ev['our_pts']:,} : {ev['opp_pts']:,}".replace(",", ".")
        tb = d.textbbox((0, 0), erg, font=f_h)
        d.text((B - 50 - (tb[2] - tb[0]), y + 18), erg, font=f_h, fill=SIE)
        d.text((B - 50 - (tb[2] - tb[0]), y + 52), "Niederlage", font=f_n, fill=GRAU)

        zeile = y + 100
        for titel, u_wert, g_wert, einheit in (
                ("Kampfkraft der Angetretenen", ukr / 1e9, gkr / 1e9, "Mrd"),
                ("Kills der Angetretenen", ukl / 1e6, gkl / 1e6, "Mio")):
            d.text((50, zeile), titel, font=f_k, fill=GRAU)
            gr = max(u_wert, g_wert)
            balken(d, 50, zeile + 24, 640, 30, u_wert / gr, UNS,
                   f"wir  {u_wert:.2f} {einheit}".replace(".", ","), f_b)
            balken(d, 50, zeile + 62, 640, 30, g_wert / gr, SIE,
                   f"sie  {g_wert:.2f} {einheit}".replace(".", ","), f_b)
            zeile += 120

        d.line([(50, zeile - 4), (B - 50, zeile - 4)], fill=(228, 233, 240), width=2)
        txt = (f"Kraftverhältnis {ukr/gkr:.2f} : 1".replace(".", ",")
               + f"   →   erwartet {erw:.0%} der Punkte, geholt {ist:.0%}")
        d.text((50, zeile + 12), txt, font=f_b, fill=TEXT)
        if ev["fehlend"]:
            d.text((50, zeile + 44), "nicht angetreten: " + ", ".join(ev["fehlend"]),
                   font=f_k, fill=SIE)
        y += 430

    # Der Satz, auf den alles hinausläuft.
    best = sum(bestm) / len(bestm) / 1e6 if bestm else 0
    d.rounded_rectangle([28, y, B - 28, y + 86], 12, fill=(255, 244, 232))
    d.text((50, y + 16), "Beide Gegner traten mit ihren Stärksten an (Ø 243 und Ø 248 Mio).",
           font=f_b, fill=TEXT)
    d.text((50, y + 48), f"XP33 könnte Ø {best:.0f} Mio stellen — angetreten sind Ø 219 und Ø 217 Mio.",
           font=f_b, fill=(180, 95, 20))

    d.text((34, H - 34), "Powered by LW Atlas · lwatlas.com", font=f_k, fill=GRAU)
    ziel = Path(a.datei)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    bild.save(ziel)
    print("→", ziel.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
