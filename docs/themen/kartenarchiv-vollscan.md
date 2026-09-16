---
thema: Kartenarchiv — die Weltkarte einmal abfotografieren
code: scripts/karten_archiv/ (sweep.py, ymodell.py, kartenrand.py, eichen_reihen.py, auswerten.py)
verwandt: basen-erkennung, bluestacks-steuerung, texterkennung-ocr, lw-atlas
---

# Kartenarchiv — die Weltkarte einmal abfotografieren

## Worum es geht

Statt für jede Frage neue Screenshots zu machen, wird die Weltkarte **einmal**
kachelweise abfotografiert und als Archiv abgelegt. Jede spätere Auswertung läuft
über dasselbe Material — eine verbesserte Erkennung wird an genau denselben Bildern
gemessen, statt das Spiel erneut abzufahren. Die Auswertung kostet 0,1 s je Kachel,
also gut zwei Minuten für 2000 Kacheln; der Scan kostet Stunden.

Ablage: `~/.local/state/warsync/kartenarchiv/<name>/` — PNG plus JSON mit der
Kameraposition je Kachel. Lauf: `scripts/karten_archiv/im_terminal.sh sweep --von 0 0 --bis 999 999 --name karte`.

## Stand

Zwei Gebiete sind als je eigenes Archiv gescannt (die Zeilennummerierung beginnt je
Lauf bei 0, ein gemeinsames Archiv überschriebe sich selbst). Beide schreiben in
dieselbe Tabelle `karte_basen`.

| Archiv | Gebiet | Basen |
|---|---|---|
| `karte_nah` | Y 1–324 (Kartenrand) | 1399 |
| `karte_kern` | X 442–584, Y 400–594 | 886 |

Zusammen 2285 Basen, alle Server #1668 (Stand 10.09.2026). Der Rest der Karte ist
**nicht** gescannt: der Streifen Y 325–408 und alles außerhalb des Kerngebiets
darunter. Der Vollscan stand bei Zeile 21 von 67 und lässt sich mit demselben Befehl
fortsetzen.

## Die Befunde, die den Scan überhaupt möglich gemacht haben

**Wischen schlägt Springen um das Siebenfache.** Gemessen am 07.09.2026:

| | je Kachel | Zoom | Kachel deckt | Kacheln | Dauer |
|---|---|---|---|---|---|
| Sprung zu Koordinate | 5,5 s | wird zurückgesetzt | 8,3 × 12,5 E | 10.500 | 16 h |
| **Wisch** | **1,4–2,5 s** | **bleibt stehen** | 13,2 × 19,9 E | ~6.300 | ~10 h real |

Der Wisch gewinnt zweimal: schneller *und* der herausgezoomte Zustand bleibt stehen,
jede Kachel deckt also die vierfache Fläche ab. Die **Trägheit ist kein Blocker** —
Drift 0,59 Welteinheiten über 15 Wische ohne jede Kontrolle.

**Der Lupe-Dialog setzt den Zoom nicht zurück, nur „Suchen" tut das.** Damit ist der
Dialog eine reine Positionsanzeige: die Wisch-Navigation muss ihre Schwenkweite nicht
raten, sie kann jederzeit nachfragen. Genau das fehlte allen drei früheren Anläufen.

**Die Karte ist gemessen, nicht geschätzt:** `kartenrand.py` tastet die Grenzen per
Intervallhalbierung über den Lupe-Dialog ab — exakt **X 0…999, Y 0…999**. Springt man
darüber, nimmt das Spiel den Wert gar nicht an; daran ist der Rand erkennbar. Ein zu
weit gestecktes Rechteck hätte stundenlang über Gebiet gefahren, das es nicht gibt.

**Namen gibt es nur auf der maximalen Zoomstufe.** Eine Stufe heraus ersetzt das Spiel
die Banner durch Symbole — kein OCR-Problem, eine Eigenschaft des Spiels.

| Zoomstufe | Kadertreffer | sichtbar |
|---|---|---|
| maximaler Zoom | 4 | Namensbanner lesbar |
| eine Stufe heraus | 0 | Symbole |
| zwei Stufen heraus | 0 | nur Symbole |

**Das Y-Modell** (`ymodell.py`, `d = a·u/(1+c·u)`) senkt den Rasterfehler von 0,486 auf
**0,009 Einheiten**. Gefittet an den Bannerreihen *ohne* bekannte Koordinaten (die
Reihen stehen 3 Einheiten auseinander), damit die per Stern-Dialog abgelesenen
Wahrheiten als unabhängige Gegenprobe übrig bleiben. Dabei kam heraus, dass **auch X
an demselben Parameter hängt** (einfach statt doppelt) — das erklärt die alten
X-Restfehler vollständig.

## Fallen, die je einen Lauf gekostet haben

- **Die Y-Ziffern stehen weiß auf einem durchscheinenden Feld.** Mit fester Schwelle
  kam über hellem Gelände `52` statt `534` heraus. Ein solcher Verleser hätte die
  Kamera scheinbar um 482 Einheiten versetzt und **alle folgenden Kacheln still an der
  falschen Stelle abgelegt** — die schlimmste Fehlerart für ein Archiv, weil es
  hinterher vollständig aussieht. Heute: vier Schwellen × drei Segmentierungsmodi mit
  Mehrheitsentscheid (6/6 statt 1/6 richtig) plus Plausibilitätsschranke. Die Schranke
  darf **nicht** aus der eigenen Messreihe kommen — der erste Versuch leitete sie aus
  dem Median ab, ein verlesener Wert vergiftete ihn, danach wurde alles Richtige
  verworfen.
- **Der Stillstands-Wächter ist Pflicht.** Nimmt die Karte den Wisch nicht an, ist das
  nächste Bild dasselbe; der Vorlagenabgleich findet brav „Verschiebung null", meldet
  gute Güte, und die Schleife legt Kachel um Kachel derselben Stelle ab, bis die Platte
  voll ist. Zwei Wachen: gleicher Bildhash → Zeile sofort abbrechen (das ist kein
  Verdacht, sondern eine Tatsache); zu kleiner Schritt dreimal in Folge → Abbruch.
- **Das Zeilenende liegt nicht in der Kameramitte.** Die Abbruchbedingung verlangte die
  Mitte bei X 999; eine Kachel zeigt aber auch rechts von ihrem Mittelpunkt Karte
  (6,05 E weiter). Drei von vier „gescheiterten" Zeilen waren dadurch **in Wirklichkeit
  fertig** (kamen bis X 993–998), wischten dann gegen den Kartenrand, meldeten Güte 0
  und beendeten nach drei Ausfällen den ganzen Lauf.
- **Strg-C tötet die ganze Vordergrund-Prozessgruppe** — also auch `tee` und das
  laufende `adb screencap`. Beides ist abgefangen; der Merkpunkt wird nach *jeder*
  Kachel fortgeschrieben und nennt immer eine Kachel, die auf der Platte liegt.
  Derselbe Aufruf setzt mitten in der Zeile wieder auf, nicht erst an ihrem Anfang.
- **Eine gescheiterte Zeile beendet den Lauf nicht.** Jede Zeile beginnt mit einem
  absoluten Sprung, ist also unabhängig. Erst drei in Folge heißt, dass das Spiel
  woanders steht.
- **`eichen_reihen.py` lief versehentlich auf der Sprung-Stufe**, verglich ein Bild mit
  sich selbst und überschrieb eine gute Eichung (199 px/E) mit 211. Es weigert sich
  jetzt auf Stufen ohne Herauszoom-Geste und bei über 8 % Abweichung.
- **„WELT" und „BASIS" sitzen an derselben Stelle** — ein blinder Tap landete über
  „Allianz" im Chat. Zurück geht es nur noch über `KEYCODE_BACK`.
- **Das Konto kann nur an einem Gerät aktiv sein.** Ein Scan wirft Ben für die Dauer
  vom Handy. Vor einem mehrstündigen Lauf deshalb fragen, nicht starten — am
  11.09.2026 stand um 13:00 der Wüstensturm an.

## Selbstprüfung

Überlappung von etwa einem Drittel bis 75 % ist nicht Verschwendung, sondern die
Kontrolle: dieselbe fremde Basis aus zwei Kacheln ergab 537,6 und 537,4. Fremde Basen
landen auf dem 3-Einheiten-Raster (Y ≡ 2 mod 3, wie im eigenen Hive). Die Position
kommt aus zwei Quellen, keine davon eine Annahme — Vorlagenabgleich in der Überlappung
plus Nachfrage beim Lupe-Dialog alle 15 Kacheln.

## Sessions

- `docs/sessions/2026-09-06-5723e3d1.md` — Spielerpositionen im Atoll: Zoomstufen
  gemessen, Skala geeicht, +0,6 E Abweichung in X
- `docs/sessions/2026-09-07-f9d406eb.md` — Wischen statt Springen, 7× schneller
- `docs/sessions/2026-09-07-1a507d83.md` — Sweep läuft (2,46 s/Kachel), Y-Modell trägt
- `docs/sessions/2026-09-07-fb02f5f1.md` — Vollscan gestartet, Kartenrand gemessen,
  Merkpunkt + Stillstands-Wächter
- `docs/sessions/2026-09-07-15d63953.md` — sieben Fehlerquellen, drei „Ausfälle" waren
  fertige Zeilen
- `docs/sessions/2026-09-08-108be771.md` — Vollscan mit Notsprüngen, Auswertung kostet
  0,1 s/Kachel
- `docs/sessions/2026-09-11-bd4691bc.md` — Fortsetzung `karte_nah`: 50 Zeilen offen,
  5½–6 h, nicht gestartet wegen Konto-Kollision
