---
thema: Dienst — Kampfergebnis aus dem Postfach lesen
code: scripts/ws_service/ergebnis.py, eintragen.py · Tabellen ws_events, ws_participation, ws_aussetzen
verwandt: ws-dienst-anmeldung, texterkennung-ocr, anmeldung-rotation-ersatz, wuestensturm
---

# Dienst — Kampfergebnis aus dem Postfach

## Worum es geht

`scripts/ws_service/ergebnis.py` liest die Rangliste aus der Mail
„[Wüstensturm]-Kampfergebnis!": Basis → Mail → Ordner „Event" → Mail öffnen → unter
„Individuelle Punkte" herunterscrollen. Heraus kommen Platz, Name und Punkte je Spieler,
die Gesamtpunkte beider Allianzen und die Zuordnung zum Kader. Ohne `--schreiben` bleibt
es beim Bericht.

```
.venv/bin/python -m scripts.ws_service.ergebnis            # neuestes Ergebnis
.venv/bin/python -m scripts.ws_service.ergebnis --nr 2     # das zweitneueste
.venv/bin/python -m scripts.ws_service.ergebnis --pruefen  # nur das aktuelle Bild
.venv/bin/python -m scripts.ws_service.ergebnis --schreiben
.venv/bin/python -m scripts.ws_service.ergebnis --bericht <ordner> --schreiben
.venv/bin/python -m scripts.ws_service.ergebnis --offen --hierbleiben
.venv/bin/python -m scripts.ws_service.ergebnis --offen --alias skyluna=senasinasona
```

Berichte und Belegbilder: `~/.local/state/warsync/ws_ergebnis/<zeit>/`. Erster Lauf am
11.09.2026: 28 Spieler, 26 sofort zugeordnet, alle Gegenproben grün. Der ganze Durchlauf
(Basis → Mail → Rangliste → zurück) dauert rund 80 Sekunden.

## Was `--schreiben` einträgt

`eintragen.py`: Gesamtpunkte, Sieg/Niederlage, Gegner-Server und MVP am Event;
`played`/`individual_pts`/`rank` an jeder Kaderzeile; wer ohne Kaderplatz mitgespielt
hat, mit `registered=false`. Wer im fixierten Kader stand und in der Liste fehlt, bekommt
`played=false` (die Oberfläche zeigt „Gefehlt") **und setzt beim nächsten Wüstensturm
aus**. Die Ersatzbank zählt mit — im Wüstensturm spielen alle 30 gleichzeitig.
Entschuldigte und Warteliste setzen nicht aus. Namen ohne Kadertreffer werden nicht
eingetragen, nur gemeldet.

**Drei Sperren, mit `--erzwingen` zu übergehen:** die Gegenprobe muss aufgehen,
mindestens die Hälfte der Gelesenen muss im Kader des Events stehen (sonst ist es die
Mail des anderen Teams), höchstens zehn Fehlende. Vorher liegt eine Sicherung im
Berichtsordner. Welches Event gemeint ist, ergibt sich aus Datum und Uhrzeit der Mail;
spielen A und B zur selben Zeit, entscheidet der Kader.

## Fünf Dinge, die nicht wegoptimiert werden dürfen

**Der Platz kommt aus der Reihenfolge auf dem Bildschirm** — weder aus der Platzziffer
(verzierte Schrift, aus 11 wird 17) noch aus der Punktzahl. Nach Punkten zu sortieren
lässt ausgerechnet die Zahl über den Platz entscheiden, die falsch gelesen sein kann: im
Test rutschte `Republica58` mit einer verdeckten Ziffer von Platz 2 auf Platz 24, ohne
dass es auffiel. Die Bilder werden über gemeinsame Zeilen aneinandergelegt (`_einfuegen`).

**Drei Gegenproben:** Punkte fallen von oben nach unten, gelesene Platzziffern passen zur
Position, und jedes Bild teilt eine Zeile mit dem vorigen — sonst fehlt dazwischen etwas.

**Gelesen wird mit Lage** (`vision_ocr.swift --boxen`): Platz, Name und Punkte sind drei
getrennte Texte, erst die Lage sagt, was zu einer Zeile gehört. Gesperrt geschriebene
Namen (`H  A  N  A  N`) liefert Vision als Einzelstücke nebeneinander; alles rechts vom
Namen auf seiner Höhe gehört dazu. Die Mails im Ordner werden über ihren **Titel**
gesucht, nicht über eine Stelle — eine neue Mail oben verschiebt alle anderen.

**Die übrigen Lesungen zählen mit.** Jede Zeile steht in mehreren Bildern, gewonnen hat
die häufigste Lesung. Bleibt ein Name offen, treten die anderen Lesungen gegen den
Rest-Kader an, mit der strengen Schwelle und nur, wenn alle Treffer auf denselben Spieler
zeigen. Verglichen wird im **Skelett** (griechisch/kyrillisch → lateinisch).

**Namen mit Japanisch vorn, alles andere mit Englisch/Deutsch** — Details in
`texterkennung-ocr.md`. Datum und Kopf bleiben bei Englisch/Deutsch: mit Japanisch vorn
wurde aus `22:30:13` einmal `22:30:73`, und an der Uhrzeit hängt, welches Event gemeint
ist.

## Ältere Ergebnisse nachtragen

`--offen` liest die Mail, die gerade offen ist: das Skript scrollt sie an den Anfang
zurück (dort stehen die Gesamtpunkte) und navigiert nicht selbst. Zwei Dinge sind anders:

- **Umbenannte Spieler** stehen in der Mail unter dem Namen, der zum Kampf galt.
  `--alias ALT=NEU` (mehrfach möglich) ordnet sie zu; ohne den Hinweis sieht kein
  Abgleich, dass `skyluna` und `senasinasona` dieselbe Spielerin sind.
- **Aussetzen wird nicht geschrieben, wenn der Kader der Folgewoche schon steht.** Die
  Marke käme zu spät und stünde als Behauptung über eine Woche da, in der längst gespielt
  wurde. Das Fehlen selbst steht trotzdem im Event.

## Der MVP-Block

Gelesen von `mvp_lesen`; geschrieben werden
`mvp_overall`/`mvp_kills`/`mvp_conquest`/`mvp_collect` in `ws_events` (die Spalten gab es
schon; gefüllt war nur `mvp_overall`, und zwar aus Platz 1 der Rangliste statt aus dem
Block). Drei Fallen:

- **Erst paaren, dann zuordnen.** Rechts neben der Beschriftung steht auch das Bild des
  Spielers, und dessen Aufschrift (`GENERAL`, `BLÜCHER`) liegt der Zeile näher als der
  Name. Ein Eintrag ist nur, was einen **Wert direkt unter sich in derselben Spalte** hat.
- **Der Name steht über seiner Beschriftung**, nie darunter — bei einzeiliger 39 px, bei
  zweizeiliger 102 px. Symmetrisch gegriffen holte die Eroberungszeile den Sammel-Besten,
  der 86 px darunter steht.
- **Verglichen wird auf dem Buchstabenkern** — `ʚɞASTRIDʚɞ` gegen `ASTRID 1") |`: voller
  Name 0,71 (zu wenig), Kern 0,92.

Ein Bericht von vor dem 14.09.2026 kennt den Block nicht; `bericht_laden` liest ihn dann
aus den **gespeicherten Belegbildern** nach (`mvp_aus_bildern`). Genau dafür liegen sie
da: eine später dazugekommene Auswertung soll an demselben Material nachgeholt werden,
statt das Spiel erneut abzufahren.

## Aussetzen nach einem Fehlen

Seit 11.09.2026. Wer im fixierten Kader stand und nicht gespielt hat, setzt beim nächsten
Wüstensturm aus. `ws_aussetzen` (Migration `db/2026-09-11_ws_aussetzen.sql`, in
`TENANT_TABLES`) hält eine Zeile je Spieler und Event, **bei dem** er aussetzt — nicht
bei dem er gefehlt hat; das steht in `quelle_event_id`. Eigene Tabelle aus demselben
Grund wie die Prioliste: für das künftige Event gibt es beim Eintragen noch keine
Teilnahme-Zeile.

Angezeigt als „⛔ Aussetzen" neben dem Namen in der Wüstensturm-Anmeldung des
betreffenden Freitags (`src/core/aussetzen.js`, `ctx.aussetzen` in `anmeldeZeile`). **Die
Marke schlägt vor, sie sperrt nicht** — eingeteilt wird im Spiel, die Knöpfe bleiben
bedienbar. Das ✕ (nur `canAccess('ws')`) hebt sie auf; das Fehlen bleibt in
`ws_participation` stehen.

`aussetzenAufheben(mode, eventDate, name)` hat den Namen hinten, weil die Anmeldezeile
ihn an einen Aufruf-Präfix der jeweiligen Ansicht hängt (`ctx.aussetzenAuf`).

## Belege aus den Läufen

**11.09.2026, Team A:** Niederlage 214.919 : 379.461 gegen #1669, MVP Neiluj13. 27 von
30 Eingeplanten gespielt; gefehlt haben `Dede38190`, `lKaizerl`, `skyluna` (alle gesetzt)
— alle drei auf „Aussetzen" für den 18.09. Alle 10 Ersatzspieler haben gespielt.
Offen blieb `senasinasona` (Platz 7, 1.671.994 Punkte) — steht in keiner Allianz im Tool.

**04.09.2026, Team B** (nachgetragen): Sieg 301.181 : 266.750 gegen #1629, MVP
`S a p p h y`. 26 von 30 gespielt. Die Summe der Einzelpunkte stimmt mit der Mail.

## Getestet in

`tests/aussetzen.spec.js`, `tests/leistungsindex.spec.js`

## Sessions

- `docs/sessions/2026-09-11-3cba7da7.md` — Skript gebaut, erster Lauf, Aussetzen-Tabelle
- `docs/sessions/2026-09-11-fd93f9b7.md` — Team B nachgetragen, Japanisch/Griechisch
- `docs/sessions/2026-09-14-06acb96d.md` — MVP-Block, Eroberer-Marke
