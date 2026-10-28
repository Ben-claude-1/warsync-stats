---
thema: Dienst — Zu- und Abgänge aus dem Allianz-Protokoll
code: scripts/allianz_protokoll/ (run.py, lesen.py), db/2026-10-28_allianz_protokoll.sql, scripts/routinen/starter.py
verwandt: lw-atlas, spielerdaten, bluestacks-steuerung, texterkennung-ocr, vs-duell
---

# Dienst — wer ist gekommen, wer ist gegangen

## Worum es geht

LW Atlas wird abgeschaltet, und damit der Kaderabgleich, der bisher Zu- und Abgänge
lieferte. Last War führt dieselbe Auskunft selbst, und genauer: **Allianz → Verlauf →
Reiter „Mitglieder"** listet jeden Beitritt, Austritt, Rauswurf und jede Rangänderung mit
Datum und Uhrzeit. Vorgemacht von Ben am 28.10.2026 (Mitschnitt
`~/.local/state/warsync/aufnahme/20261028_005604_allianz_zu_abgaenge`).

```
.venv/bin/python -u -m scripts.allianz_protokoll.run               # lesen, Bericht
.venv/bin/python -u -m scripts.allianz_protokoll.run --schreiben   # und eintragen
.venv/bin/python -u -m scripts.allianz_protokoll.run --alles       # bis ans Listenende
.venv/bin/python -m scripts.allianz_protokoll.run --ordner <pfad>  # aus Bildern neu rechnen
```

Nachts als Routine **„Allianz-Protokoll lesen"** im Hub (Gruppe WarSync, cron
`30 4 * * *`) über den Starter (`allianz-protokoll` in `scripts/routinen/starter.py`).
04:30, weil der VS-Scan um 05:00 ebenfalls BlueStacks steuert. Eine Nacht ohne Neues
kostet ein Bild und rund 30 s.

**Das Protokoll ist besser als der Atlas-Abgleich, nicht nur ein Ersatz.** Der Atlas
lieferte zwei Stände, und der Unterschied war zu erraten — die Hälfte der vermeintlichen
Abgänge am 12.09.2026 waren Umbenennungen (siehe `lw-atlas.md`). Hier steht der Satz
ausdrücklich da.

## Was ein Eintrag ist

| Satz im Spiel | Symbol | `art` |
|---|---|---|
| „X hat die Allianz verlassen." | rot | `abgang` |
| „Y hat X aus der Allianz entfernt." | rot | `entfernt` |
| „Y hat die Beitrittsanfrage von X akzeptiert." | blau | `zugang` |
| „Y hat den Rang von X von 3 auf 1 geändert." | gelb | `rang` |

Unbekannte Sätze werden `sonstig` mit dem Rohtext gespeichert — so fällt eine neue Art
auf, statt still zu fehlen.

**Die Symbolfarbe ist die Gegenprobe zum Satz.** Gemessen an sechs Karten: rot 0,31 ·
blau 0,33 · gelb 0,14–0,16 Pixelanteil, die anderen beiden Farben je 0,00–0,01.
Widersprechen sich Satz und Farbe, wird der Eintrag nicht angewendet — ein falsch
verstandener Satz nähme sonst jemanden aus dem Kader, der gerade beigetreten ist.

## Was der Lauf im Kader nachzieht

Über **alle** Einträge der Tabelle, je Spieler der **jüngste**: zuletzt gegangen →
`active=false`, zuletzt beigetreten und im Kader → `active=true`, letzter Rang → `role`.
Das ist idempotent (ein zweiter Lauf ändert nichts) und unabhängig davon, ob eine Nacht
ausgefallen ist. skyluna ist am 23.10. gegangen und am 24.10. zurückgekommen — und steht
genau so im Kader.

**Neuzugänge werden angelegt** (Vorgabe Ben, 28.10.2026: „die Informationen sollen
automatisch ein Update im Tool machen") — mit der häufigsten Lesung des Namens, dem Rang
aus dem Protokoll (sonst R1), `profession` Ingenieur, wie „Neuen Spieler anlegen". Danach
zeigen ihre Protokollzeilen auf den neuen Kadernamen, sonst legte der nächste Lauf ihn
ein zweites Mal an. Zwei Ausnahmen: wer nach dem Beitritt wieder gegangen ist, und wessen
Name einem Kadernamen zu ähnlich ist (`ANLEGEN_HOECHSTENS` 0,6) — das ist eher eine
Fehllesung eines Bekannten, und ein Doppel im Kader wäre schwerer zu finden als ein
fehlender. Beides steht im Bericht.

Ob der angelegte Name stimmt, prüft der WS-Suchlauf: `suchlauf --namen <name>` findet nur,
was das Spiel genau so schreibt. Mit `--namen` sucht er seit 28.10.2026 auch Stillgelegte —
so lässt sich belegen, dass ein als ausgetreten Erkannter wirklich weg ist.

## Wann der Lauf aufhört

Gelesen wird von neu nach alt. Zwei Wege, Bekanntes zu erkennen:

- **Der neueste Eintrag in `allianz_protokoll`.** Zeigt ein Bild einen älteren, ist
  alles Neue gesehen.
- **Der Kader selbst** — Vorgabe Ben: „sobald du eine Zeile findest, die schon mit dem
  aktuellen Stand zusammenpasst, kannst du abbrechen". Das trägt auch bei leerer Tabelle.

**Nicht eine Zeile, sondern drei Zu-/Abgänge in Folge** (`PASST_IN_FOLGE`). Beim ersten
Lauf am 28.10. passte skyluna (Zugang 24.10.) bereits — direkt dahinter standen
lemon小木瓜 und I54I (Abgang 23.10.), beide im Tool noch aktiv. Beim ersten Treffer
abzubrechen hätte genau sie verloren. Ein Eintrag, den ein jüngerer desselben Spielers
überholt hat, zählt dabei nicht; Rangänderungen zählen nicht, weil Ränge auch von Hand
gepflegt werden.

## Was beim Lesen schiefging, bevor es stimmte

- **Tesseract findet „Allianz" und „Verlauf" nicht** — die Knopfschrift ist verziert.
  Navigation und Liste laufen deshalb über macOS Vision (`ergebnis.zeilen_lesen`,
  Japanisch zuerst wegen `V ベジータ王子`, `lemon小木瓜`).
- **Das „R" im gelben Rang-Symbol wurde als Text gelesen** (`von2 R auf 1`). Text erst ab
  x=880.
- **Fehlt ein Zeitstempel, verschmelzen zwei Karten.** So stand `SyDdu38` (21.10.) als
  zweiter Eintrag unter dem 20.10. Eine Karte ist höchstens 300 px hoch, und eine Lesung
  mit zwei Sätzen („… hat … hat …") zählt nicht.
- **Einblendungen** („Sarahs Geschenk erhalten!") legen sich über eine Karte. Der Lauf
  nimmt das Bild dann 2,5 s später neu auf; zusätzlich gewinnt über mehrere Bilder die
  Lesung, die einen Satz ergibt.
- **Die oberste Karte zählt nur im ersten Bild** — später kann sie oben angeschnitten
  sein; sie stand im Bild davor ganz da.
- **Derselbe Eintrag wird verschieden gelesen** (`I54I` als `154I` und `1541`). Doppelt
  eingetragen wird trotzdem nicht: „schon da" heißt gleiche Sekunde, gleiche Art,
  ähnlicher Name. Die Zuordnung zum Kader hilft `aliase.json` (`I54I`, `H一A一N一A一Nツ`
  — Vision liest den Strich als `ー`).
- **Stand das Protokoll schon offen**, wartete der Lauf drei Minuten auf die Basis. Jetzt
  wird erst der Titel geprüft, und „Krieg" → „Mitglieder" setzt die Liste an den Anfang.

## Erster Lauf (28.10.2026)

25 Einträge vom 12.10. bis 27.10., 13 Bilder. Nachgezogen: **fünf Abgänge** stillgelegt
(I54I, lemon小木瓜, Efraim Mafia, V ベジータ王子, MAD ZOIDBERG — genau die fünf, die der
WS-Suchlauf am selben Abend „im Spiel nicht gefunden" hatte) und **sieben Ränge**
(SyDdu38 R2, Redloq R1, KiLLuminaTi R1, Longrow R4, Republica58 R1, Plag3 R3, CROWNY R4).

**Gegenprobe am selben Abend:** 93 aktive Spieler im Tool gegen „Mitglieder 93/100" im
Spiel. Der WS-Suchlauf fand alle sieben als ausgetreten Erkannten nicht mehr (die fünf
von heute, I54I, NuSReT, H一A一N一A一Nツ), die beiden Neuzugänge skyluna und Desnodus
dagegen schon — beide für 12:00 gemeldet.

## Sessions

- 28.10.2026 — Mitschnitt, Dienst gebaut, erster Lauf, Routine 04:30
