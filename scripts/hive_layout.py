#!/usr/bin/env python3
"""Hive-Aufstellung: geschlossenes 10x10-Rechteck, MG im Zentrum, R5/R4 im
Innenring, danach nach Heldenkraft absteigend nach außen. Erzeugt HTML + Textliste.

Raster: Schritt 3 pro Zelle, MG bei (436,507) — wie in der Vorlage.
10x10 = 100 Felder = MG + 99 Spieler, also luecklos gefuellt. Das Rechteck laesst
sich nicht exakt um das MG zentrieren (100 ist gerade): 4 Spalten links / 5 rechts,
5 Reihen oben / 4 unten.
"""
import html
import sys
from pathlib import Path

CX, CY, STEP = 436, 507, 3
# Rechteck-Ausdehnung in Zellen, relativ zum MG
LEFT, RIGHT, UP, DOWN = 4, 5, 5, 4
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / ".tmp" / "hive_players.txt"
OUT_HTML = ROOT / ".tmp" / "hive_layout.html"
OUT_TXT = ROOT / ".tmp" / "hive_layout.txt"


def ring_cells(r):
    """Zellen des Rings r innerhalb des Rechtecks, gruppiert nach N/O/S/W.

    Aussen liegende Ringe werden vom Rechteck beschnitten — genau so entsteht die
    gerade Kante. Ecken zaehlen zu N bzw. S. dy>0 = nach oben (wie in der Vorlage).
    """
    sides = {"N": [], "O": [], "S": [], "W": []}
    for dy in range(r, -r - 1, -1):
        for dx in range(-r, r + 1):
            if max(abs(dx), abs(dy)) != r:
                continue
            if not (-LEFT <= dx <= RIGHT and -DOWN <= dy <= UP):
                continue
            cell = (CX + STEP * dx, CY + STEP * dy)
            if dy == r:
                sides["N"].append(cell)
            elif dy == -r:
                sides["S"].append(cell)
            elif dx == r:
                sides["O"].append(cell)
            else:
                sides["W"].append(cell)
    # von der Seitenmitte nach aussen sortieren, damit die Verteilung mittig startet
    for k, cells in sides.items():
        key = (lambda c: abs(c[0] - CX)) if k in ("N", "S") else (lambda c: abs(c[1] - CY))
        cells.sort(key=key)
    return sides


def distribute(players, sides):
    """Spieler absteigend reihum auf N/O/S/W verteilen -> jede Flanke gleich stark."""
    order = ["N", "O", "S", "W"]
    idx = {k: 0 for k in order}
    placed, i = [], 0
    for p in players:
        for _ in range(4):
            k = order[i % 4]
            i += 1
            if idx[k] < len(sides[k]):
                placed.append((sides[k][idx[k]], k, p))
                idx[k] += 1
                break
        else:
            raise RuntimeError("Ring voll")
    return placed


def main():
    players = []
    for line in SRC.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        name, role, power = line.split("|")
        players.append({"name": name, "role": role, "power": int(power)})

    leaders = [p for p in players if p["role"] in ("R4", "R5")]
    leaders.sort(key=lambda p: (p["role"] != "R5", -p["power"]))
    rest = [p for p in players if p["role"] not in ("R4", "R5")]
    rest.sort(key=lambda p: -p["power"])

    grid = {(CX, CY): {"name": "MG", "role": "MG", "power": None, "ring": 0}}
    queue = leaders + rest
    for r in range(1, max(LEFT, RIGHT, UP, DOWN) + 1):
        sides = ring_cells(r)
        cap = sum(len(v) for v in sides.values())
        take, queue = queue[:cap], queue[cap:]
        for cell, side, p in distribute(take, sides):
            grid[cell] = {**p, "ring": r, "side": side}
    if queue:
        sys.exit(f"FEHLER: {len(queue)} Spieler ohne Platz")

    xs = [CX + STEP * d for d in range(-LEFT, RIGHT + 1)]
    ys = [CY + STEP * d for d in range(UP, -DOWN - 1, -1)]
    frei = [(x, y) for y in ys for x in xs if (x, y) not in grid]
    print(f"Rechteck {len(xs)}x{len(ys)} = {len(xs) * len(ys)} Felder, {len(frei)} frei")

    def fmt(p):
        return f"{p['power'] / 1e6:.1f}M"

    # ---- Textliste ----
    lines = ["Hive-Aufstellung — MG (436,507) im Zentrum", ""]
    for r in range(0, max(LEFT, RIGHT, UP, DOWN) + 1):
        members = sorted(
            [(c, p) for c, p in grid.items() if p["ring"] == r],
            key=lambda t: -(t[1]["power"] or 0),
        )
        if not members:
            continue
        label = "Zentrum" if r == 0 else f"Ring {r}"
        lines.append(f"== {label} ({len(members)}) ==")
        for (x, y), p in members:
            pw = "" if p["power"] is None else f"  {fmt(p):>7}"
            lines.append(f"  x:{x} y:{y}  {p['role']:<3} {p['name']:<22}{pw}")
        lines.append("")
    OUT_TXT.write_text("\n".join(lines), encoding="utf-8")

    # ---- HTML im Stil der Vorlage ----
    colors = {
        "MG": "#e8722a",
        "R5": "#d452c8",
        "R4": "#a8e08a",
        "R3": "#e5d3f2",
    }
    cells = []
    for y in ys:
        row = []
        for x in xs:
            p = grid.get((x, y))
            if not p:
                row.append('<td class="leer"></td>')
                continue
            bg = colors[p["role"]]
            pw = "" if p["power"] is None else f'<div class="kk">{fmt(p)}</div>'
            big = ' style="font-size:19px"' if p["role"] == "MG" else ""
            row.append(
                f'<td style="background:{bg}">'
                f'<div class="nm"{big}>{html.escape(p["name"])}</div>{pw}'
                f'<div class="co">x:{x} y:{y}</div></td>'
            )
        cells.append("<tr>" + "".join(row) + "</tr>")

    doc = f"""<!doctype html><meta charset="utf-8"><style>
body{{margin:0;padding:18px;background:#fff;font-family:'Segoe UI',Arial,sans-serif}}
h1{{font-size:19px;margin:0 0 2px}}
p.sub{{font-size:12.5px;color:#555;margin:0 0 12px}}
table{{border-collapse:collapse}}
td{{width:112px;height:80px;border:2.5px solid #58585a;vertical-align:middle;
text-align:center;padding:3px 4px}}
td.leer{{background:#7ecbf5}}
.nm{{font-weight:700;font-size:13px;line-height:1.12;
overflow-wrap:anywhere;margin-bottom:3px}}
.kk{{font-size:12px;font-weight:700;color:#7a2b8a}}
.co{{font-size:9.5px;color:#333;margin-top:3px}}
.leg{{margin-top:12px;font-size:12.5px;display:flex;gap:16px;flex-wrap:wrap}}
.leg i{{display:inline-block;width:13px;height:13px;border:1.5px solid #58585a;
margin-right:5px;vertical-align:-2px;font-style:normal}}
</style>
<h1>Hive-Aufstellung — Phoenix R1sing #1668</h1>
<p class="sub">{len(xs)}×{len(ys)} lückenlos · MG im Zentrum · R5/R4 im Innenring ·
nach außen absteigende Heldenkraft · Angabe = Gesamtkraft der Helden</p>
<table>{''.join(cells)}</table>
<div class="leg">
<span><i style="background:{colors['MG']}"></i>MG (Allianz-Zentrum)</span>
<span><i style="background:{colors['R5']}"></i>R5</span>
<span><i style="background:{colors['R4']}"></i>R4</span>
<span><i style="background:{colors['R3']}"></i>R3</span>
</div>"""
    OUT_HTML.write_text(doc, encoding="utf-8")
    print(f"{len(grid) - 1} Spieler platziert, Raster {len(xs)}x{len(ys)}")
    print(OUT_HTML)


if __name__ == "__main__":
    main()
