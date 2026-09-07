"""Die Y-Achse ist perspektivisch — ein Faktor reicht nicht.

Gemessen am 07.09.2026: die Bannerreihen stehen je **3 Welteinheiten**
auseinander, ihre Pixelabstaende wachsen aber von oben nach unten — 386, 408,
453 px. Ein einzelnes `skala_y` bildet das nicht ab; nahe der Mitte sind es 0,4
Welteinheiten Fehler, am Bildrand rund eine ganze. Fuer einen Zensus ist das zu
viel: eine Basis landete in der falschen Rasterzeile.

Der Grund ist die Kameraneigung. Eine geneigte Ebene bildet sich **projektiv**
ab, und das ist eine Moebiustransformation entlang der Achse:

    d = a * u / (1 + c * u)          u = d / (a - c * d)

    u = kamera_y - welt_y            Welt-Abstand nach unten (Y waechst nach oben)
    d = banner_y - 1280 - versatz    Pixel-Abstand von der Kameramitte

`a` ist der Massstab **in der Bildmitte** (dort ist u = 0), `c` die Neigung.
Fuer c = 0 faellt das Modell auf den alten Faktor zurueck — alte Archive bleiben
also richtig lesbar, wenn kein Modell im Manifest steht.

**Warum keine freie Kurve.** Die Reihenabstaende liefern nur eine Handvoll
Stuetzstellen; ein Polynom hoeheren Grades wuerde zwischen ihnen schwingen und
ausserhalb davonlaufen — genau am Bildrand, wo der Fehler ohnehin am groessten
ist. Die projektive Form hat zwei Parameter, ist durch die Geometrie begruendet
und extrapoliert von selbst richtig.

**Der Fit braucht keine bekannten Koordinaten.** Er nutzt allein, dass die Reihen
gleich weit auseinander liegen: der Abstand ist 3 Welteinheiten, egal welche
Basis dort steht. Die Stern-Wahrheiten bleiben damit als *unabhaengige*
Gegenprobe uebrig, statt in den Fit einzugehen.
"""
from __future__ import annotations

import numpy as np

MITTE = 1280


def d_von_pixel(cy: float, cfg: dict) -> float:
    """Pixel-Abstand des Banners von der Kameramitte."""
    return cy - MITTE - cfg["banner_versatz"]


def welt_y(cy: float, kamera_y: float, cfg: dict) -> float:
    """Welt-Y einer Bannerzeile. Ohne `y_modell` das alte lineare Verhalten."""
    d = d_von_pixel(cy, cfg)
    m = cfg.get("y_modell")
    if not m:
        return kamera_y - d / cfg["skala_y"]
    nenner = m["a"] - m["c"] * d
    if abs(nenner) < 1e-6:                     # Fluchtlinie — dort gibt es kein Welt-Y
        return float("nan")
    return kamera_y - d / nenner


def pixel_y(wy: float, kamera_y: float, cfg: dict) -> float:
    """Umkehrung: wo liegt das Banner einer Basis mit bekanntem Welt-Y."""
    u = kamera_y - wy
    m = cfg.get("y_modell")
    if not m:
        return MITTE + cfg["banner_versatz"] + u * cfg["skala_y"]
    return MITTE + cfg["banner_versatz"] + m["a"] * u / (1 + m["c"] * u)


def welt(cx: float, cy: float, kamera_x: float, kamera_y: float,
         cfg: dict) -> tuple[float, float]:
    """Weltkoordinate eines Banners — beide Achsen, ein Neigungsparameter.

    **Auch X haengt an der Neigung.** Bei einer gekippten Ebene schrumpft alles
    mit der Entfernung, waagerecht wie senkrecht:

        px = b * dx / (1 + c*u)          py = a * u  / (1 + c*u)

    X bekommt den Faktor also einfach, Y doppelt (einmal ueber `u` im Zaehler).
    Deshalb faellt der X-Fehler kleiner aus und wurde bei der ersten Gegenprobe
    fuer Rauschen gehalten — er ist aber systematisch und derselbe Effekt:

    | Basis      | Δx | u | X-Fehler linear | erklaert durch (1 + c*u) |
    |------------|----|---|-----------------|--------------------------|
    | Snailnuts  |  0 | 3 | 0,03            | 0,00 (kein Hebel bei Δx=0) |
    | Maggo1979  |  3 | 3 | 0,10            | 0,09                     |

    Am Bildrand (u ≈ 10, Δx ≈ 6) waeren es rund 0,6 Welteinheiten — dieselbe
    Groessenordnung wie der Y-Fehler und aus demselben Grund.

    Ohne `y_modell` bleibt es beim alten linearen Verhalten in beiden Achsen.
    """
    wy = welt_y(cy, kamera_y, cfg)
    px = cx - MITTE - cfg.get("versatz_x", 0)
    m = cfg.get("y_modell")
    tiefe = 1.0 if not m else 1 + m["c"] * (kamera_y - wy)
    return kamera_x + px * tiefe / cfg["skala_x"], wy


# ── Fit ───────────────────────────────────────────────────────────────────

def reihen(cys, skala_start: float, mindest_breite: float = 0.45) -> list[float]:
    """Bannerzeilen aus einer Punktwolke: benachbarte Y-Pixel zusammenfassen.

    Zusammengefasst wird, was naeher als `mindest_breite` Welteinheiten
    beieinander liegt — Basen derselben Rasterzeile stehen exakt gleich hoch,
    die naechste Zeile ist 3 Einheiten entfernt. Die Schwelle liegt also weit
    von beiden Faellen weg und muss nicht fein getroffen werden.
    """
    if not len(cys):
        return []
    toleranz = mindest_breite * skala_start
    aus, gruppe = [], [float(sorted(cys)[0])]
    for v in sorted(float(c) for c in cys)[1:]:
        if v - gruppe[-1] <= toleranz:
            gruppe.append(v)
        else:
            aus.append(float(np.median(gruppe)))
            gruppe = [v]
    aus.append(float(np.median(gruppe)))
    return aus


def _lsq(us: np.ndarray, ds: np.ndarray) -> tuple[float, float, float]:
    """(a, c, Restfehler in px) fuer feste Zuordnung u ↔ d.

    Aus d * (1 + c*u) = a*u folgt d = a*u - c*(d*u) — linear in (a, c), also
    ohne Iteration loesbar. Genau deshalb wird nur der eine verbleibende
    Freiheitsgrad (die Lage der Bezugszeile) abgesucht.
    """
    A = np.column_stack([us, -ds * us])
    loesung, *_ = np.linalg.lstsq(A, ds, rcond=None)
    rest = float(np.sqrt(np.mean((A @ loesung - ds) ** 2)))
    return float(loesung[0]), float(loesung[1]), rest


def fit_paare(paare, cfg: dict) -> dict | None:
    """Modell aus Paaren (Pixelabstand d, Weltabstand u) — ohne Suche.

    Kennt man zu jeder Zeile auch ihr Welt-Y, ist nichts mehr zu raten: aus
    d*(1 + c*u) = a*u wird eine gewoehnliche lineare Ausgleichsrechnung in
    (a, c). Die Suche in `fit` gibt es nur, weil dort die absolute Lage der
    Zeilen unbekannt ist.

    Solche Paare entstehen, wenn dieselben Rasterzeilen aus **mehreren**
    Kamerapositionen gesehen werden. Das ist der belastbarere Weg: eine einzelne
    Aufnahme zeigt vier bis sieben Zeilen, und drei Parameter aus vier Punkten
    zu schaetzen sagt wenig ueber die Guete.
    """
    ds = np.array([p[0] for p in paare], dtype=float)
    us = np.array([p[1] for p in paare], dtype=float)
    if len(ds) < 5:
        return None
    a, c, rest = _lsq(us, ds)
    if a <= 0:
        return None
    modell = {"a": round(a, 2), "c": round(c, 6)}
    prog = np.array([-welt_y(d + MITTE + cfg["banner_versatz"], 0.0,
                             dict(cfg, y_modell=modell)) for d in ds])
    lin = np.array([-welt_y(d + MITTE + cfg["banner_versatz"], 0.0,
                            dict(cfg, y_modell=None)) for d in ds])
    return {**modell, "punkte": len(ds), "rest_px": round(rest, 2),
            "fehler_welt_max": round(float(np.abs(prog - us).max()), 3),
            "fehler_welt_mittel": round(float(np.abs(prog - us).mean()), 3),
            "linear_fehler_max": round(float(np.abs(lin - us).max()), 3),
            "spanne_px": [round(float(ds.min()), 1), round(float(ds.max()), 1)],
            "spanne_welt": [round(float(us.min()), 1), round(float(us.max()), 1)]}


def fit(reihen_px, cfg: dict, raster: int = 3,
        spanne: float = 1.6, schritt: float = 0.005) -> dict | None:
    """Projektives Y-Modell aus den Pixellagen der Bannerzeilen.

    Bekannt ist nur der *Abstand* der Zeilen (`raster` Welteinheiten), nicht ihre
    Lage. Das Modell erzwingt aber d = 0 bei u = 0 — womit die Lage bestimmt ist,
    sobald mindestens drei Zeilen im Bild stehen. Abgesucht wird sie in einem
    Fenster um die lineare Schaetzung; darin ist der Restfehler eindeutig minimal.
    """
    ds = np.array(sorted(reihen_px), dtype=float)
    ds = np.array([d_von_pixel(v, cfg) for v in ds])
    if len(ds) < 3:
        return None
    skala = cfg["skala_y"]
    # Zeilennummern relativ zur mittelnaechsten Zeile — die ist am wenigsten
    # vom Fehler des Startmassstabs betroffen.
    mitte = int(np.argmin(np.abs(ds)))
    k = np.round((ds - ds[mitte]) / (raster * skala)).astype(int)
    if len(set(k.tolist())) < 3:
        return None

    bestes = None
    u_start = ds[mitte] / skala
    for u_ref in np.arange(u_start - spanne, u_start + spanne + 1e-9, schritt):
        us = u_ref + raster * (k - k[mitte])
        if np.any(np.abs(us) < 1e-9) and abs(u_ref) < 1e-9:
            continue
        a, c, rest = _lsq(us, ds)
        if a <= 0:
            continue
        if bestes is None or rest < bestes[2]:
            bestes = (a, c, rest, us)
    if bestes is None:
        return None
    a, c, rest, us = bestes
    modell = {"a": round(a, 2), "c": round(c, 6)}
    prognose = np.array([welt_y(v, 0.0, dict(cfg, y_modell=modell))
                         for v in sorted(reihen_px)])
    # Welt-Y ist -u; der Fehler ist der Abstand zur eingepassten Rasterzeile.
    fehler_welt = np.abs(-prognose - us)
    # Zum Vergleich derselbe Datensatz mit dem alten einen Faktor.
    linear = np.abs(-np.array([welt_y(v, 0.0, dict(cfg, y_modell=None))
                               for v in sorted(reihen_px)]) - us)
    return {**modell,
            "zeilen": len(ds),
            "rest_px": round(rest, 2),
            "fehler_welt_max": round(float(fehler_welt.max()), 3),
            "fehler_welt_mittel": round(float(fehler_welt.mean()), 3),
            "linear_fehler_max": round(float(linear.max()), 3),
            "spanne_px": [round(float(ds.min()), 1), round(float(ds.max()), 1)]}
