---
thema: Basen-Erkennung — Bannerfinder, Namen, Stufen, Allianz-Kürzel
code: scripts/karten_archiv/banner.py, auswerten.py, pruefe_banner.py, pruefe_namen.py, pruefe_kuerzel.py
tabelle: karte_basen (Migration db/2026-09-08_karte_basen.sql) · UI src/ui/basen.js, src/core/basen.js
verwandt: kartenarchiv-vollscan, texterkennung-ocr, lw-atlas
---

# Basen-Erkennung — was auf einem Namensschild steht

## Worum es geht

Aus den Kacheln des Kartenarchivs werden Basen gemacht: Ort, Name, Allianz-Kürzel,
Stufe. Zwei getrennte Aufgaben — `pruefe_banner.py` misst, **ob** ein Schild gefunden
wird, `pruefe_namen.py` misst, **was** darauf steht. Die vollständige Regelsammlung
steht in `CLAUDE.md` (Abschnitt „Basen der Weltkarte"); hier steht, wie sie entstanden
ist und was schon schiefging.

`karte_basen` ist die bewusste Ausnahme von `TENANT_TABLES`: die Weltkarte gehört dem
**Server**, nicht einer Allianz. Der Zuschnitt ist `server` und er ist Pflicht — jede
Abfrage steht deshalb in `src/core/basen.js`, an einer Stelle statt an zwanzig.

Befüllen: `python -m scripts.karten_archiv.auswerten --name karte_nah --schreiben`

## Stand (10.09.2026)

| Gebiet | Basen | mit Name | mit Allianz | mit Stufe |
|---|---|---|---|---|
| Kerngebiet (X 438–586, Y 409–589) | 886 | 880 | 842 | 708 |
| Kartenrand (X 1–1000, Y 1–324) | 1399 | 1384 | 127 | 1219 |
| **zusammen** | **2285** | **2264** | **969** | **1927** |

Nach Allianz: CYKA 115 · KISS 107 · XP33 102 · NOGE 102 · WAH 97 · ZOMG 96 · RPTC 93 ·
NRLN 78 · GUNZ 45 · AR1S 39 · OWUB 25 · KURL 22. Ohne Allianz 1316, fast alle vom
Kartenrand — dort siedeln die Allianzlosen.

## Der Unterschied zwischen Rand und Kern ist keine Messungenauigkeit

Am Rand stehen schmucklose Basen mit weißen Namen, im Kern geschmückte mit farbigen.
Das hat jede Kennzahl verschoben und jede Prüfung, die nur den Rand kannte, blind
gemacht.

## Fünf Fehler, die je eine ganze Klasse von Basen gekostet haben

**Die feste Sättigungsgrenze — zweimal gebrochen, beide Male erst durch Bens Blick.**

- `S < 70` ließ die **hellblauen** Namen der eigenen Allianz nicht durch (gemessen
  S≈96, H≈97): von ~1000 Glyphenpixeln kamen 128 an, aus `[XP33]S a p p h y` wurde
  `z£Ts`, in der ganzen Kachel war kein Name zu gebrauchen. Getroffen hat es
  ausgerechnet die Basen, die interessieren.
- `S < 105` ließ die **gelbgrüne** Schrift von Bens eigener Basis nicht durch. Gelesen
  wurde `zr`; weil ein Fund ohne Namen damals ganz herausflog, fehlte die Basis
  (481/554, Stufe 33) vollständig in der Tabelle.

Heute entscheidet keine Konstante, sondern das Bild (`_schriftfarbe`): erster Durchgang
findet mit permissiver Maske das Namensband, im Band gewinnt die größte Farbgruppe, der
zweite Durchgang liest nur diese Farbe. Stellt sich auf jede Namensfarbe selbst ein und
wirft nebenbei den Zierrahmen weg.

**Der Zierrahmen führte die Suche in die Irre.** Bei geschmückten Basen misst `_kasten`
die Leiste des Rahmens, deren Mitte neben dem Namen liegt — bei `marjo42` landete sie
auf einer Vogelscheuche, gelesen wurde `r`. Heute gilt der **breiteste Schriftblock in
Reichweite** (drei Bannerhöhen; im dichten Kern stehen Schilder ~390 px auseinander).

**Der Flaggenschnitt fraß Buchstaben.** Er ging nach Breite; bei gesperrt geschriebenen
Namen (`S a p p h y`) flog der letzte Buchstabe als vermeintliche Flagge heraus, aus
`Mo By` wurde `Mo`. Heute entscheidet die **Farbe**: über 22 Schilder liegt der Anteil
gesättigter Pixel bei einer Flagge zwischen 0,20 und 0,84, bei Text zwischen 0,00 und
0,06 — dazwischen ist nichts.

**Der Kaderabgleich überschrieb gelesene Namen.** Bis 08.09.2026 ersetzte `basen_bauen`
den gelesenen Namen durch den Kadernamen, wenn `match.zuordnen` einen fand. Gegen 279
Kadernamen laufen aber die **1934** Namen der ganzen Welt: bei Schwelle 0,62 traf es 28,
davon war genau *einer* unstrittig. Aus `Gabrypoonte` wurde viermal `HARRY POTTER`, aus
`Oberst Fabi` `bestbrudi`. Der Abgleich steht nur noch als **Bericht** im Lauf.

**Ein Fund ohne Namen wurde verworfen** — und mit ihm die richtig gerechnete Koordinate
und die gelesene Stufe. Heute: ohne Namen, aber mit Stufe, ist es trotzdem eine Basis
(`name` NULL). Die Stufe ist dabei die **Bedingung**, nicht Zierrat: von 73 namenlosen
Funden in `karte_kern` tragen 6 eine, die übrigen sind Kartenbeschriftungen und
angeschnittene Schilder.

## Zwei Schwellen, nicht eine

`SCHWELLE` (12,0) stammt aus der Zeit, als hinter dem Finder nichts stand, das einen
Fehlfund aussortiert — und sie kostete echte Basen: `Skirata33` 9,7 Punkte, `HY07` 10,5,
beide fehlten ganz. Die Ursache ist **kein Schriftproblem**: Skirata33 trägt einen
hellblauen Rahmen auf hellem Sand, die Schriftenergie steht mit 36,7 gut da, das
**Kantenpaar** bricht auf 16,2 ein — der Finder sucht ein *dunkles* Band, und die
Helligkeitsstufe gibt es dort nicht. Eine bessere Kantenmessung hilft nicht; die zweite
Schwelle schon: bis `SCHWELLE_SCHWACH` (9,0), und was dazwischenliegt, muss **eine
gelesene Stufe oder ein Allianz-Kürzel** mitbringen. Über `karte_kern`: 23 echte Basen
dazu, von 13 mitgekommenen Beschriftungen blieb eine übrig.

## Ein Bildmodell findet nicht mehr als der geometrische Finder

Gegengeprüft am 09.09.2026 mit `deepseek-ocr:3b` im Grounding-Modus (Textkästen mit
Koordinaten) über drei Kacheln:

| Kachel | geometrisch 12,0 | geometrisch 9,0 | deepseek |
|---|---|---|---|
| `z011_k0003` (dicht) | 19 | 19 | 19, deckungsgleich |
| `z011_k0004` (`Skirata33`) | 18 | 20 | 20 — Extras sind Bergbaustützpunkt und `Lv.6` |
| `z011_k0002` (`HY07`) | 23 | 24 | 22 — geometrisch findet zwei mehr |

**Kein einziges Namensschild, das nur das Modell sieht.** Der Engpass lag an der
Schwelle und am Lesen, nicht am Finden.

## Die Stufe — sechs Dinge, jedes einzeln ein falscher Wert

Von 16 % auf **80 %** im Kerngebiet (Rand 78 → 84 %), gesamt 66 → 82 % bei 2198 Basen.

- **Geschlossen wird über die Ziffern hinweg** — sie zerschneiden das Hexagon in zwei
  Lappen; ohne Schließen misst man einen Lappen und liest die halbe Zahl.
- **Dünne Stege vorher wegputzen** (Öffnen mit senkrechtem Element) — Geländer,
  Goldbögen und Blütenranken verschmelzen sonst mit dem Schild.
- **Waagerecht entscheidet die Fundstelle, senkrecht die Zoomstufe.** Die Unterkante
  steht 0,53 Bannerhöhen unter dem Namensband (19 Schilder, Streuung 20–31 px um 25).
  Die Höhe des Schilds selbst ist unzuverlässig — verschmilzt es mit dem Bauwerk, füllt
  die Fläche das ganze Fenster.
- **Angeschnitten gilt als ungelesen**, sonst wird aus 12 eine 2. Gemessen wird an der
  **Ziffer**, nicht am Kastenrand: jeder dunkle Randpixel als Schnitt zu zählen traf
  meist die Facettenkante oder eine Zierlinie.
- **`S < 60` ließ das helle Hintergrundbild durch** (Rüstung, Fell, Eis — blass und kaum
  gesättigt). Es berührt das Hexagon, das Schließen verschmolz beides, der Klumpen fiel
  durch die Breitenprüfung. `S < 40` hält die Verunreinigung unten. Beim Namen war die
  Maske zu eng, beim Schild zu weit — andersherum.
- **Die vier Ziffernmodi müssen sich einig sein.** Vorher gewann der erste plausible
  Wert: bei `ΧΑΣΑΠΗΣ` (458/557) lasen psm 8 und 13 `36`, psm 10 und 7 `34` — in der
  Tabelle stand 36. Uneinigkeit ist das ehrlichere Signal, `NULL` heißt „nicht gelesen".
  Das Fenster zu vergrößern hilft nicht: bei 0,80 Bannerhöhen fällt der Rand von 19 auf
  8 von 21 richtigen Stufen, weil das Namensband mitkommt.

Die Stufe bekommt **zwei Anläufe** — das Farbband fällt gelegentlich enger aus als das
permissive (bei `Ghost Fighter X` fiel das Hexagon aus dem Fenster). Über `karte_kern`
kostete das 14 von 905 Stufen, keine davon falsch.

## Das Allianz-Kürzel

**Ein Kürzel braucht eine Klammer, und es kommt darauf an, welche.** In `zerlegen`
durfte die öffnende fehlen und die Ziffer `1` als schließende gelten: `Conand1990` wurde
zur Allianz `ONAND` mit Namen `990`. Getroffen hat es fast nur die, um die es geht —
**19 von 20** Basen am Kartenrand tragen gar kein Kürzel. Heute:

- **Mit öffnender Klammer** darf die schließende ein OCR-Zwilling sein (`1`, `l`, `I`,
  noch ein `[`). Vorn steht dann ein Zeichen, mit dem kein Spielername beginnt.
- **Ohne öffnende Klammer** (fällt am Bildrand weg, `ZOMG]Oli`) muss die schließende
  eine *echte* sein. Ziffern und Buchstaben sind ausgeschlossen — dort saß der Fehler.

Das brachte die Klammerreste im Namen von 117 auf 15 Zeilen.

**Zwischen den Klammern stehen vier Zeichen, und die gehören nie zum Namen** (seit
11.09.2026, `_TAG_VIER`). Die schließende Klammer liest die Erkennung ebenso oft als
`J`, `/`, `T`, `i` oder Leerzeichen — in rund 150 Basen stand das Kürzel danach im Namen
(`[CYKAJRYKITA6`) oder fraß den Anfang mit (`[NOGEJklausi2` → Allianz `NOGEJK`). Zwei
Feinheiten: nach einem Buchstaben-Zwilling folgt kein zweiter (`[CYKAJJOHNO` ist
`JOHNO`), und `i`/`j`/`T` sind nur vor Großbuchstabe oder Ziffer Klammer.

Dreizeichen-Kürzel gibt es trotzdem (`[Wah]` über siebzigmal sauber). Deshalb baut
`basen_bauen` aus dem ganzen Lauf ein **Verzeichnis** (`kuerzel_sammeln`, ab drei
Lesungen) und zerlegt jeden Rohtext damit noch einmal — das trennt, was ohne Wissen
nicht geht (`[NRLNVovan chick`, `IKISSIZLIL 22`) und bringt Zwillinge auf eine
Schreibweise (`ARIS` → `AR1S`). Ohne öffnende Klammer braucht auch ein bekanntes Kürzel
ein Satzzeichen dahinter, sonst verlöre ein allianzloser `Wahlberg` seinen Anfang.

## Beschriftungen sind keine Basen

**Der Prüfstein ist die Spielregel, nicht die Optik** (`_marken_aussortieren`): ein
Spieler hat genau *eine* Basis, also kann ein Name an vier weit auseinanderliegenden
Orten kein Spielername sein. `Wal` (von „Walhalla") stand 63-mal in der Tabelle,
`Nortn German` 52-mal, `KISS OF WA` 21-mal. Drei Orte reichen ausdrücklich nicht —
dort sind es meist zwei Spieler, deren Namen gleich gelesen wurden.

Zwei frühere Anläufe scheiterten am Bild: die Schrifthöhe trennt Banner und
Spielernamen nicht (0,40–0,64 gegen 0,60–1,09 Bannerhöhen), und das Stufenschild taugt
nicht als Beweis, es fehlt bei jeder fünften echten Basis.

**Beschriftungen sind in reiner Farbe gezeichnet, Namen nie** — Bergbaustützpunkt,
Pyramide, Gerichtsplatz und Allianz-Banner liegen bei S-Median 255, Spielernamen bei
113–157. Ab `BESCHRIFTUNG_S` gilt der Fund als Beschriftung.

## Zwei Regeln für den Ort

**Der Schlüssel ist die Koordinate, nicht der Name** (`on_conflict=server,x,y`). Über
den Namen zusammenzufassen scheiterte daran, dass die Erkennung ihn in zwei
Nachbarkacheln verschieden liest — aus einer Basis würden zwei.

**Der Ort allein reicht nicht ganz.** Die gerechnete Weltkoordinate streut um einen
halben Punkt; an der Rundungsgrenze wird aus einer Basis wieder zwei — am Archiv
`karte_nah` traf das 9 % aller Zeilen (`Recklinghausen` neben `Reckiighausen`).
`_nachbarn_falten` zieht Nachbarfelder mit **ähnlichem** Namen zusammen; der Name muss
mitentscheiden, weil auf zwei Nachbarfeldern sehr wohl zwei Basen stehen können.

**Ein neuer Lauf räumt seine Karteileichen weg** (`_verwaiste_raeumen`). Der Upsert
löscht nichts: verschiebt sich eine Koordinate zwischen zwei Läufen, bleibt die alte
Zeile daneben stehen und sieht in der Suche wie ein zweiter Spieler aus — 22 Zeilen auf
873 Basen im Kern, 48 auf 1319 am Rand. Aufgeräumt wird **je Archiv** (`quelle`), nicht
je Server: ein Archiv deckt sein Gebiet vollständig ab, über den Server hinweg zu
löschen nähme die Nachbararchive mit.

## Gemessen wird gefaltet, nicht roh

Am Kartenrand steht fast jede Basis in zwei Kacheln. 131 zusätzlich gelesene Rohschilder
ergaben dort nur **80 Zeilen mehr** — wer den Nutzen einer Änderung an den Rohfunden
abliest, überschätzt ihn.

## Sessions

- `docs/sessions/2026-09-08-b7b17ab1.md` — blaue Namen: 0/16 → 10/16, Zierrahmen,
  Flaggenschnitt. „Meine Prüfung war grün, während der halbe Kern unlesbar war."
- `docs/sessions/2026-09-08-236e13b5.md` — Wege zur Verbesserung durchgespielt:
  Mehrfachlesungen, Vision als Gegenprobe, Trefferquote als blinder Fleck
- `docs/sessions/2026-09-08-d58e0e54.md` — sechs Erkennungen verglichen, deepseek als
  zweiter Finder, 24/38 → 36/38
- `docs/sessions/2026-09-08-27fd042d.md` — Stufe im Kern 39 → 80 %, gefaltet vs. roh
- `docs/sessions/2026-09-10-19b34528.md` — Kürzel-Zerlegung, 2285 Basen, Allianz-Tabelle
