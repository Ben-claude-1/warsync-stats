---
thema: Texterkennung — welche Erkennung wofür, und was sie falsch liest
code: scripts/karten_archiv/vision_ocr.swift, banner.py · scripts/ws_service/match.py, aliase.json
verwandt: basen-erkennung, ws-dienst-anmeldung, ws-dienst-ergebnis, vision-server-ports
---

# Texterkennung — welche Erkennung wofür

## Die Rangfolge ist gemessen, nicht geglaubt

Sechs Erkennungen über dieselben 38 handgelesenen Namensschilder, alle mit demselben
Ausschnitt (09.09.2026):

| Erkennung | genau | brauchbar |
|---|---|---|
| **macOS Vision, Farbband** | **33 / 38** | 37 |
| `deepseek-ocr:3b` (Ollama), großer Ausschnitt | 32 / 38 | 36 |
| `deepseek-ocr:3b`, Farbband | 31 / 38 | 36 |
| `qwen2.5vl:7b` (Ollama) | 29 / 38 | 32 |
| Tesseract auf dem Farbband | 27 / 38 | 35 |
| Tesseract auf der Maske (Ausgangsstand) | 24 / 38 | 36 |
| `llama3.2-vision:11b` | — | Ollama lehnt die Anfrage ab |

Eine Zeichenmehrheit über Vision + deepseek + qwen käme auf 35/38 — für **einen** Namen
mehr das Sechzigfache an Rechenzeit (3 s statt 0,05 s je Schild). **Verworfen.**

Mit zwei mechanischen Nachbesserungen stehen im Ablauf **36 von 38**.

## Gelesen wird auf dem farbigen Ausschnitt, nicht auf der Maske

Vision sieht den Grauverlauf der Schrift, den die Maske wegwirft: aus `LittieFighter`
wird `LittleFighter`, aus `marjas2` wieder `marjo42`. Die Maske bleibt nötig — sie sagt,
**wo** das Namensband liegt und welche Farbe die Schrift hat.

**Tesseract bleibt der Rückfall**, wenn Vision nichts liefert oder die Werkzeuge fehlen
(kein macOS, kein Swift). Schlechter, aber der Lauf bricht nicht ab. Die Ziffern des
Stufenschilds liest weiterhin Tesseract mit Ziffern-Whitelist.

**`vision_ocr.swift` läuft als Dienst.** Einzelaufruf 0,17 s, im Dienst 0,05 s je Schild
— bei zweieinhalbtausend Schildern je Archiv der Unterschied zwischen sieben Minuten und
zwei. Wird beim ersten Gebrauch nach `~/.local/state/warsync/vision_ocr` gebaut.

## Zwei mechanische Nachbesserungen holen die letzten Namen

**Zwillinge** (`entzwillingen`): Vision greift regelmäßig zu kyrillischen und
griechischen Doppelgängern lateinischer Zeichen — aus `[XP33]Mo By` wurde `ХРЗЗMo By`,
aus `Commander 1c6a31657` wurde `1сба31657`. Am Bildschirm identisch, in der Suche ein
anderer Name. Ersetzt wird **nur, wenn der Rest lateinisch ist**; ein wirklich
griechisch geschriebener Name (`ΧΑΣΑΠΗΣ`) besteht ganz aus fremden Zeichen und bleibt.

**Vom Spiel vergebene Namen** (`_erzeugten_namen_glaetten`): `Commander`/`Kommandant`
plus Hexzahl. Genau dort verwechselt jede Erkennung `1` mit `l`/`i` — hinter dem Wort
können aber nur Hexziffern stehen, die Korrektur ist also begründet statt geraten.

`name_roh` bleibt davon unberührt — er ist der Beleg und wird nicht geglättet.

## Sprachen: die erste entscheidet

`SPRACHEN_NAMEN` / `SPRACHEN_TEXT` in `ergebnis.py`. Namen liest Vision mit **Japanisch
vorn**, alles andere mit Englisch/Deutsch:

- Mit Englisch/Deutsch kam von `V ベジータ王子` nur `v` an. Japanisch **hinter** Englisch
  änderte gar nichts — die erste Sprache entscheidet.
- Über 80 Zeilen ging kein lateinischer Name verloren, zugeordnet stieg von 78 auf 80.
- **Datum und Kopf bleiben bei Englisch/Deutsch:** mit Japanisch vorn wurde aus
  `22:30:13` einmal `22:30:73` — und an der Uhrzeit hängt, welches Event gemeint ist.
- Zeichen in voller Breite (`［XP33］`) fängt NFKC ab.
- `--sprachen` ist optional; ohne die Angabe liest `vision_ocr.swift` wie bisher, das
  Kartenarchiv ist nicht berührt.

**Griechisch kann Vision gar nicht.** `ΧΑΣΑΠΗΣ` kommt als `XAZANHM` oder `ХАZАПНЕ` an.
Der Abgleich vergleicht deshalb im **Skelett**: griechische und kyrillische Buchstaben
auf ihr lateinisches Gegenstück gebracht, auf beiden Seiten.

## Text wird gelesen, Zustand wird gemessen

Die wichtigste Regel des Projekts für Bilderkennung. Namen liest Tesseract nicht
buchstabengetreu — aus `IIBlackJackII` wird `IBlackJackli`. Das reicht, weil der Name
gegen den Kader abgeglichen wird. Woran die Auswertung wirklich hängt, wird **nicht**
aus Text gewonnen:

- ob ein Badge da ist → Blau-Rot-Abstand der Pixel (Badge ≈ +56, leeres Feld ≈ −2)
- welches Team darin steht → **Vorlagenabgleich** auf dem Buchstaben. Tesseract und
  Vision liefern bei diesem verzierten Einzelzeichen meist gar nichts (`A` in 4 von 10
  Fällen, `B` nie); der Vorlagenabgleich trennt sauber: richtiger Buchstabe 0,96–1,00,
  falscher 0,59–0,68.
- Rang-Balken → **Pixelanteil**, nicht Zeilenmittelwert. Symbole und Zahlen brechen den
  Balken in der Mitte auf; im Mittelwert zerfällt er in zwei dünne Ränder, die durch jede
  Mindesthöhe fallen. Nach Anteil gemessen: Balken 0,6…1,0, Spielerzeilen 0,0.

## Namensabgleich gegen den Kader

**Normalisiert vergleichen** — ohne Leerzeichen, ohne Diakritika, kleingeschrieben. Roh
verglichen fehlten beim T1-Import 38 von 135 Namen; normalisiert waren es drei, und alle
drei waren Zeichenverwechslungen (`lIBlackJackll` ↔ `IIBlackJackII`, `Vicky 1301` ↔
`Vicky13012`, `anyanakamura1` ↔ `ayanakamura1`).

**Bekannte Fehllesungen stehen in `aliase.json`, nicht im Kader.** Wo zwischen Bild und
Kader kein gemeinsames Zeichen steht, hilft kein Ähnlichkeitswert: `ΧΑΣΑΠΗΣ` kommt als
`XAZANHZ` an, das Kapitälchen-Unicode `ꜱɪɴɴᴇʀ` als `SINNER`. Die Datei ordnet dem
**Kadernamen** seine Lesarten zu. Den Kader an die OCR anzupassen wäre falsch — die
Namen im Tool sind richtig.

**Eine Zeile, ein Versuch.** Der Rest-Durchlauf streicht jeden getroffenen Kadernamen aus
dem Kandidatenkreis — das ist richtig, setzt aber voraus, dass jede Zeile ihm genau
*einmal* vorgelegt wird. Steht dieselbe Zeile im nächsten Bild noch einmal da, ist ihr
eigener Name schon weg, und sie bekommt zwangsläufig einen **anderen**: am 16.09.2026
wurde `'JG ASTRID OG'` (116,7M) einmal `ʚɞ ASTRID ʚɞ` (0,60) und einmal `Stargreg` (0,44
bei 1,4 % Kraftabstand). Aus 20 gesetzten Spielern wurden 21, die Gegenprobe fiel durch —
an einem Lauf, der die Liste vollständig gesehen hatte.

**Der erste Anlauf verglich die wörtliche Lesart, und genau daran lief es am 17.09.2026
erneut vorbei.** Dieselbe Ersatz-Zeile kam in vier Bildern als `'JG ASTRID 3g'`,
`'DG ASTRID 3G'`, `'JG ASTRID JG'` und `'JG ASTRID 9G'` an; der Wortvergleich sah vier
verschiedene Dinge, `Stargreg` stand wieder da, und die Ersatzbank hatte 11 von 10
Plätzen. **Eine Zeile ist nicht ihr Text** (`match._dieselbe_zeile`) — wiedererkannt wird
sie an drei Dingen zusammen: Kraftzahl (stabilste Größe, allein aber zu wenig — bei einer
Nachkommastelle sind Doppelungen im Kader zu erwarten), Platz und Abzeichen, und erst
dann der Ähnlichkeit der beiden Lesungen (0,75; `dgastrid3g` gegen `jgastrid3g` kommt auf
0,90). Gefaltet wird **vor** dem Rest-Durchlauf, angetreten ist die häufigste Lesung.

**Im selben Bild entscheidet die Lage statt des Textes.** Beim Scrollen zeichnet die
Liste neu, und ein Bild trifft sie gelegentlich mittendrin: derselbe Kopf wird zweimal
gefunden, ein paar Dutzend Pixel versetzt, und die zweite Lesung fällt entsprechend aus —
`ღ SWORD ღ` stand einmal als `'n3 SWORD n'` und 39 px darüber als `'JOOパンセーとン'`,
`ΧΑΣΑΠΗΣ` als `'XAZANHM'` und `'32020-900'`. Über den Text ist da nichts
wiederzuerkennen, über den Ort schon: zwei *verschiedene* Zeilen liegen in einem Bild
immer eine ganze Zeilenhöhe auseinander (`ZEILE_MIN_ABSTAND_PX` 150, Zeilenhöhe ~210). Das
Abzeichen darf dabei fehlen — `None` heißt „nicht gelesen", nicht „anderes Team" —, und
der **Wert** kommt dann von der sicheren Lesung: es sind dieselben Pixel, einmal besser
und einmal schlechter gemessen, kein zweiter Zustand.

**Verglichen wird auf dem Buchstabenkern.** `ʚɞASTRIDʚɞ` steht im Kader, im MVP-Block kam
`ASTRID 1") |` an: gegen den vollen Namen 0,71 Ähnlichkeit (zu wenig), auf den Kern
gebracht 0,92. Die Schwelle zu senken wäre der schlechtere Weg — sie muss fremde Namen
auseinanderhalten.

**Die übrigen Lesungen zählen mit.** Jede Zeile steht in mehreren Bildern, gewonnen hat
die häufigste Lesung. Chinesische Zeichen liest Vision aber jedes Mal anders:
`小木瓜lemon` kam über dieselben Bilder einmal als Treffer und einmal als `[331/lmn`.
Bleibt ein Name offen, treten die anderen Lesungen gegen den Rest-Kader an — mit der
strengen Schwelle und nur, wenn alle Treffer auf denselben Spieler zeigen.

## Bleibt ein Name unsicher, wird er gemeldet statt geraten

Lieber eine Lücke im Bericht als ein Wert beim Falschen.

## Die Vision-Modelle halluzinieren

Ein leeres 1×1-Pixel liefert am Vision-Server erfundene Spieler mit Punktzahlen statt
einer leeren Antwort. Die erkannten Werte sind ein Vorschlag zum Gegenlesen, keine
Quelle. Für einen einzelnen Wortausschnitt ist die Erfindungsneigung eines
Ollama-Vision-Modells deshalb zu gefährlich.

`deepseek-ocr` braucht einen **kurzen** Befehl (`<image>\nFree OCR.`); auf eine
ausführliche Anweisung antwortet es leer.

## Sessions

- `docs/sessions/2026-09-08-d58e0e54.md` — der Sechser-Vergleich, Zwillinge, Hexziffern
- `docs/sessions/2026-09-08-236e13b5.md` — Mehrfachlesungen, Vision als Gegenprobe
- `docs/sessions/2026-09-11-fd93f9b7.md` — Japanisch vorn, Griechisch aufs Skelett
- `docs/sessions/2026-09-16-a00bedc9.md` — Balkenfarbe unzuverlässig, Namenserkennung
