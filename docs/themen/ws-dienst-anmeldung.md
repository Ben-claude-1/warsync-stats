---
thema: Dienst — Anmeldung aus dem Spiel übernehmen (Wüstensturm / Schluchtsturm)
code: scripts/ws_service/ (run.py, roster.py, device.py, match.py, tool.py, mitschreiben.py, mitlesen.py, config.json, aliase.json, vorlagen/)
verwandt: bluestacks-steuerung, texterkennung-ocr, wuestensturm, anmeldung-rotation-ersatz
---

# Dienst — die Anmeldung aus Last War lesen

## Worum es geht

`scripts/ws_service/` liest die Wüstensturm-Anmeldung direkt aus dem Spiel (BlueStacks +
ADB) und schreibt sie als `teamAssign` in den Planungsstand. Damit entfällt das Abtippen
der Liste, an dem vorher jede Woche eine halbe Stunde hing.

```
.venv/bin/python -m scripts.ws_service.run              # nur lesen, Bericht
.venv/bin/python -m scripts.ws_service.run --schreiben  # und ins Tool übernehmen
.venv/bin/python -m scripts.ws_service.run --pruefen    # zeigt, was im Bild erkannt wird
```

Weg: Hauptkarte → Events → Reiter „Wüstensturm" → „Teilnehmer auswählen" → Liste
durchscrollen. Berichte und Sicherungen: `~/.local/state/warsync/ws_service/`.

## Was eine Zeile bedeutet

Wer sich angemeldet hat, trägt über seiner Zeile einen farbigen Balken mit der gewählten
Uhrzeit; wer nicht, hat keinen. Rechts stehen zwei Felder — links „gesetzt", rechts
„Ersatz", genau unter den Zählern 👤x und 👤↺ der Kopfzeile.

| im Bild | Wert |
|---|---|
| Badge links | `A` / `B` |
| Badge rechts | `AE` / `BE` |
| Balken ohne Badge | `C` |
| **kein Balken** | **gar nicht angemeldet — es wird nichts geschrieben** |

Ein `null` wäre eine Aussage, die niemand getroffen hat.

## Im Badge steht der Buchstabe des Teams, und der schlägt den Balken

Seit 16.09.2026 (`roster.team_abzeichen`). Vorher kam das Team aus der Farbe des
Balkens. Über 220 Bilder eines von Hand gescrollten Mitschnitts gemessen
(`pruefe_team_abzeichen.py`): **219 von 219** belegten Feldern gelesen, 212 wie der
Balken, 7 dagegen — mit zwei verschiedenen Ursachen:

- **Wer sich für beide Zeiten meldet, hat zwei Balken.** `ZephyrusXI` (150,8M) stand in
  `bild_009` unter grünem „09:00 ~ 09:30" und in `bild_010` unter orangem „18:00 ~
  18:30"; das Abzeichen war beide Male `A`. Kein Fehler und kein Flackern der Anzeige —
  die Anmeldung erlaubt beide Uhrzeiten. Betrifft 2 von 84 Namen (`ZephyrusXI`,
  `Mammon90`). **Die Auskunft ist wertvoll:** wer beide Farben zeigt, ließe sich in
  beiden Teams einplanen.
- **Balken und Abzeichen sagen nicht dasselbe.** Bei `Puwe` steht in allen drei Bildern
  ein oranger Balken über einem `A`-Abzeichen. Der Balken nennt die Zeit, für die sich
  jemand gemeldet hat, das Abzeichen das Team, in das er eingeteilt **ist**. Für
  `teamAssign` zählt die Einteilung.

Über fünf Spieler führte die Balkenfarbe zu widersprüchlichen Werten, die die Gegenprobe
scheitern ließen; mit dem Abzeichen blieb genau einer übrig.

**Gelesen wird der Buchstabe als Bild, nicht als Text** — Vorlagenabgleich gegen
`vorlagen/team_a.png` / `team_b.png` (richtig 0,96–1,00, falsch 0,59–0,68). Tesseract und
Vision liefern bei diesem verzierten Einzelzeichen meist gar nichts.

Welche Uhrzeit welches Team ist, kommt aus `wsTime` im Planungsstand, nicht aus dem Code.

**Wer beide Zeiten gemeldet hat, steht im Bericht** (`match.beide_zeiten`). `zu_werten`
wertete den Balken vorher nur aus, wo kein Abzeichen stand — also bei niemandem mit
Platz. Heute wird er immer gelesen und je Spieler über alle Zeilen gesammelt
(`balken_teams`). **Ein Name, der dort fehlt, heißt „nicht gesehen", nicht „nur eine
Zeit"** — die Zahl der Zeilen steht deshalb daneben.

**Bei Streit zwischen Farbe und Uhrzeit gewinnt die Farbe.** Bis dahin war es umgekehrt,
und das war falsch herum: über 242 Zeilen wurden überhaupt nur **26 Uhrzeiten** gelesen,
und **4 davon falsch** — jede drehte das Team. Die Erkennung macht aus `18:00` ein
`13:00`, und das ist ausgerechnet die *lokale* Zeit des anderen Teams. Die Uhrzeit bleibt
trotzdem stehen, nur eine Stufe höher: über **alle** Zeilen gemittelt sagt sie überhaupt
erst, was die Farbe bedeutet — siehe den nächsten Abschnitt.

## Grün gehört dem Blatt, nicht dem Team (seit 17.09.2026)

**„Wenn ich Team B scanne, sind die Spieler grün, die sich für die Zeit von Team B
gemeldet haben. Wenn Team A gescannt wird, sind die grün, die sich für Team A gemeldet
haben."** (Ben, 17.09.2026). Im Code stand fest `{"gruen": "A", "orange": "B"}`, und das
ist widerlegt — über zwei Mitschnitte desselben Tages:

| Mitschnitt | gescanntes Blatt | grüne Balken | orange Balken |
|---|---|---|---|
| 12:45 Uhr | A | 09:00 (16×) = A | 18:00/18:30 (21×) = B |
| 23:37 Uhr | B | 18:00/18:30 (23×) = B | 09:00 (2×) = A |

**Getroffen hätte es ausgerechnet die Ausgeschlossenen.** Das Abzeichen schlägt den
Balken, also betrifft die Farbe nur Zeilen **ohne** Abzeichen — und dort ist `AC`/`BC`
die ganze Auskunft. Im Lauf vom 23:37 stand jeder Ausschluss im falschen Team:
`Carmen0804` und `Naruto1284` auf `AC` statt `BC`, `Stalker24601` umgekehrt.

Quelle ist deshalb das **gescannte Blatt** (`roster.farb_teams(zeilen, ws_time, blatt)`):
`run.py` kennt es aus der Kampfzeit des Blattes, `mitlesen.py` aus `--team`. Beide
bestimmen es jetzt **vor** der Farbzuordnung, nicht danach. Die gelesenen Uhrzeiten sind
die Gegenprobe: widersprechen sie der Mehrheit nach, wird gemeldet statt verschluckt
(14 von 17 bestätigten sie; die 3 Ausreißer sind die bekannte `18:00`→`13:00`-Lesung).
Ohne Blattangabe wird aus denselben Uhrzeiten geschlossen.

**Auch die Blatt-Erkennung im Mitschnitt hing daran.** Sie nahm die Mehrheit der Farben —
und die zeigte in **beiden** Mitschnitten auf das falsche Blatt, denn die Zeilen des
anderen Teams stehen ebenso in der Liste. Heute: grün ist das Blatt.

`pruefe_team_abzeichen.py` nimmt das Blatt als zweites Argument. Ohne den Nachzug maß es
über einen B-Mitschnitt **163 Scheinabweichungen** — eine Messung, die ihre eigene
Annahme misst. Mit Blatt B: 163 wie der Balken, 7 dagegen (die „beide Zeiten"-Spieler),
6 nicht gelesen — dasselbe Bild wie am Vormittag.

## Nach dem Anmeldeschluss gibt es keine Zeit-Balken mehr (seit 17.09.2026)

**Der Scan muss vor Donnerstag 04:00 laufen.** Danach zeichnet Last War die farbigen
Zeit-Balken nicht mehr — und damit ist die **Anmeldung** aus dem Spiel verschwunden.
Die Abzeichen bleiben, `AC`/`BC` ist weg: wer aussortiert wurde, ist dann von jemandem,
der sich nie gemeldet hat, nicht mehr zu unterscheiden. Genau die Auskunft, für die
`AC`/`BC` da ist.

Am 17.09.2026 um 12:00 fand der Mitschnitt über 66 Bilder **0 Zeilen**. Das sah aus wie
der Renderfehler vom 09.09. und war es nicht — nach `am force-stop` und Neustart waren
die Balken weiter weg. Drei Stellen sagen dasselbe:

| | vor dem Schluss (23:37) | danach (12:00) |
|---|---|---|
| Wüstensturm-Seite | „Kampftag: … 13:00 ~ 13:30" | „Schlacht beginnt in: 1d 00:47" |
| Knopf rechts | „Teilnehmer auswählen" | **„Teilnehmer"** |
| Balken über den Zeilen | ja | **keiner** |

**Der zweite Anker ist der Trennstreifen zwischen zwei Zeilenkarten**
(`roster.zeilenkoepfe`, gemessen in der leeren rechten Spalte der Karte, `ZEILENRAND_X`):
28 px hoher beiger Streifen, Zeilenabstand exakt 320 px, Rot über Blau — damit sauber von
den fliederfarbenen Rang-Balken (Blau über Rot) und vom Weiß der Karte (Mittel 251)
getrennt. Sein Ende liegt dort, wo sonst der Balken endet, `zeile_lesen` bleibt
unverändert. Geschaltet wird es mit `--ohne-balken`; der Mitschnitt sagt am Ende selbst,
ob es nötig ist (`bilder_mit_balken` in `meta.json`).

**Kennung ist `None`, nicht eine geratene Farbe.** Ohne Balken gibt es keine Uhrzeit und
kein Team für die Platzlosen — die Auskunft ist weg, nicht verschoben, und der Bericht
sagt das ausdrücklich.

**Das Suchfenster des Abzeichens musste beide Anker aushalten.** Mit Balken sitzt es bei
`dy` 60, am Trennstreifen bei 93. Das alte Fenster (+45…+185) schnitt die 110 px hohe
Vorlage unten ab, der Abgleich fiel von **0,99 auf 0,35** — beide Buchstaben gleich
schlecht, also `None`, also Zeile ohne Team, obwohl das `A` im Bild steht. Fenster auf
+215; die nächste Zeile beginnt erst 320 px weiter, es kann nichts Fremdes hineinrutschen.
Gegengeprüft über `lauf10`: **176 statt 170** Abzeichen gelesen, weiterhin nur die 7
bekannten „beide Zeiten"-Abweichungen.

**Was fehlt, holt man aus einem Mitschnitt von vorher.** Am 17.09. ergab die Verbindung
aus drei Läufen genau 20 · 10 · 20 · 10: die Plätze aus den beiden Läufen von heute
(Abzeichen), die vier nicht gesehenen Zeilen und alle `AC`/`BC` aus dem Lauf von 23:37
(Balken). Nichts davon ist geraten — aber es geht nur, weil es den Lauf von vorher gibt.

## Der Stand nach dem Zusammenführen wird noch einmal geprüft (seit 17.09.2026)

`zaehler_pruefen` misst den **Fund**. Was hinterher im Werkzeug steht, ist etwas anderes:
zusammengeführt wird, und die Zusammenführung löscht nie (`tool.zusammenfuehren`). Das ist
richtig — wer sich nicht angemeldet hat, taucht im Scan gar nicht auf, und ein `null` wäre
eine Aussage, die niemand getroffen hat.

Die Kehrseite: Wer aussortiert wurde und dessen Zeile ein Lauf nicht gesehen hat, bleibt
still auf seinem alten `A` stehen. Der Stand sieht danach vollständig aus und ist es
nicht — aus 20 gesetzten werden 21. `roster.bestand_pruefen` hält die Zähler deshalb ein
zweites Mal gegen das **Ergebnis** und nennt dabei namentlich, wessen Wert *nicht* aus
diesem Lauf stammt. Gemeldet, nicht korrigiert: über eine ungesehene Zeile weiß der Lauf
nichts.

## Die Heldenkraft wird beim Scan gleich mit gepflegt

Seit 15.09.2026 (`tool.schreibe_heldenkraft`). Neben jedem Namen steht die Heldenkraft —
dieselbe Zahl, die `match.py` ohnehin zum Zuordnen liest. Geschrieben wie eine manuelle
Eingabe: erst `ws_players.hero_power`, dann eine Momentaufnahme nach `ws_player_history`
(`changed_by='ws_service'`).

- **Läuft auch dann, wenn die Teilnehmerliste verworfen wird.** Eine unvollständig
  gescannte Liste sagt nichts darüber aus, ob die gelesenen Zeilen falsch wären.
- **Nur sichere Namenstreffer** (`erg["treffer"]`) — eine offene Zeile darf nicht die
  Heldenkraft eines falschen Spielers überschreiben.
- **Unveränderte Werte überspringen**, sonst wüchse `ws_player_history` bei jedem
  Wochenlauf um eine Zeile je Spieler.

## Die Gegenproben — und warum sie nicht weichen dürfen

**Zwei, und beide müssen aufgehen.** Die Zähler der Rang-Kopfzeilen (R4: 👤x 7) werden
gegen das Gefundene gehalten — je Rang, damit ein Fehler auch zeigt, *wo* er sitzt. Ihre
Summe muss die Gesamtzahl über der Liste treffen; sonst wurde eine ganze Rang-Gruppe
übersprungen, was den Einzelzählern allein nicht auffällt.

**Passt etwas nicht, wird nicht geschrieben** — eine halb gelesene Liste ist schlimmer
als gar keine, weil sie plausibel aussieht. `--erzwingen` ist für Notfälle.

**Jeder Zähler wird für sich geprüft** (seit 17.09.2026, `roster.zaehler_pruefen`). Vorher
hing beides an einer Bedingung: war *einer* der beiden unlesbar, fiel die ganze
Gegenprobe aus. Am 17.09. blieb der Ersatz-Zähler von R3 offen — die Erkennung liest
dessen „8" nicht —, und damit verschwand auch der Vergleich der Gesetzten, der
dagestanden hätte: **„gefunden 19, Spiel sagt 20"**. Ein fehlender Zähler ist ein
fehlender Zähler und kein Grund, den vorhandenen wegzuwerfen.

**Dasselbe sagt das Spiel zweimal, und die beiden Stellen taugen Verschiedenes.** Die
Rang-Zähler sagen auch, *in welcher Gruppe* etwas fehlt; die Zahl über der Liste nur,
*dass* etwas fehlt — dafür steht sie an einer Stelle statt an fünf und liest sich
entsprechend zuverlässiger. Ist die Aufschlüsselung unvollständig, springt sie deshalb
ein; in der Meldung steht, woher der Sollwert kam. Die schwächere Auskunft ist immer noch
die ganze Gegenprobe.

Die Gegenprobe hat sich mehrfach bewährt: am 02.09. („gesetzt A: gefunden 13, Spiel sagt
23"), am 08.09. („gefunden 12, Spiel sagt 20"), am 15./16.09. bei 29 bzw. 30 gelesenen
Zeilen. Jedes Mal blieb der Planungsstand unangetastet.

**Eine Zahl, die sich geändert hat, ist kein Fehler.** In der Anmeldephase dürfen R4 und
R5 die Zuordnung jederzeit umstellen; aus „20/20 gesetzt" kann ein „15/20" werden, ohne
dass am Scan etwas falsch war. Der Dienst liest einen Zustand, keine Wahrheit auf Dauer —
deshalb trägt jeder Bericht Zeitstempel und Restzeit bis zum Anmeldeschluss.

## Fehler, die je einen Lauf gekostet haben

- **Scheinversatz am Listenende** (`MIN_VERSATZ_PX = 180`): der Vorlagenabgleich greift
  auf eine gleich aussehende Zeile weiter oben und meldet ~145 px Bewegung, die es nicht
  gibt. Der Lauf brach bei 120 Bildern ohne Ergebnis ab.
- **Zeilen beim Aufklappen verworfen:** `if aktion: continue` übersprang das Zeilenlesen
  des ganzen Bildes; 13 Zeilen fielen still durch, 6 der 20 gesetzten A-Spieler fehlten —
  ohne dass eine Gegenprobe anschlug (die zählen Rang-Kopfzeilen, nicht Zeilen).
- **Serverzeit nicht umgerechnet:** das Spiel sagt 09:00, das Tool führt 13:00. Die
  Kampfzeit galt als „nicht lesbar", die Gegenprobe fiel aus — der Dienst hätte **nie**
  geschrieben.
- **Rang-Gruppe zählte doppelt:** der Schlüssel kam mal als `0|8|2|80`, mal als
  `0|8|2|180`, weil die Mitgliederzahl „16/80" unterschiedlich gelesen wurde. Heute wird
  nur der Nenner nach dem Schrägstrich gelesen, der sich stabil liest.
- **Jede Rang-Gruppe wird genau einmal aufgeklappt**, gemerkt am OCR-Text ihres Balkens
  (der sich beim Scrollen nicht ändert). Ohne Gedächtnis tippt derselbe Balken im nächsten
  Bild erneut — und klappt zu.
- **Der aktive Reiter trägt kein Wort, sondern ein Bild.** Wer das Blatt über den
  Reitertext sucht, findet das bereits geöffnete nie und schiebt den Streifen bis zum
  Anschlag. Geprüft wird der **Blatt-Titel** oben links; der Reitertext dient nur zum
  Finden. Wie viele Reiter es gibt, hängt an den laufenden Events — feste Koordinaten
  treffen früher oder später den falschen.
- **OCR-Müll zählte als Spieler.** Im Schluchtsturm-Rangscan hoben Einträge wie `'m'`,
  `'| BU'`, `'| Cal \v @'` die R3-Zahl künstlich von ~76 auf 81. Genau die Sorte
  Ergebnis, vor der die Projektdoku warnt — es geht auf und ist falsch.
- **Sechs stehende Bilder, nicht drei**, bevor „Listenende" gilt. Ein zusätzlicher Anlauf
  kostet Sekunden, ein zu früher Abbruch den ganzen Lauf — und er sieht hinterher wie ein
  vollständiger Scan aus.
- **Ohne `--schreiben` passiert nichts.** Der Lauf dauert zehn bis zwanzig Minuten; ein
  Fehlgriff wäre die Aufstellung einer ganzen Woche. Vor dem Schreiben legt der Dienst
  eine Sicherung des Planungsstands ab und zieht `savedAt` mit — sonst hält ein offener
  Browser-Tab seinen älteren Stand für den neueren und schreibt ihn zurück.

## Nach dem Anmeldeschluss

Donnerstag 04:00 gibt es „Teilnehmer auswählen" nicht mehr, sondern rechts „Teilnehmer"
mit den 30 Eingeteilten. Der Dienst erkennt das am fehlenden Knopf im unteren Streifen
und bricht mit `AnmeldungGeschlossen` ab, statt irgendwohin zu tippen.

## Das Suchfeld geht am Scroll-Hänger vorbei (seit 23.09.2026)

Über der Liste steht „Mitglieder suchen". Ein Name hinein, und darunter steht **seine
eine Zeile** — ohne einen einzigen Wisch. Damit ist die Liste auch dann vollständig
lesbar, wenn sie keine Geste mehr annimmt: in der Nacht auf den 23.09. blieb der
Scroll-Lauf nach 21 von 80 R3-Zeilen stehen (sechs Rastungen, danach `versatz 0` auch
mit Tipp davor), der Suchlauf über alle 100 Kadernamen lief durch.

Der Preis ist Zeit statt Zuverlässigkeit: rund 19 s je Name, also gut eine halbe Stunde
für den ganzen Kader. Dafür kann keine Zeile übersprungen werden — es gibt keine
Schrittweite, die daneben liegen könnte.

Vier Dinge, die dabei gelernt wurden:

- **Der X-Knopf neben dem Feld leert es nicht.** Ohne Kontrolle sammelte sich der Text
  Name für Name an (`ZenrathS a p p h yGeneralBl…`) und die Suche traf nichts mehr.
  Geleert wird mit `keyevent 123` (ans Ende) und vierzig `keyevent 67`.
- **`input text` kommt mal sofort an und mal gar nicht.** Ohne Gegenprobe stand im Bild
  die Anfrage des **vorigen** Namens — und damit dessen Zeile unter dem neuen Namen.
  Gewartet wird deshalb, bis das Feld den Text per OCR auch trägt; erst dann wird
  abgelichtet. Zur Sicherheit wird der Zeilenname mitgelesen und gegen den gesuchten
  gehalten.
- **Die Tastatur kann nur ASCII.** `ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ` und `V ベジータ王子` sind so nicht
  zu suchen; gesucht wird das längste tippbare Stück des Namens, Leerzeichen als `%s`.
- **Ein Name, der nichts findet, ist nicht unbedingt weg** — und das ist keine Floskel,
  sondern am selben Lauf eingetreten. `Ben_the_men` heißt im Spiel `Ben the men`, mit dem
  Stück `the men` stand er sofort da. Acht Kadernamen fanden auch mit einem Stück aus der
  Mitte nichts (`Bonfooyage`, `senasinasona`, `lKaizerl`, `bonrow`, `H A N A N`,
  `Martoxen`, `Pastejen`, `bestbrudi`). Davon waren zwei umbenannt, **vier** ausgetreten,
  einer unsuchbar — und `bonrow` stand sechs Stunden später in der frisch geholten
  Mitgliederliste von XP33. Er war nie weg; die Suche hat ihn nicht gefunden.
  **Ein Fehlschlag der Suche und ein Abgang sehen gleich aus.** Ein leeres Ergebnis
  darf deshalb nichts auslösen, das jemanden stilllegt — dafür gibt es den Atlas-Lauf,
  der auch sagt, in welcher Allianz der Mensch jetzt steht (siehe `spielerdaten.md`).

### Aus dem Suchlauf wird `teamAssign` — ersetzend, nicht ergänzend

`tool.schreibe_teamassign` führt sonst bewusst zusammen: ein Scroll-Lauf sieht nicht jede
Zeile, und wozu er nichts sagt, bleibt stehen. **Der Suchlauf sagt zu jedem Kadernamen
etwas** — er hat jeden einzeln nachgeschlagen. Sein Ergebnis ersetzt `teamAssign` deshalb
ganz; ein stehengebliebenes `A` wäre die Aufstellung des vorigen Kampftags.

Zum Zeitpunkt des Laufs war im Spiel **niemand eingeteilt** (0/20 gesetzt, 0/10 Ersatz).
Alles, was dastand, war reine Anmeldung, also `AC`/`BC`/`ABC` — 26 · 36 · 2. Team A geht
damit mit 28 genau auf den Zähler des Spiels auf, Team B kommt auf 38 von 42.

**Welche Uhrzeit welches Team ist, kommt aus `wsTime` im Planungsstand**, nicht aus dem
Code — die Zeiten sind je Team umstellbar. Serverzeit liegt vier Stunden zurück.

**Fünf Namen gingen ohne Wert durch**, weil die Tastatur sie nicht tippen kann
(`ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ`, `V ベジータ王子`, `H A N A N`) oder die Suche versagte (`bonrow`).
Für sie steht im Werkzeug nichts — eine Lücke, kein geratener Wert. Genau diese fünf sind
die wahrscheinlichsten unter den vier, die Team B zur 42 fehlen.

## Die Zahl, die alles gegenprüft, steht im Auswahlfeld „Zeit auswählen"

Ein Tipp auf das Feld über der Liste klappt alle Kampfzeiten des Tages auf, **jede mit
der Zahl der Anmeldungen daneben**:

| Serverzeit | EU | Anmeldungen am 23.09. für Fr 25.09. |
|---|---|---|
| 09:00 ~ 09:30 | 13:00 | 28 |
| 18:00 ~ 18:30 | 22:00 | 42 |
| 23:00 ~ 23:30 | 03:00 | 0 |

Das ist die billigste Gegenprobe, die es gibt — ein Tipp, kein Scrollen — und sie sagt
mehr als die Zähler der Rang-Kopfzeilen: **es gibt drei Zeiten, nicht zwei.** Die dritte
(03:00 EU) stand am 23.09. auf 0 und fällt deshalb nirgends auf.

**Die Summe ist größer als die Zahl der Angemeldeten**, denn wer beide Zeiten meldet,
zählt in beiden. 28 + 42 = 70 Anmeldungen bei 61 sicher erkannten Menschen.

Ob das Auswählen einer Zeile die Liste **filtert** oder die Kampfzeit des Blattes
**umstellt**, ist nicht geprüft — deshalb wurde nicht ausgewählt. Die Kampfzeit hat mit
„Kampfzeit auswählen" einen eigenen Knopf, was für Filter spricht; bewiesen ist es nicht,
und ein Fehlgriff verstellte die Zeit der ganzen Allianz.

## Wer beide Zeiten gemeldet hat, zeigt sie abwechselnd — aber nicht halbe-halbe

Ben, 23.09.2026: „Da manche Spieler sich für beide Termine anmelden, musst du immer
etwas warten und 2 Screenshots machen. Es dauert etwa 3 Sekunden bis es wechselt."

Bestätigt an `ZephyrusXI` (R4, 151,8 M): erster Blick oranger Balken „18:00 ~ 18:30",
dreieinhalb Sekunden später grüner „09:00 ~ 09:30".

**Zwei Bilder reichen trotzdem nicht.** Über fünf Bilder im Abstand von 1,5 s stand
`ZephyrusXI` viermal auf 09:00 und nur einmal auf 18:00, `Puwe` dreimal auf 18:00 und
zweimal auf 09:00. Der Wechsel ist also kein gleichmäßiges Blinken — eine der beiden
Zeiten steht deutlich länger. Mit zwei Proben im Abstand von 3,5 s fand der erste
Durchgang genau **einen** Doppelmelder, mit fünf Proben waren es **zwei**. Wer die Zahl
sicher haben will, braucht entweder mehr Proben oder das Auswahlfeld oben.

**Die Farbe allein taugt hier nicht**: `18:00 ~ 18:30` kam sowohl orange (`lIBlackJackll`)
als auch blau (`ΧΑΣΑΠΗΣ`, `LittleFighter`) — `roster.zeitkoepfe` wirft beides in
„orange". Gelesen wird deshalb der **Text auf dem Balken**, Fenster
`(1450, y0−10, 1920, y1+10)`, `psm 6`. Er kommt regelmäßig mit Bindestrich statt
Doppelpunkt an (`18-007>218-30`), der Ausdruck muss das zulassen.

## Zwei Stolpersteine auf dem Weg dorthin (23.09.2026)

- **Ein Sprechblasen-Fenster kann `zur_hauptkarte` in die Schleife schicken.** Nach dem
  Neustart lag Last Wars Story-Dialog („Monica", „Sarah") unten und deckte das **W** von
  `WELT` zu; die OCR las `VELT`, `auf_hauptkarte` blieb falsch, und der Dienst drückte
  sechsmal „Zurück". Der Dialog wird mit dem ▼ unten rechts weitergeklickt — hier waren
  es acht Tipper, bis er weg war.
- **`reiter_waehlen` findet „Wüstensturm" im breiten `tab_strip` nicht.** Im Ausschnitt
  `(550, 215, 2560, 310)` liest Tesseract nur `Gesuchter Boss`; in einem engen Fenster
  um denselben Reiter (`1000…1500`) steht sauber `Wüstensturm` da. Der Reiter wurde
  deshalb von Hand angetippt. Ursache vermutlich das Bild des aktiven ersten Reiters
  links im Streifen, das die Zeilenzerlegung verdirbt.

## Von Hand scrollen, mitschreiben, hinterher auswerten

Solange der Dienst nicht allein durch die Liste kommt (→ `bluestacks-steuerung.md`), gibt
es den Weg daneben: ein Mensch scrollt, der Rechner schaut nur zu.

```
.venv/bin/python -u -m scripts.ws_service.mitschreiben --name lauf9
.venv/bin/python -m scripts.ws_service.mitschreiben --auswerten <ordner> --team A
.venv/bin/python -m scripts.ws_service.mitschreiben --auswerten <ordner> --nur-rechnen --schreiben
```

`mitschreiben.py` tippt und wischt **nichts** — nur `screencap`, abgelegt wird jedes Bild
mit Änderung. `mitlesen.py` liest hinterher mit **denselben** Funktionen wie der Dienst
(`roster.zeitkoepfe`, `roster.zeile_lesen`), dieselben Gegenproben gelten.

**Das Trennen ist der Punkt:** Sammeln muss Schritt halten (0,7 s je Bild), Lesen kostet
je Zeile eine Texterkennung. `--nur-rechnen` rechnet aus `roh.json` neu, ohne die Bilder
wieder durch die Erkennung zu schicken — eine Änderung am Abgleich ist damit in Sekunden
gemessen statt in Minuten.

**Erster Lauf am 16.09.2026:** 220 Bilder, 242 Rohzeilen, **68 Spieler zugeordnet**,
Gegenprobe `20/20` gesetzt. Der maschinelle Lauf desselben Vormittags: 30 Zeilen, 16
zugeordnet, bei `R3 14/82` steckengeblieben.

## Offener Punkt

Der Scanner kommt ohne Bens Hand nicht durch die Liste — sechs Erklärungen sind
widerlegt, die Details stehen in `bluestacks-steuerung.md`. Der pragmatische Weg ist
derzeit `mitschreiben.py`. `handleSSUp` (Screenshot der Anmeldeliste im Browser) ist
weiterhin nur ein Platzhalter.

## Sessions

- `docs/sessions/2026-09-02-c759e87e.md` — Doppelzählung R3, Listenende-Falle
- `docs/sessions/2026-09-05-5c96f6c4.md` — Rangscan, ständige Unterbrechungen (561 Turns)
- `docs/sessions/2026-09-06-a0544d0d.md` — OCR-Müll, Wunsch-Erkennung 10 von 21
- `docs/sessions/2026-09-08-57ea7f69.md` — drei Fehler behoben, 54 von 71 erfasst
- `docs/sessions/2026-09-15-5b75ea32.md` — Heldenkraft-Pflege beim Scan, 15 Spieler
- `docs/sessions/2026-09-15-66cd797b.md` — fünf Erklärungen tot, Redundanz als Hebel
- `docs/sessions/2026-09-16-7f0c9d2c.md` — Eingriffskurve, Lauf 8
- `docs/sessions/2026-09-16-a00bedc9.md` — Team aus dem Abzeichen, Mitschnitt-Auswertung
