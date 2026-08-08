#!/usr/bin/env python3
"""Statische Kontrolle der Modulaufteilung. Findet zwei Fehlerarten, die erst beim
Klicken des Nutzers auffallen wuerden:

1. **Fehlender Import** — ein Modul benutzt ein Symbol, das ein anderes exportiert,
   ohne es zu importieren. Der Build laeuft durch, der Aufruf endet in
   „x is not defined".
2. **Fehlender Eintrag in app/globals.js** — ein Funktionsname taucht in einem
   Handler-Text auf (`onclick="tuWas()"`, auch wenn dieser Text erst in einer
   Hilfsfunktion zusammengesetzt wird), steht aber nicht auf window.

Aufruf: .venv/bin/python scripts/check_modules.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

# Erfasst auch Mehrfachdeklarationen: const A=1, B=2;
EXPORT_FN = re.compile(r"^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)", re.M)
EXPORT_VAR = re.compile(r"^export\s+(?:const|let|var)\s+(.+)$", re.M)
NAME = re.compile(r"^\s*([A-Za-z0-9_$]+)")


def exported(text):
    out = set(EXPORT_FN.findall(text))
    for zeile in EXPORT_VAR.findall(text):
        # Zeilenkommentar weg, sonst zerlegt "// Ziel: 7,2 Mio" das Komma mit und
        # liefert "2" als vermeintlichen Namen.
        zeile = re.sub(r"//.*$", "", zeile)
        # "A=1, B=2;" -> A, B  (nur die oberste Klammerebene trennen)
        tiefe, teil, teile = 0, "", []
        for ch in zeile:
            if ch in "([{":
                tiefe += 1
            elif ch in ")]}":
                tiefe -= 1
            if ch == "," and tiefe == 0:
                teile.append(teil)
                teil = ""
            else:
                teil += ch
        teile.append(teil)
        for t in teile:
            m = NAME.match(t)
            if m:
                out.add(m.group(1))
    return out


def imported(text):
    out = set()
    for block in re.findall(r"import\s*\{([^}]*)\}\s*from", text):
        for n in block.split(","):
            n = n.strip().split(" as ")[-1].strip()
            if n:
                out.add(n)
    return out


def main():
    files = {p: p.read_text(encoding="utf-8") for p in SRC.rglob("*.js")}
    owner = {}
    for p, t in files.items():
        for name in exported(t):
            owner[name] = p

    fehler = []

    # 1. Benutzt, aber nicht importiert
    for p, t in files.items():
        if p.name == "globals.js":
            continue
        eigen = exported(t) | imported(t)
        # Rumpf ohne die Importzeilen betrachten
        rumpf = "\n".join(l for l in t.split("\n") if not l.startswith("import "))
        for name, home in owner.items():
            if home == p or name in eigen:
                continue
            if re.search(r"(?<![.\w$'\"])" + re.escape(name) + r"\s*(?=[(\[.,;)\]}=+\-*/<>!?:\s])", rumpf):
                fehler.append(f"{p.relative_to(ROOT)}: benutzt '{name}' aus {home.name}, importiert es aber nicht")

    # 2. Handler-Namen, die nicht auf window liegen
    bridge = imported((SRC / "app" / "globals.js").read_text(encoding="utf-8"))
    handler = set()
    for p, t in files.items():
        # onclick="foo(" — egal ob direkt geschrieben oder in einer Hilfsfunktion gebaut
        for m in re.findall(r"\bon[a-z]+\s*=\s*[\"'\\]*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", t):
            handler.add(m)
        # Funktionsname als Argument uebergeben und drueben in einen Handler gegossen:
        # strengthPicker(x,'setCsStrength') oder toggle(on,`adminSetAccess(...)`).
        # Nur nach ( oder , suchen — sonst faengt die Regel auch class="badge" ein.
        for m in re.findall(r"[(,]\s*[`'\"]([A-Za-z_$][A-Za-z0-9_$]*)\s*[('`\"]", t):
            if m in owner and re.search(r"^export\s+(?:async\s+)?function\s+" + re.escape(m) + r"\b",
                                        files[owner[m]], re.M):
                handler.add(m)
    for name in sorted(handler):
        if name in owner and name not in bridge:
            fehler.append(f"app/globals.js: '{name}' wird aus einem Handler aufgerufen, steht aber nicht auf window")

    if fehler:
        print(f"{len(fehler)} Befund(e):")
        for f in sorted(set(fehler)):
            print("  " + f)
        sys.exit(1)
    print(f"ok — {len(owner)} Symbole, {len(bridge)} Globals, keine Befunde")


if __name__ == "__main__":
    main()
