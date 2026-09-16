---
thema: BlueStacks — Emulator, Gesten, Scroll-Hänger, Bilder ins Spiel
code: scripts/bluestacks_start.sh, scripts/touch_aufnahme.py, scripts/ws_service/device.py, messe_rad.py, scripts/bild_nach_bluestacks.sh
verwandt: ws-dienst-anmeldung, kartenarchiv-vollscan, arbeitsweise-sessions
---

# BlueStacks — der Zugang zum Spiel

## Grundeinstellung: immer über das Startskript

`scripts/bluestacks_start.sh` — startet BlueStacks (oder erkennt, dass es läuft),
wartet auf ADB, setzt **2560×2560** und startet Last War neu (das Spiel legt seine
Oberfläche nur beim Start aus). Zurück: `scripts/bluestacks_start.sh reset`.

**Quadratisch ist das Maximum.** Sobald die Breite die Höhe übersteigt, dreht Android
zurück ins Hochformat (`2560x2200` → `2200x2560`). Echtes Vollbild gibt Last War nicht
her — eine Eigenschaft des Spiels, nicht des Emulators.

| Instanz | Fenster auf 1920×1080 | Bildschirmbreite genutzt |
|---|---|---|
| vorher 1440×2560 (9:16) | ≈ 608 × 1080 | 32 % |
| jetzt 2560×2560 (1:1) | ≈ 1080 × 1080 | 56 % — **+78 % Breite** |

**`wm size` ist ein Laufzeit-Override** und überlebt keinen Neustart der Instanz. Deshalb
das Skript bei jedem Start, nicht eine gespeicherte Einstellung. Alle Koordinaten in
`scripts/ws_service/config.json` gelten für 2560×2560; der Dienst prüft die Auflösung
beim Start und bricht ab, statt ins Leere zu tippen.

## Der Touch-Rohbereich bildet X anders ab als Y

Gemessen am 11.09.2026 gegen die Kopfzeile von Androids „Zeigerposition":

- **Y:** 0–32767 ergibt genau die 2560 Bildschirmpixel.
- **X:** der Rohbereich deckt das ganze 16:9-Fenster ab (physisch 2560×1440), der
  quadratische Bildschirm sitzt in dessen Mitte:
  `x = 1280 + (roh/32768 − 0,5) · 4551`

Mit dem naiven Faktor lag ein Tipp bei x≈640 um **280 px** daneben. In der Bildmitte
fällt es nicht auf — deshalb stimmte der Mitschnitt der S-Tasten-Geste (x=1280).
`rad_schritt` in `device.py` rechnet X noch mit dem naiven Faktor; das trifft nur den
seitlichen Versatz der Ausweich-Varianten (80 px werden 45 px).

**Unveränderte Koordinaten meldet `getevent` nicht.** Tippt man zweimal auf dieselbe
Stelle, fehlt beim zweiten Mal die X- oder Y-Zeile. Der Rekorder führt deshalb die
letzte Position je Finger mit; ohne das fielen solche Gesten ganz aus der Aufnahme.

## Touch-Mitschnitt: vormachen statt beschreiben

`scripts/touch_aufnahme.py` schneidet mit, wo jemand tippt und wischt — je Geste eine
Zeile in `gesten.jsonl` plus ein Bildschirmfoto beim Aufsetzen des Fingers. Ablage
`~/.local/state/warsync/aufnahme/<zeit>_<name>/`, `aktuell` zeigt auf den letzten Lauf.

**Mehrfinger-Gesten kann der Dienst gar nicht erzeugen** — er schickt über ADB immer
einen Finger. Sie sind damit der harte Nachweis für eine Hand am Trackpad. Genau das hat
am 16.09.2026 eine falsche Hypothese widerlegt (siehe unten).

Der Rekorder kann still stehenbleiben: Prozess lebt, aber `gesten.jsonl` wächst nicht
mehr, weil die `getevent`-Verbindung beim Beenden von Last War abreißt. Vor dem Auswerten
die Dateizeit prüfen.

## Der Scroll-Hänger — sechs widerlegte Erklärungen

Das teuerste offene Problem des Projekts. Die Liste der Wüstensturm-Anmeldung nimmt
Wische gelegentlich nicht an; ein Lauf bleibt mitten im Kader stehen und sieht hinterher
wie ein vollständiger Scan aus.

| Erklärung | Status |
|---|---|
| Strecke zu kurz (150 px) | widerlegt — Bens Züge waren kürzer und gingen durch |
| Tempo zu langsam | widerlegt — Bens Hand zieht mit 244 px/s und wird angenommen |
| Tempo zu schnell / S-Taste nachbilden (2329 px/s) | widerlegt — bleibt trotzdem hängen |
| fehlender Tipp vor dem Wisch | widerlegt — löste echte Hänger nicht |
| Berührungsdauer 500 ms am Endpunkt | widerlegt — Lauf 6 war der schlechteste der Nacht |
| Langdruck als Auslöser eines Dialogs | widerlegt — löst nachweislich nichts aus |

**Die Gemeinsamkeit aller Messungen: während eines Hängers kommt _keine_ Geste an — jede
misst 0 px.** Es ist also gar keine Frage der Geste. Die App lebt weiter (der übrige
Bildschirm bewegt sich), nur die Liste nimmt nichts mehr an.

**Was übrig bleibt, steht seit dem 02.09.2026 in `device.py`:** *„Last War blockiert beim
Scrollen in unbekanntes Listenterrain kurz selbst. Dagegen hilft nur Zeit, keine
ausgefeiltere Nachbildung."* Der einzige Hänger, der sich von allein löste, tat das nach
**47 Sekunden** — beim sechsten Versuch, dem mit der längsten Pause. Und alle Eingriffe
von Ben haben vor allem Zeit gekostet.

**Die Eingriffskurve ist der klarste Beleg** (Touch-Mitschnitt, 16.09.2026):

| Lauf | Hand-Gesten | zugeordnet |
|---|---|---|
| 3b (00:46) | 2 | 63 |
| 4 (01:11) | 5 | 52 |
| 5 (01:22) | 3 | 55 |
| 6 (01:36) | **0** | 36 |
| 7 (01:51) | **0** | 15 |
| 8 (10:13) | **0**, frisches Spiel | 16 |

Läufe mit Eingriff liegen bei 52–63, Läufe ohne bei 15–36. Es ist **keine** Zeitkurve
(eine „Verfall durch Laufzeit"-Hypothese wurde mit Lauf 8 widerlegt), sondern eine
Eingriffskurve. **Der Scanner kommt ohne Bens Hand nicht durch die Liste.**

Aktueller Stand der Gegenmaßnahmen: `pause_nach_s` 0,9 → **2,5 s** nach *jedem* Schritt
(nicht erst beim Hänger) — die Pause soll verhindern, dass er überhaupt entsteht, statt
ihn hinterher aufbrechen zu wollen. Die Begründung steht als `_kommentar_pause` in
`config.json`.

**Nächster ehrlicher Schritt:** den Mitschnitt einer echten Hand-Geste **roh
nachspielen**, Ereignis für Ereignis über `sendevent`, statt sie weiter nachzubauen.
Sechs Nachbauten sind gescheitert; die Aufnahme enthält das Original.

**Zweiter Hebel, unabhängig vom Hänger: Redundanz.** 42 von 65 Zeilen werden nur
**einmal** gesehen — ein Lesefehler ist sofort ein verlorener Spieler. Bei ~280 px statt
451 px Schrittweite sieht der Scan jede Zeile dreimal und kann die häufigste Lesung
nehmen. Das hat den größeren Effekt aufs Ergebnis.

**Was ausgeschlossen ist:** `adb shell input keyevent 47` hilft nicht — die
Tastenbelegung sitzt in BlueStacks auf dem Mac, nicht in Android; ein über ADB
eingespeister Tastendruck läuft daran vorbei.

**Nachschleudern ist gemessen und unbedenklich:** eine S-Tasten-Geste verschiebt den
Inhalt um median 238 und höchstens 513 px bei 850 px Fensterhöhe. Es kann keine Zeile
durchfallen. **Bewegung < Fensterhöhe** ist die Bedingung, nicht Langsamkeit — bei jeder
Änderung an der Geste nachmessen.

## Nicht nur Hänger: die Sprungweite ist unberechenbar

Beim Schluchtsturm-Rangscan (05.09.2026) hing nichts fest, aber die Sprungweite und
sogar die **Richtung** waren unvorhersehbar: teils bewegte sich bei „vorwärts" kaum
etwas, teils übersprang ein Schritt 5–10 Karten, und ein „rückwärts"-Schritt brachte
weiter nach vorne. Dabei wurden erst beim Zurückscrollen drei Bewerber gefunden, die
beim ersten Durchgang durchgerutscht waren.

## Weitere Ursachen, die geprüft und teils ausgeschlossen sind

- **BlueStacks läuft mit Android 13** → `input motionevent DOWN/MOVE/UP` steht als
  dritter Eingabeweg zur Verfügung (genauere Zeitsteuerung als `input swipe`).
- **Tastenbelegung ist eingeschaltet** (`game_controls_enabled=1`) — diese Ebene *kann*
  Touch abfangen, ist aber nicht belegt.
- **Eco-Modus mit 5 FPS** (Ctrl+Shift+F) — nicht dauerhaft an, würde die Liste aber
  praktisch lahmlegen.
- **macOS App Nap** — BlueStacks ist derzeit nur geschützt, weil es Ton ausgibt. Wird
  das Spiel stumm geschaltet, fällt der Schutz weg. Eine Ausnahme ist nicht eingetragen.
- **Unity liest Touch einmal pro Frame.** Fallen Aufsetzen und Loslassen in denselben
  Frame, entsteht gar kein Ziehen. Die Bot-Projekte ALAS und MAA halten deshalb
  300–500 ms am Endpunkt (`end_hold`). Für Last War ist das gemessen **nicht** die
  Ursache — aber die Quelle der vierten Hypothese.
- **MaaTouch** wäre ein eigener Eingabeweg mit genauer Zeitsteuerung (minitouch läuft
  unter Android 13 nicht). Noch nicht ausprobiert.

## Ein Bild vom Mac ins Spiel bekommen

**Der Media-Scan ist der Hebel, nicht der Ordner.** Last War (`com.fun.lastwar.gp`,
targetSdk 35) fordert **keine einzige** Speicher-Berechtigung an — es nimmt zwingend den
System-Photo-Picker, und der zeigt ausschließlich, was im MediaStore steht. Der
Ordner-Sync von BlueStacks legt Dateien nur ins Dateisystem, ohne sie zu registrieren;
ein Dateimanager zeigt sie trotzdem an. Deshalb sieht es aus wie „ausgewählt, kam aber
nicht an".

```bash
adb -s 127.0.0.1:5555 shell am broadcast \
  -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/DCIM/SharedFolder/<datei>.png
```

**„Pick From Mac" kann nicht übertragen, nur auswählen.** Es gibt auf dem Mac gar keinen
Shared Folder im Dateisystem; während der Picker-Versuche wurde auf dem Gerät keine
einzige Datei geschrieben. Der Picker reicht der App eine Kennung durch, hinter der die
Datei noch auf dem Mac liegt — Last War kann damit nichts anfangen.

**Der Weg:** Bild in Fotos.app → `scripts/bild_nach_bluestacks.sh <datei>` (bzw. „Bild
nach BlueStacks" auf dem Schreibtisch) → im Spiel Chat → Bild anhängen → Album
**WarSync** bzw. „Galerie", **nicht** „Pick From Mac".

**Nach jedem Überschreiben erneut übertragen** — gleicher Dateiname heißt nicht gleicher
Inhalt, und der Index merkt das nicht. Das Skript prüft auf die Dateigröße.

Nebenbei: „💾 Speichern" im Tool liefert PNG (2,6 MB), „📷 In Fotos" das kleine JPEG
(331 KB). Dass „Zu Fotos hinzufügen" im Teilen-Menü fehlte, lag nicht am Format, sondern
an der Kombination **JPEG + `title`** — PNG mit Titel ging, JPEG ohne Titel ging, beides
zusammen nicht. Der Titel ist raus.

## Sessions

- `docs/sessions/2026-09-01-bf7f042a.md` — 2560×2560, Startskript
- `docs/sessions/2026-09-05-bf5133d9.md` — Scrollen unberechenbar, keine Hänger
- `docs/sessions/2026-09-09-82d2eb71.md` — Unity-Frame-Hypothese, ALAS/MAA, `halten_s`
- `docs/sessions/2026-09-15-66cd797b.md` — fünf Erklärungen tot, 47-Sekunden-Hänger,
  `pause_nach_s` 2,5 s
- `docs/sessions/2026-09-16-7f0c9d2c.md` — Eingriffskurve, Verfall-Hypothese widerlegt
- `docs/sessions/2026-09-16-a00bedc9.md` — 6 von 48 langen Wischen mit Standbild
- `docs/sessions/2026-09-02-34114a45.md` — MediaStore, Bild kommt nicht im Chat an
- `docs/sessions/2026-09-02-5b960667.md` — „Pick From Mac" kann nicht übertragen
