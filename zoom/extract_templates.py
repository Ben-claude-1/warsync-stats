"""
Extrahiert Pin-Templates aus zoom_0022.png und testet Template Matching.
Gibt Debug-Bild mit allen erkannten Pins aus.
"""
import cv2
import numpy as np
import os

ZOOM_DIR = r'C:\Users\busin\projects\Warsync-stats\zoom'

# ── Bild laden ─────────────────────────────────────────────────────────────────
img = cv2.imread(os.path.join(ZOOM_DIR, 'zoom_0022.png'))
h, w = img.shape[:2]
print(f"Bildgroesse: {w}x{h}")

# Spielbereich (ohne UI-Raender)
MAP_L, MAP_T, MAP_R, MAP_B = 45, 30, w - 110, h - 90
game = img[MAP_T:MAP_B, MAP_L:MAP_R]
gw, gh = MAP_R - MAP_L, MAP_B - MAP_T
print(f"Spielbereich: {gw}x{gh}")

hsv = cv2.cvtColor(game, cv2.COLOR_BGR2HSV)

# ── Maske: Weisse/graue Pins ───────────────────────────────────────────────────
# Weiss/grau: niedrige Saettigung, hohe Helligkeit
mask_white = cv2.inRange(hsv, np.array([0, 0, 180]), np.array([180, 50, 255]))

# ── Maske: Blaue Pins ─────────────────────────────────────────────────────────
mask_blue = cv2.inRange(hsv, np.array([90, 80, 150]), np.array([130, 255, 255]))

# ── Maske: Alle Pins (weiss + blau) ───────────────────────────────────────────
mask_all = cv2.bitwise_or(mask_white, mask_blue)

# Rauschen entfernen
kernel = np.ones((2, 2), np.uint8)
mask_all   = cv2.morphologyEx(mask_all,   cv2.MORPH_OPEN,  kernel)
mask_white = cv2.morphologyEx(mask_white, cv2.MORPH_OPEN,  kernel)
mask_blue  = cv2.morphologyEx(mask_blue,  cv2.MORPH_OPEN,  kernel)

# ── Konturen finden ────────────────────────────────────────────────────────────
def find_boxes(mask, min_area=20, max_area=800, min_aspect=0.3, max_aspect=1.8):
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        aspect = bh / max(bw, 1)
        if min_area < area < max_area and min_aspect < aspect < max_aspect:
            boxes.append((x, y, bw, bh))
    return boxes

boxes_white = find_boxes(mask_white)
boxes_blue  = find_boxes(mask_blue)
boxes_all   = find_boxes(mask_all)
print(f"Weisse Pins:  {len(boxes_white)}")
print(f"Blaue Pins:   {len(boxes_blue)}")
print(f"Alle Pins:    {len(boxes_all)}")

# ── Groessenverteilung ─────────────────────────────────────────────────────────
for name, boxes in [('Weiss', boxes_white), ('Blau', boxes_blue)]:
    if boxes:
        ws = [b[2] for b in boxes]
        hs = [b[3] for b in boxes]
        print(f"  {name}: W={min(ws)}-{max(ws)} (avg {np.mean(ws):.1f}), "
              f"H={min(hs)}-{max(hs)} (avg {np.mean(hs):.1f})")

# ── Debug-Bild ─────────────────────────────────────────────────────────────────
debug = game.copy()
for (x, y, bw, bh) in boxes_white:
    cv2.rectangle(debug, (x, y), (x+bw, y+bh), (200, 200, 200), 1)
for (x, y, bw, bh) in boxes_blue:
    cv2.rectangle(debug, (x, y), (x+bw, y+bh), (255, 100, 0), 2)
cv2.imwrite(os.path.join(ZOOM_DIR, 'debug_pins.png'), debug)
print("Debug: debug_pins.png")

# ── Templates extrahieren ──────────────────────────────────────────────────────
# Mittlere weisse Pins als Template
def extract_median_template(boxes, img, name, pad=3):
    if not boxes:
        return None
    areas = sorted(boxes, key=lambda b: b[2]*b[3])
    mid   = len(areas) // 2
    candidates = areas[max(0, mid-3):mid+4]
    # Nehme den mit der durchschnittlichsten Groesse
    avg_w = np.mean([b[2] for b in candidates])
    avg_h = np.mean([b[3] for b in candidates])
    best  = min(candidates, key=lambda b: abs(b[2]-avg_w) + abs(b[3]-avg_h))
    x, y, bw, bh = best
    x1 = max(0, x - pad);     y1 = max(0, y - pad)
    x2 = min(img.shape[1], x + bw + pad)
    y2 = min(img.shape[0], y + bh + pad)
    t  = img[y1:y2, x1:x2]
    path = os.path.join(ZOOM_DIR, f'template_pin_{name}.png')
    cv2.imwrite(path, t)
    print(f"Template '{name}': {t.shape[1]}x{t.shape[0]}px  @ ({x+MAP_L},{y+MAP_T})")
    return t

t_white = extract_median_template(boxes_white, game, 'white')
t_blue  = extract_median_template(boxes_blue,  game, 'blue')

# Auch je 5 Kandidaten speichern zum Vergleich
for color, boxes in [('white', boxes_white), ('blue', boxes_blue)]:
    if not boxes:
        continue
    areas = sorted(boxes, key=lambda b: b[2]*b[3])
    mid   = len(areas) // 2
    for i, (x, y, bw, bh) in enumerate(areas[max(0, mid-2):mid+3]):
        pad = 3
        crop = game[max(0,y-pad):min(game.shape[0],y+bh+pad),
                    max(0,x-pad):min(game.shape[1],x+bw+pad)]
        cv2.imwrite(os.path.join(ZOOM_DIR, f'template_pin_{color}_{i}.png'), crop)

# ── Template Matching Test ─────────────────────────────────────────────────────
print("\n--- Template Matching Test ---")
for name, tmpl in [('white', t_white), ('blue', t_blue)]:
    if tmpl is None:
        continue
    th, tw = tmpl.shape[:2]
    result = cv2.matchTemplate(game, tmpl, cv2.TM_CCOEFF_NORMED)

    for thresh in [0.60, 0.65, 0.70]:
        locs  = np.where(result >= thresh)
        pts   = list(zip(*locs[::-1]))
        if not pts:
            print(f"  {name} @ {thresh}: 0 Treffer")
            continue
        # NMS
        pts_arr = np.array(pts)
        scores  = result[locs]
        order   = np.argsort(-scores)
        kept    = []
        for idx in order:
            x, y = pts_arr[idx]
            skip = any(abs(x-kx) < tw*0.6 and abs(y-ky) < th*0.6 for kx,ky in kept)
            if not skip:
                kept.append((int(x), int(y)))
        print(f"  {name} @ {thresh}: {len(kept)} Treffer")

    # Debug-Bild mit Matching-Ergebnis
    best_thresh = 0.62
    locs   = np.where(result >= best_thresh)
    pts    = list(zip(*locs[::-1]))
    scores = result[locs]
    order  = np.argsort(-scores)
    kept   = []
    for idx in order:
        x, y = pts_arr[idx] if len(pts) > 0 else (0, 0)
        try:
            x, y = int(pts[idx][0]), int(pts[idx][1])
        except Exception:
            continue
        skip = any(abs(x-kx) < tw*0.6 and abs(y-ky) < th*0.6 for kx,ky in kept)
        if not skip:
            kept.append((x, y))

    dbg = game.copy()
    for (x, y) in kept:
        cv2.rectangle(dbg, (x, y), (x+tw, y+th), (0, 255, 0), 1)
    cv2.imwrite(os.path.join(ZOOM_DIR, f'debug_match_{name}.png'), dbg)
    print(f"  -> debug_match_{name}.png ({len(kept)} Markierungen)")
