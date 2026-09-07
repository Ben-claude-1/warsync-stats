"""Zoom als Zwei-Finger-Geste, und die Zoomstufe als Rezept.

**Strg+Mausrad hilft nicht.** Die Uebersetzung passiert *in* BlueStacks, bevor das
Ereignis Android erreicht; wer wie hier per `sendevent` direkt auf das
Eingabegeraet schreibt, umgeht sie und muss die Pinch-Geste selbst bauen.
`getevent -pl` bestaetigt ABS_MT_SLOT (bis 16 Punkte), also Multitouch-Protokoll B.

**Die Finger muessen erst ruhig liegen.** Ohne die kurze Pause nach dem Aufsetzen
wertet das Spiel die Geste als Wisch statt als Pinch — der Bildausschnitt
verschiebt sich dann, statt zu zoomen.

**Der Zoom ist stufenlos.** Es gibt keine Rasten, auf die man sich verlassen
koennte; eine Stufe ist deshalb ein Rezept aus einer festen Zahl Gesten,
beginnend am Anschlag. Wer relativ zum letzten Stand zaehlt, sammelt Drift.
"""
from __future__ import annotations

import time

import numpy as np

_EV_SYN, _EV_KEY, _EV_ABS = 0, 1, 3
_SYN_REPORT = 0
_BTN_TOUCH = 0x14A
_ABS_MT_SLOT = 0x2F
_ABS_MT_POSITION_X, _ABS_MT_POSITION_Y = 0x35, 0x36
_ABS_MT_TRACKING_ID = 0x39
_DEV = "/dev/input/event2"
_FAKTOR = 32768 / 2560


def _ev(typ: int, code: int, wert: int) -> str:
    return f"sendevent {_DEV} {typ} {code} {wert}"


def pinch(g, von_px: int, nach_px: int, cx: int = 1280, cy: int = 1280,
          punkte: int = 30, takt: float = 0.04) -> None:
    """Zwei Finger auf einer Waagerechten durch (cx, cy); Abstand von→nach je Seite."""
    def p(v: float) -> int:
        return int(v * _FAKTOR)

    teile: list[str] = []
    for slot, vz in ((0, -1), (1, +1)):
        teile += [_ev(_EV_ABS, _ABS_MT_SLOT, slot),
                  _ev(_EV_ABS, _ABS_MT_TRACKING_ID, slot),
                  _ev(_EV_ABS, _ABS_MT_POSITION_X, p(cx + vz * von_px)),
                  _ev(_EV_ABS, _ABS_MT_POSITION_Y, p(cy))]
    teile += [_ev(_EV_KEY, _BTN_TOUCH, 1), _ev(_EV_SYN, _SYN_REPORT, 0)]
    teile += ["sleep 0.35", _ev(_EV_SYN, _SYN_REPORT, 0)]

    for i in range(1, punkte + 1):
        abstand = von_px + (nach_px - von_px) * i / punkte
        teile.append(f"sleep {takt}")
        for slot, vz in ((0, -1), (1, +1)):
            teile += [_ev(_EV_ABS, _ABS_MT_SLOT, slot),
                      _ev(_EV_ABS, _ABS_MT_POSITION_X, p(cx + vz * abstand))]
        teile.append(_ev(_EV_SYN, _SYN_REPORT, 0))

    for slot in (0, 1):
        teile += [_ev(_EV_ABS, _ABS_MT_SLOT, slot),
                  _ev(_EV_ABS, _ABS_MT_TRACKING_ID, -1)]
    teile += [_ev(_EV_KEY, _BTN_TOUCH, 0), _ev(_EV_SYN, _SYN_REPORT, 0)]

    g._sh("shell", ";".join(teile), timeout=120)
    # Grosszuegig: folgt die naechste Geste zu schnell, **schluckt das Spiel sie**.
    # Am 07.09.2026 griffen bei 1,0 s nur zwei von vier Herauszoom-Gesten — der
    # Zoom stand danach zwei Stufen zu weit innen, ohne dass etwas gemeldet wurde.
    # Der Zoom wird einmal je Lauf gestellt, die Sekunde kostet also nichts.
    time.sleep(1.8)


def lupe_da(bild_rgb: np.ndarray, cfg: dict) -> bool:
    """Ist der Lupe-Knopf sichtbar — also: sind wir im Detailmodus?

    Das Spiel koppelt drei Dinge an dieselbe Schwelle: Namensbanner, volles HUD und
    den Koordinatensprung. Im Uebersichtsmodus gibt es keines davon; ein Tap auf die
    Lupenstelle landet dort auf der Karte und oeffnet womoeglich eine fremde Basis.
    Der Knopf wird deshalb gesehen, nicht unterstellt.
    """
    x0, y0, x1, y1 = cfg["lupe_box"]
    a = bild_rgb[y0:y1, x0:x1].astype(float)
    anteil = float(((a[:, :, 2] > 150) & (a[:, :, 2] - a[:, :, 0] > 40)).mean())
    return anteil > cfg["lupe_blau_schwelle"]


def stufe(cfg: dict, name: str | None = None) -> dict:
    """Konfiguration fuer eine Zoomstufe — Massstab, Bannergroesse, Kachelschritt.

    Alles, was der Zoom veraendert, steht je Stufe getrennt: Massstab, Versatz,
    Bannergroesse, Kachelschritt. Die Stufe `sprung` traegt die Werte von oben
    aus der Datei, weil dort jeder Koordinatensprung landet.

    Ohne diese Trennung rechnete die Wisch-Navigation mit den Zahlen der
    Sprung-Stufe und laege um den Faktor 1,6 daneben — und weil beide Zahlen
    plausibel aussehen, faellt so etwas erst an den Koordinaten auf.
    """
    name = name or cfg.get("stufe", "sprung")
    werte = cfg.get("stufen", {}).get(name)
    if werte is None:
        raise KeyError(f"Zoomstufe {name!r} steht nicht in der Konfiguration")
    return {**cfg, **{k: v for k, v in werte.items() if not k.startswith("_")},
            "stufe": name}


def nach_sprung(g, cfg: dict) -> None:
    """Die Herauszoom-Gesten der Stufe — **nach** jedem Sprung.

    Der Sprung setzt den Zoom auf die Standardstufe zurueck. Wer weiter draussen
    fotografieren will, muss das also jedes Mal neu herstellen; bei der
    Wisch-Navigation faellt das nur einmal je Zeile an, nicht je Kachel.

    **`raus_geste` waehlt, wie grob gezoomt wird.** Lange kannte diese Stelle nur
    `zoom_raus_gross` — eine Geste, ein Faktor 0.55, und damit einen Sprung ueber
    alles hinweg, was dazwischen liegt. Am 08.09.2026 gemessen: genau dort liegt
    der brauchbare Bereich. Bei Bannerhoehe 35 px faellt die Namenserkennung auf
    30 %, bei 47 px haelt sie 67 % — so gut wie auf der nahen Stufe, bei halber
    Laufzeit. Diese 47 px sind zwei *kleine* Gesten, die vorher niemand fahren
    konnte.
    """
    art = cfg.get("raus_geste", "gross")
    welche = cfg["zoom_raus"] if art == "klein" else cfg["zoom_raus_gross"]
    for _ in range(int(cfg.get("raus_gesten", 0))):
        pinch(g, *welche)


# „Spiel verlassen?" — der Dialog, in dem die Zurueck-Taste aus der Basis-Ansicht
# heraus landet. Gemessen am 07.09.2026 ueber drei Zustaende (Dialog, Weltkarte,
# Basis): der gelbe Knopf links (236/188/41) und der blaue rechts (38/180/237)
# kommen so nur hier vor, in den anderen beiden liegt dort Gelaende.
VERLASSEN_JA = (855, 1350, 1230, 1500)     # „Abbrechen" — gelb
VERLASSEN_NEIN = (1329, 1350, 1704, 1500)  # „Bestaetigen" — blau
VERLASSEN_TAP = (1042, 1425)               # Mitte von „Abbrechen"


def verlassen_dialog_da(bild_rgb: np.ndarray) -> bool:
    """Steht „Spiel verlassen?" offen?

    **Die Zurueck-Taste ist nur fast harmlos.** Sie schliesst Ueberlagerungen und
    verlaesst die Basis — aber in der Basis-Ansicht selbst oeffnet sie diesen
    Dialog. Am 07.09.2026 blieb ein Lauf genau dort stehen: dreimal zurueck, und
    das Spiel fragte, ob es beendet werden soll. Weiter zurueckzudruecken ist
    dann die eine Geste, die man nicht blind schicken darf.
    """
    a = np.asarray(bild_rgb, dtype=float)
    x0, y0, x1, y1 = VERLASSEN_JA
    gelb = a[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    x0, y0, x1, y1 = VERLASSEN_NEIN
    blau = a[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    return bool(gelb[0] > 200 and gelb[1] > 150 and gelb[2] < 100
                and blau[2] > 200 and blau[0] < 100)


def welt_sicherstellen(g, cfg: dict, bild, versuche: int = 3, log=print) -> bool:
    """Zurueck auf die Weltkarte — ueber die Zurueck-Taste, nicht ueber einen Tap.

    **Der Anschlag beim Hineinzoomen ist keiner.** Zoomt man ueber die innerste
    Kartenstufe hinaus, wechselt das Spiel in die Basis-Ansicht; dort gibt es
    weder Lupe noch Karte.

    **Der Rueckweg ist `KEYCODE_BACK`, und zwar aus einem harten Grund.** Der
    Knopf „WELT" der Basis-Ansicht sitzt an genau derselben Stelle wie „BASIS"
    auf der Weltkarte — ein Tap dorthin ist also nur richtig, wenn die Annahme
    „wir sind in der Basis" stimmt. Am 07.09.2026 stimmte sie nicht: der Lauf
    stand auf der Weltkarte, tippte auf „BASIS", war danach wirklich in der
    Basis, tippte erneut und landete ueber „Allianz" im Chat. Ein blinder Tap
    macht aus einer falschen Vermutung also einen echten Fehlzustand.

    Die Zurueck-Taste hat diese Eigenschaft nicht: sie schliesst Ueberlagerungen
    und verlaesst die Basis, und auf der Weltkarte tut sie nichts Schaedliches.
    Sie ist damit die einzige Geste, die man ohne sichere Zustandskenntnis
    schicken darf.
    """
    for i in range(versuche):
        im = bild()
        if lupe_da(im, cfg):
            if i:
                log("Weltkarte wieder erreicht.")
            return True
        if verlassen_dialog_da(im):
            # Hier ist der Zustand ausnahmsweise **bekannt**, und nur deshalb darf
            # getippt werden: noch eine Zurueck-Taste beantwortet die Frage nicht,
            # sie stellt sie erneut. Und weil dieser Dialog nur in der Basis-Ansicht
            # aufgeht, ist auch „WELT" hier eindeutig — sonst waere er es nicht.
            log('„Spiel verlassen?“ steht offen — Abbrechen, dann WELT.')
            g.tippen(*VERLASSEN_TAP, pause=1.5)
            if cfg.get("welt_knopf"):
                g.tippen(*cfg["welt_knopf"], pause=3.0)
            continue
        log("Keine Lupe sichtbar — Zurueck-Taste (Basis-Ansicht oder Ueberlagerung).")
        g.zurueck(pause=2.0)
    return lupe_da(bild(), cfg)


def stufe_einstellen(g, cfg: dict, bild=None, log=print) -> None:
    """Auf die konfigurierte Zoomstufe fahren — immer vom Anschlag aus.

    `bild` ist der Bildlieferant; ohne ihn entfaellt die Pruefung, ob das
    Hineinzoomen in die Basis-Ansicht gefallen ist.
    """
    for _ in range(cfg["zoom_saettigen"]):
        pinch(g, *cfg["zoom_rein"])
    if bild is not None and not welt_sicherstellen(g, cfg, bild, log=log):
        raise RuntimeError('Weltkarte nicht erreichbar — weder Lupe noch „WELT“.')
    for _ in range(cfg["zoom_stufe"]):
        pinch(g, *cfg["zoom_raus"])
    log(f"Zoomstufe {cfg['zoom_stufe']} eingestellt "
        f"({cfg['skala_x']:.1f} px je Welteinheit in X)")
