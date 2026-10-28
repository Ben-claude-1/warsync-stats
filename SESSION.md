# Aktueller Stand — 14.10.2026, 21:40

> Diese Datei ist der **Einstiegspunkt für die nächste Session**: wo das Projekt
> gerade steht, was im Arbeitsverzeichnis offen liegt und was gerade läuft.
> Sie ersetzt die bisherigen 82 Einzel-Übergaben in der Repo-Wurzel.
>
> **Dauerhafte Regeln gehören nicht hierher**, sondern in [`CLAUDE.md`](CLAUDE.md)
> bzw. in die Themen-Datei unter [`docs/themen/`](docs/themen/). Was eine einzelne
> Session gemacht hat, steht im Journal [`SESSIONS.md`](SESSIONS.md) und im
> Digest unter `docs/sessions/`.

---

## Wo die alten Sessions liegen

Die Übergabe-Dokumente (`session-<id>.md`) sind aus der Repo-Wurzel verschwunden
— 82 Dateien, 3,1 MB, die dort nur noch im Weg standen. Sie liegen jetzt
gepackt unter **`docs/sessions/uebergabe/`** (1,2 MB), dieselbe Haltung wie bei
`prune_sessions.py`: behalten, aber zehnmal kleiner. Lesen:

```bash
gunzip -c docs/sessions/uebergabe/session-12e8b455.md.gz | less
```

Der frühere Inhalt dieser Datei (ein Mitschnitt vom 07.05.2026) liegt dort als
`SESSION-alt-9208e5e7.md.gz`. Nichts davon ist in Git — `session-*.md`,
`docs/sessions/` und `SESSIONS.md` stehen in `.gitignore`, weil sie voller
Spielernamen samt Heldenkraft stehen.

**Diese Datei hier ist dagegen versioniert** und landet damit auf GitHub. Also
gilt für sie dieselbe Regel wie für den übrigen Quelltext: **keine
Spielernamen, keine Heldenkraft, keine T1-Werte** — Zahlen über den Kader
gehören hier nur aggregiert hinein. Wer den vollen Stand braucht, liest das
Archiv daneben.

Der ungekürzte Verlauf liegt weiterhin als jsonl unter
`~/.claude/projects/-Users-ben-Projects-Warsync-stats/` (161 Dateien gepackt,
918 MB — der größte Posten, falls einmal Platz gebraucht wird). Digest und
Journal baut der LaunchAgent nachts um 04:30 selbst; die beiden jüngsten Läufe
(`12e8b455`, `f53a1870`) haben deshalb noch keinen Digest und dürfen nicht
weggeräumt werden.

---

## Git: alles gepusht, zwei Arbeitspakete offen

`HEAD` = `origin/main` = **`cb6580a`** („build: dist neu gebaut", 09.10. 17:28).
Es gibt nichts Unveröffentlichtes in der Historie. Im Arbeitsverzeichnis liegen
dagegen **26 geänderte und 2 neue Dateien**, und sie gehören zu zwei
verschiedenen Vorhaben — an den Zeitstempeln klar zu trennen:

### A — Beweisbilder in der Anmeldehistorie (09.10., 17:38–17:47)

Entstanden **zehn Minuten nach** dem letzten Commit, also nicht mehr darin
enthalten. Neu: die Tabelle `ws_anmeldebeleg` samt Migration
`db/2026-10-09_ws_anmeldebeleg.sql` (**in der Datenbank schon angelegt**) und
ein Beleg-Overlay in der Oberfläche.

| Datei | was darin steckt |
|---|---|
| `db/2026-10-09_ws_anmeldebeleg.sql` *(neu)* | Tabelle, Index, `notify pgrst` |
| `scripts/ws_service/belege.py` | `erkannt_um` **je Spieler** statt je Lauf; beim Nachtragen die Dateizeit des Quellbilds |
| `scripts/ws_service/tool.py` | `schreibe_belege()` — Base64-PNG in Blöcken von 15, läuft bei **jedem** Lauf, auch ohne `--schreiben` |
| `scripts/ws_service/{run,suchlauf,mitlesen,match,navigate,device}.py` | Aufrufer und Durchreichung |
| `src/core/{tenant,auth}.js` | `ws_anmeldebeleg` in `TENANT_TABLES`; Sammel-Laden **ohne** die Bildspalte |
| `src/ui/anmeldehistorie.js`, `src/app/globals.js`, `src/core/i18n.js` | 📷-Overlay, Namen auf `window`, englische Texte |
| `tests/ws_anmeldehistorie.spec.js` | +82 Zeilen |
| `dist/main.js`, `index.html` | gebaut und gestempelt (17:45) |

**Was belegt ist:** die Tabelle steht und ist gefüllt — **98 Belege** aus dem
Suchlauf der vergangenen Nacht (01:38–02:09), alle für den Freitag 16.10.:
1 × `A`, 16 × `AC`, 28 × `BC` und **53 × `wert=NULL`** („laut diesem Beleg nicht
angemeldet" — eine Aussage, die nur der Suchlauf treffen kann).

**Was offen ist:**
- Die Tests habe ich **nicht** laufen lassen — Browser-Tests dieses Repos
  schreiben in die Produktiv-Datenbank.
- `ws_anmeldestand` (die Anmeldehistorie selbst, Migration vom 09.10., bereits
  committet) ist **leer**. Die Belege sind da, der Wochen-Schnappschuss nicht.
- Ob das Paket so committet werden soll, hat niemand entschieden.

### B — VS-Dienst nach sechs Ausfallnächten (12.10. 23:52 – 13.10. 01:35)

Die Nachtläufe vom 08. bis 12.10. haben jede Nacht **null Zeilen** gelesen und
das für ein Listenende gehalten; die Woche vom 05.–10.10. ist dadurch verloren
(die Tagesreiter werden Sonntag zurückgesetzt). In `vs_tage_lauf` stehen diese
sechs Nächte mit `gelesen=0` als Beleg.

| Datei | was darin steckt |
|---|---|
| `scripts/vs_service/liste.py` | `laedt_noch` — „Wird geladen" ist kein Listenende (22 von 22 erkannt, 0 Fehlalarme) |
| `scripts/vs_service/pruefe_laden.py` *(neu)* | die Messung dazu |
| `scripts/vs_service/run.py` | null Zeilen gelten nie als Tag; ein Lauf ohne eine einzige Zeile endet mit **Code 1** |
| `scripts/vs_service/tool.py` | `gelaufen_at` wird beim Upsert mitgeschrieben (der Default `now()` griff nur beim Einfügen) |
| `scripts/vs_service/navigate.py` | Navigation |
| `scripts/ws_service/match.py` | `eine_zeile` gibt den besten Namen als Feld `bester` zurück, auch unter der Schwelle |
| `scripts/routinen/starter.py` | **je Lauf ein eigenes Protokoll** unter `routinen/<name>/laeufe/<zeit>.log` — das überschriebene Einzelprotokoll hat die Ursache der sechs Nächte gekostet |
| `scripts/bluestacks_start.sh` | wartet auf **Android** (`wm size`), nicht auf ADB; aus dem Kalten wieder `open -a`, nicht `--cmd launchApp`; `neu` startet vor jedem Lauf neu |
| `CLAUDE.md`, `docs/themen/vs-duell.md` | begründet dokumentiert (+15 / +100 Zeilen) |

**Was belegt ist:** der Nachtlauf hat seitdem wieder gelesen —
Montag 12.10. mit **96 Spielern**, Dienstag 13.10. mit **94**.

**Was offen ist:**
- Beide Tage stehen auf `vollstaendig=false`. Beim 12.10. hängt das an **einer
  einzigen** übersprungenen Zeile zwischen Stelle 28 und 36; ab 36 ist jede
  gelesene Rangziffer um eins zu hoch. Die Punktwerte sind davon unberührt, und
  `--nur-fehlende` liest den Tag beim nächsten Lauf erneut.
- **BlueStacks' Auto-Update ist weiter an.** Ein Update löscht Last War
  (Symptom: `getprop` geht, jede Shell gibt `error: closed`) und kann sich
  unbeaufsichtigt um 05:00 wiederholen. Das ist eine Entscheidung, die
  aussteht — kein Code-Problem.
- Auch dieses Paket ist nicht committet.

---

## Der Suchlauf der Nacht ist durch — gelesen, nicht geschrieben

- Um **23:47:01** hat ein VS-Lauf den Dienstag geschrieben (96 Zeilen).
- Der **WS-Suchlauf** von 23:47:35 war um **00:20:15** fertig:
  `~/.local/state/warsync/ws_service/suche_20261013_234735/`, 97 Kadernamen
  einzeln übers Suchfeld nachgeschlagen, 97 Beweisbilder.
- Ergebnis für den Freitag 16.10. (Anmeldeschluss in 1 d 04:12): **A 1 ·
  AC 23 · BC 34**, dazu **39 nicht angemeldet**. Der Spielzähler sagt
  `gesetzt 1/20`, `ersatz 0/10` — es ist also wirklich erst einer eingeteilt.
- Der Lauf lief **ohne `--schreiben`**, deshalb stand das Ergebnis zunächst nur
  im Bericht. Um **00:29 nachgetragen** (`tool.sicherung_schreiben` +
  `tool.schreibe_teamassign` aus `bericht.json`, `geschrieben` dort auf `true`
  gesetzt): `ws_planner_state` (`key='ws'`) trägt jetzt **58 Werte**,
  `savedAt` 14.10. 00:29. Der Stand davor war **leer** — überschrieben wurde
  also nichts; die Sicherung liegt trotzdem unter
  `~/.local/state/warsync/ws_service/sicherungen/`.
- Die Gegenprobe des Laufs ging auf (`probleme: []`, keine Konflikte, keine
  unsichere Zeile). Nicht gefunden wurde im Spiel genau **ein** Kadername:
  `H一A一N一A一Nツ`.
- **Nachzutragen wäre ein `--uebernehmen <ordner>`** in `suchlauf.py`, wie
  `ergebnis.py` es mit `--bericht <ordner> --schreiben` schon hat. Ohne das ist
  ein vergessenes `--schreiben` nur von Hand zu retten.

**BlueStacks ist beendet** (14.10., 21:41) — nach dem Einstell-Lauf weiter
unten. `osascript -e 'quit app "BlueStacks"'` bringt dabei nur den Dialog
„Would you like to exit BlueStacks Air?" hoch und meldet `-128`; genommen wird
der Weg aus `bluestacks_start.sh`: `pkill -f` und notfalls `-9`.

---

---

## Die Aufstellung für Freitag steht im Spiel (14.10., 21:12–21:36)

Ein zweiter Suchlauf lief am Abend (19:42–20:15, Bericht
`suche_20261014_194259`, `PROBLEME: keine`) und wurde um 20:18 ins Werkzeug
nachgetragen — wieder von Hand, weil auch er ohne `--schreiben` gestartet war.
Danach stand der Vorschlag des Reiters „🧮 Verteilung" bereits vollständig in
`teamAssign`; `zuteilung_plan.mjs` meldet deshalb **null Schritte**, der
Unterschied lag allein zwischen Werkzeug und Spiel.

`scripts/ws_service/einstellen.py --schreiben` hat ihn geschlossen, über das
Suchfeld, erst Blatt A, dann Blatt B. Gegengeprüft wurde anschließend **im
Spiel**, nicht im Protokoll:

| Blatt | vorher | nachher | Plan |
|---|---|---|---|
| A (13:00) | 1/20 · 0/10 | **20/20 · 5/10** | 20 · 5 ✔ |
| B (22:00) | 0/20 · 0/10 | **19/20 · 10/10** | 20 · 10 — einer fehlt |

Der fehlende B-Platz gehört einem Spieler, der die Allianz **am 14.10.
verlassen hat**: der nächtliche Suchlauf fand ihn noch, der abendliche nicht
mehr. Im Werkzeug steht er weiter auf `active`, LW Atlas führt ihn mit Stand
07.10. noch als Mitglied — von den drei Quellen ist die Mitgliederliste des
Spiels die frischeste.

**Daran ist der Lauf auch abgebrochen**, und das ist ein offener Mangel: eine
leere Trefferliste sieht für `navigate.liste_offen` aus wie ein geschlossener
Dialog, der Abbruch zeigt auf die Eingabezeile statt auf den fehlenden Spieler,
und er kostet den **ganzen** Lauf statt nur diesen Namen. Blatt B musste mit
einem bereinigten Plan-JSON wiederholt werden (18 von 33 standen da schon
richtig, 15 Tipps kamen dazu). Begründet in
[`docs/themen/zuteilung-wer-schaut-zu.md`](docs/themen/zuteilung-wer-schaut-zu.md).

Pläne und Protokolle: `~/.local/state/warsync/ws_einstellen/`.

---

## Nächste Schritte, wenn jemand weitermacht

1. **Den 20. Platz in Team B entscheiden.** Der Ausgetretene müsste im Werkzeug
   auf `active=false`; danach rückt im Reiter „🧮 Verteilung" jemand nach, und
   der eine Nachrücker wäre im Spiel noch zu setzen. Anmeldeschluss ist
   Donnerstag 04:00.
2. **Die leere Trefferliste von „Dialog zu" trennen** (`einstellen.py`,
   `_eingabezeile_schliessen`) — sie gehört als `offen`-Zeile in den Bericht,
   wie beim Suchlauf, statt den Lauf zu beenden.
3. Entscheiden, ob Paket A und B committet werden. Sie sind unabhängig
   voneinander und sollten zwei Commits bleiben.
4. `ws_anmeldestand` ist leer — klären, ob der Wochen-Schnappschuss je
   geschrieben wurde oder nur die Belege.
5. `--uebernehmen <ordner>` in `suchlauf.py` nachziehen. Zweimal hintereinander
   ist ein `--schreiben` vergessen worden, und beide Male war es nur von Hand
   zu retten.
6. BlueStacks' Auto-Update abschalten oder bewusst anlassen.

---

## Was in der Wurzel noch herumliegt

`PROGRESS.md` (02.09.) und `STATUS_AUTONOMOUS_RUN.md` (02.09.) sind ebenso alt
wie die weggeräumten Übergaben, aber keine Session-Mitschnitte — sie sind
absichtlich stehen geblieben. Wenn sie weg sollen, sagen.

In `/Users/ben` liegen drei weitere Mitschnitte (`session.md`,
`session-2734b207.md`, `session-a7831694.md`). Die gehören zum dortigen Projekt
und sind hier nicht angefasst.
