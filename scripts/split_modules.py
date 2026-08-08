#!/usr/bin/env python3
"""Zerlegt die einteilige index.html in ES-Module unter src/.

Der Schnitt folgt den Abschnittsbannern, die ohnehin schon in der Datei stehen —
die Reihenfolge des Codes bleibt dadurch erhalten und der Diff ist nachvollziehbar.

Zwei Regeln, die den Umbau verhaltensgleich halten:

- **Jede Top-Level-Deklaration wird exportiert.** Was oeffentlich ist, entscheidet
  nicht dieses Skript; es faellt nur niemand hinten runter.
- **Importiert wird nach Wortvorkommen, nicht nach Datenflussanalyse.** Steht der
  Name eines fremden Symbols irgendwo im Modultext, wird er importiert. Das
  importiert gelegentlich zu viel (etwa wenn der Name nur in einem Text steht),
  aber nie zu wenig — und zu wenig waere ein Laufzeitfehler beim Nutzer.

Inline-Handler im erzeugten HTML (onclick="nav('home')") rufen Funktionen ueber den
globalen Namensraum auf. Nach dem Bundeln gibt es den nicht mehr, deshalb schreibt
app/globals.js genau die dort verwendeten Namen zurueck auf window.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "index.html"

# (erste Zeile, letzte Zeile, Zielmodul) — 1-basiert, Grenzen inklusive.
# Die Zeilennummern stammen aus den Abschnittsbannern der Vorlage.
SECTIONS = [
    (172,  208,  "core/config.js"),
    (209,  1226, "core/i18n.js"),
    (1227, 1273, "core/players.js"),
    (1274, 1389, "core/state.js"),
    (1390, 1396, "core/api.js"),
    (1397, 1533, "core/auth.js"),
    (1534, 1606, "ui/overlay.js"),
    (1607, 1733, "core/helpers.js"),
    (1734, 1740, "app/render.js"),
    (1741, 1760, "ui/login.js"),
    (1761, 1786, "app/shell.js"),
    (1787, 1803, "ui/home.js"),
    (1804, 2523, "ui/ws.js"),
    (2524, 3451, "ui/vs.js"),
    (3452, 4491, "ui/buildings.js"),
    (4492, 5575, "ui/cs.js"),
    (5576, 5813, "ui/zugfahrt.js"),
    (5814, 6508, "ui/allianz.js"),
    (6509, 6762, "ui/profil.js"),
    (6763, 7007, "ui/umfragen.js"),
    (7008, 7218, "ui/wsmap.js"),
    (7219, 7314, "core/hive.js"),
    (7315, 7501, "ui/hive.js"),
    (7502, 7861, "ui/karte.js"),
    (7862, 8037, "core/png.js"),
    (8038, 8599, "ui/admin.js"),
    (8600, 8721, "ui/rankings.js"),
    (8722, 8725, "app/init.js"),
]

DECL = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z0-9_$]+)"
    r"|(?:const|let|var)\s+([A-Za-z0-9_$]+)"
    r"|class\s+([A-Za-z0-9_$]+))"
)
# Aus dem Browser bzw. vom CDN — nie importieren.
AMBIENT = {"XLSX", "window", "document", "console", "localStorage", "navigator"}


def split_lines():
    lines = SRC.read_text(encoding="utf-8").split("\n")
    css = "\n".join(lines[7:165])          # <style> … </style>, Zeile 8..165
    return lines, css


def declarations(body):
    """Top-Level-Deklarationen eines Abschnitts (Spalte 0, also nicht eingerueckt)."""
    out = []
    for line in body.split("\n"):
        m = DECL.match(line)
        if m:
            out.append(next(g for g in m.groups() if g))
    return out


def add_exports(body):
    """Jede Top-Level-Deklaration bekommt ein export davor."""
    out = []
    for line in body.split("\n"):
        if DECL.match(line) and not line.startswith("export "):
            line = "export " + line
        out.append(line)
    return "\n".join(out)


def main():
    lines, css = split_lines()

    # 1. Abschnitte schneiden und Symboltabelle aufbauen
    mods = {}
    owner = {}
    for a, b, path in SECTIONS:
        body = "\n".join(lines[a - 1:b])
        mods[path] = body
        for name in declarations(body):
            if name in owner:
                sys.exit(f"FEHLER: {name} doppelt ({owner[name]} und {path})")
            owner[name] = path

    # Luecken zwischen den Abschnitten sind verlorener Code — hart abbrechen.
    covered = set()
    for a, b, _ in SECTIONS:
        covered |= set(range(a, b + 1))
    fehlend = [n for n in range(172, 8726) if n not in covered and lines[n - 1].strip()]
    if fehlend:
        sys.exit(f"FEHLER: {len(fehlend)} Zeilen keinem Modul zugeordnet: {fehlend[:12]}")

    # 2. Importe je Modul aus Wortvorkommen ableiten
    for path, body in mods.items():
        needed = {}
        for name, home in owner.items():
            if home == path or name in AMBIENT:
                continue
            if re.search(r"\b" + re.escape(name) + r"\b", body):
                needed.setdefault(home, []).append(name)
        header = []
        for home in sorted(needed):
            rel = relpath(path, home)
            header.append(f"import {{ {', '.join(sorted(needed[home]))} }} from '{rel}';")
        text = add_exports(body)
        if header:
            text = "\n".join(header) + "\n\n" + text
        out = ROOT / "src" / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text.rstrip() + "\n", encoding="utf-8")

    (ROOT / "src" / "styles.css").write_text(css.strip() + "\n", encoding="utf-8")

    # 3. Globals-Bruecke fuer die Inline-Handler im erzeugten HTML
    html = SRC.read_text(encoding="utf-8")
    used = set()
    for attr in re.findall(r"\bon[a-z]+\s*=\s*\"([^\"]*)\"", html):
        used |= set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", attr))
    for attr in re.findall(r"\bon[a-z]+\s*=\s*'([^']*)'", html):
        used |= set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", attr))
    bridge = sorted(n for n in used if n in owner)
    by_mod = {}
    for n in bridge:
        by_mod.setdefault(owner[n], []).append(n)
    g = ["// Inline-Handler im erzeugten HTML (onclick=\"nav('home')\") laufen ueber den",
         "// globalen Namensraum. Nach dem Bundeln gibt es den nicht mehr — hier stehen",
         "// deshalb genau die Namen, die aus HTML-Attributen heraus aufgerufen werden.",
         "// Erzeugt von scripts/split_modules.py; nicht von Hand pflegen.", ""]
    for home in sorted(by_mod):
        g.append(f"import {{ {', '.join(by_mod[home])} }} from '{relpath('app/globals.js', home)}';")
    g += ["", "Object.assign(window, {", "  " + ", ".join(bridge), "});", ""]
    (ROOT / "src" / "app" / "globals.js").write_text("\n".join(g), encoding="utf-8")

    print(f"{len(SECTIONS)} Module · {len(owner)} Symbole · {len(bridge)} Globals")
    for path in sorted(mods):
        n = len((ROOT / 'src' / path).read_text(encoding='utf-8').split('\n'))
        print(f"  {path:22} {n:5} Zeilen")


def relpath(frm, to):
    """Importpfad von Modul frm zu Modul to, immer mit ./ oder ../ davor."""
    a, b = frm.split("/")[:-1], to.split("/")
    while a and b[:1] == a[:1]:
        a, b = a[1:], b[1:]
    return ("../" * len(a) or "./") + "/".join(b)


if __name__ == "__main__":
    main()
