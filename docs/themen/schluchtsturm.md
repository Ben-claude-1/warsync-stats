---
thema: Schluchtsturm (Canyon Storm) — Verteilung, Fraktionen, Varianten, Übersichtsbild
code: src/ui/cs.js, src/core/rotation.js (csAutoAssign, csEffSlots, csKapazitaet, csPreset*)
verwandt: wuestensturm, anmeldung-rotation-ersatz, png-export-karten
---

# Schluchtsturm

## Rahmen

Beide Teams um 16:00 in zwei getrennten Matches (`CS_ZEITEN` 16:00 · 03:00, Vorgabe beide
16:00). Welche **Fraktion** ein Team spielt, wechselt wöchentlich — Ordnungshüter (eine
Allianz allein gegen zwei, muss die ganze Karte abdecken) oder Morgenbringer (zwei
Allianzen teilen sich die Karte).

Punktepool über 30 Minuten: **512.400**. Das Hochsicherheitslabor (120/s) ist ab Minute
12 der Hauptfokus. Ertragswerte: Energieturm 50/s, Datenzentren je 20/s, Probenlager je
15/s.

## Anmeldung aus dem Spiel lesen — Suchlauf und Routine (seit 15.11.2026)

Nach der Pause in der Offseason ist Schluchtsturm am 15.11.2026 wieder im Spiel aktiv.
`scripts/cs_service/suchlauf.py` liest die Anmeldungen wie der WS-Suchlauf: jeder
aktive Kadername einzeln ins Suchfeld „Mitglieder suchen", eine Zeile je Name, Belegbild
je Name. Der Scroll-Lauf `run.py` hängt am selben Scroll-Hänger wie der WS und bleibt
nur Rückfall.

```
.venv/bin/python -m scripts.cs_service.suchlauf --namen Ben_the_men Puwe   # Probe, schreibt nie
.venv/bin/python -m scripts.cs_service.suchlauf --schreiben                # ganzer Kader
```

**Hub-Routine „Schluchtsturm-Anmeldung lesen"**: Montag 03:00, über den Starter
(`cs-anmeldung`, `--schreiben --routine`: BlueStacks frisch starten, am Ende beenden).
Dauer rund 25 min.

Live gesehen am 15.11.2026 (So 23:49):

- Weg: Events → Reiter „Schluchtsturm" → Einsatztruppe A (979,1745) → „Verwalten"
  (1368,2435) → „Teilnehmer auswählen". **Truppe A reicht**: das Suchfeld findet alle
  Mitglieder.
- Der Dialog hat oben „Zeit auswählen" und darunter die Zähler 0/3 · 0/20 · 0/10. Das
  **Suchfeld sitzt dadurch 85 px tiefer** als beim WS (`SUCHFELD_VERSATZ`); ohne den
  Versatz las die Feldkontrolle Müll und tippte jeden Namen viermal.
- Zeile eines Angemeldeten: Balken „Lokale Zeit: 2026-11-19 15:00 ~ 15:30" (grün) bzw.
  „2026-11-20 02:00 ~ 02:30" (orange). **Wer beide Zeiten wählt, zeigt sie
  abwechselnd**, wie beim WS. Daneben das rote Feld „Bitte um Einsatz für Truppe [A]",
  rechts die beiden grauen Felder gesetzt/Ersatz.
- Uhrzeiten im Balken liest Tesseract kaum (weiß mit Umriss) — für den Wert werden sie
  nicht gebraucht, im Bericht steht dann die Farbe.
- **Das Spiel schließt die CS-Anmeldung Dienstag ~03:00** („endet in 1d 03:11:21" am
  Sonntag 23:49), das Werkzeug friert die Teams schon **Montag 04:00** ein
  (`csMontagCutoff`). Die Routine liegt deshalb auf Montag 03:00.

Werte (`wert_aus_zeilen`), nur `AC`/`BC` wie beim WS-Scan:

| Zeile | Wert |
|---|---|
| Buchstabe im gesetzt- oder Ersatz-Feld | dessen Truppe + `C` |
| rotes Feld „Truppe [A]" | `AC` |
| Balken ohne rotes Feld | `BC` (Wunsch B; das rote Feld zeigt nur die geöffnete Truppe — **noch nicht live gesehen**, Annahme aus `cs_service/__init__.py`) |
| kein Balken | nicht angemeldet, kein Eintrag |

Geschrieben wird **ersetzend** und nur über den ganzen aktiven Kader, vorher eine
Sicherung. **Ein Platz derselben Truppe aus dem Werkzeug (`A`/`AE`, `B`/`BE`) bleibt
stehen** — aber nur, wenn der Stand in dieser Anmeldewoche (ab Di 03:00) gespeichert
wurde. Am 15.11. stand in `csTeamAssign` noch die Einteilung vom September; ohne die
Prüfung wären 53 alte Plätze in die neue Woche gerutscht.

**Probelauf 15.11.2026 23:55** (8 Namen, `--namen`): 6 × `AC` (alle mit rotem Feld „Truppe
[A]", Ben the men mit beiden Zeiten), `Mo By` nicht angemeldet, `Arnavut22` im Spiel nicht
gefunden (Umbenennung/Austritt prüfen). Je Name ~10 s, kein Fehltipp im Suchfeld.
Bericht: `~/.local/state/warsync/cs_service/suche_20261115_235503/`.

**Erster voller Lauf 16.11.2026** (91 Namen, ~15 min): 28 × `AC`, 13 × `BC`, 41 nicht
angemeldet, 9 im Spiel nicht gefunden (ALPEROKÇELİK, Arnavut22, CrystalMaidenn, Little
Kong, Skirata33, So isses, ZephyrusXI, lIBlackJackll, skyluna — Austritte/Umbenennungen
prüfen). **Der BC-Fall ist damit belegt**: Balken ohne rotes Feld, z. B. Mika Pika und
ThAnos (Beweisbilder angesehen).

Der erste Versuch schrieb **nicht**: `xmxmxmxmxmxmx` las die Erkennung im Suchfeld viermal
als `XAMXmXxmxmımımx`, der Name galt als unsicher, und ein einziger unsicherer Name sperrt
das Schreiben. Das wäre jede Woche so gekommen. Seitdem sieht der Lauf auch bei gescheiterter
Feldprobe die Zeile an; ob sie dem Gesuchten gehört, entscheidet wie immer die Gegenprobe
an der Zeile (Name oder Heldenkraft). Zweiter Lauf: `xmxmxmxmxmxmx` → `AC`, keine
Probleme, geschrieben.

## Die Stärke-Leiter der Auto-Verteilung

`csAutoAssign` verteilt in **einer** Reihenfolge, und die ist die Stärke:

1. die Stärksten werden **Assassinen** (Ziel Hochsicherheitslabor, kein Startgebäude),
2. dann der **Energieturm** (`CS_TURM`) — voll besetzt, bevor ein Datenzentrum jemanden
   bekommt,
3. dann gleichmäßig die **Datenzentren** (`CS_DZ`), reihum über beide,
4. **zuletzt die Probenlager** (`CS_LAGER`). Mit 15/s bringen sie am wenigsten ein und
   werden nicht umkämpft; dort stehen die Schwächsten richtig.

**Der Energieturm ist eine eigene Stufe** (seit 16.09.2026). Er bringt mit 50/s mehr als
beide Datenzentren zusammen und wird am härtesten umkämpft. Reihum über alle drei
verteilt bekam er nur jeden dritten Spieler — bei den Ordnungshütern die Ränge 6, 9, 12,
15 und 18 — und stand mit derselben Mannschaft da wie ein halb so wertvolles
Datenzentrum. Heute sind es die Ränge 6 bis 10.

Zwei Fassungen davor lief Schritt 2 reihum über **alle sieben** Startgebäude. Gemessen mit
20 Spielern (Morgenbringer, nur links):

| Gebäude | vor 08.09. | danach |
|---|---|---|
| Hochsicherheitslabor (Assassinen) | S01–S05 | S01–S05 |
| Energieturm | S06, S10, S14, **S17, S19** | S06, S08, S10, S12, S14 |
| Datenzentrum I | S07, S11, S15, **S18, S20** | S07, S09, S11, S13, S15 |
| Probenlager I + II | S08, S09, S12, S13, S16 | **S16–S20** |

Die beiden Schwächsten standen vorher genau dort, wo gekämpft wird.

**Vier Dinge, die zusammengehören:**

- **Sortiert wird ausdrücklich nach `csPower`, nicht nach der Pool-Reihenfolge.** Der Pool
  ist `fest` (die Stärksten) plus `rotationHaupt`, und letztere stehen in der Reihenfolge,
  wer am längsten aussetzen musste. Wer überhaupt mitspielt, ist eine Frage der Fairness —
  welche Rolle er bekommt, eine der Stärke. Bei der Vorgabe (15 Fixplätze, 5 Assassinen)
  ändert die Sortierung nichts; erst wer die Fixplatz-Zahl unter die Assassinen-Zahl
  senkt, hätte sonst einen Rotations-Spieler statt des Stärksten im Labor.
- **Reihum bleibt es innerhalb jeder Gruppe.** Kein Probenlager steht leer, solange ein
  anderes zwei Mann hat; die Datenzentren gehen nie um mehr als einen Mann auseinander.
- **Ein vorgesehenes Gebäude bleibt nie leer.** Reicht die Leiter nicht bis unten, stopft
  die Reparatur die Lücke mit dem **schwächsten** Platz eines überversorgten Gebäudes. Bei
  elf Angemeldeten (5 Assassinen, 6 übrig, drei Gebäude à 5 Plätzen) verschlänge der volle
  Energieturm sonst fast alles und das zweite Datenzentrum stünde mit 0/s da. Danach wird
  die Folge **stabil nach Gruppe** sortiert; ohne das stünde der eingesetzte Platz mitten
  im Block des Turms und ein Schwächerer bekäme das wertvollere Gebäude.
- **Reicht der Kader nicht für alle Plätze, fehlen sie zuerst im Probenlager.** Das ist
  die billigste Lücke, und `csKapazitaet()` meldet sie ohnehin.

**Der T1-Typ mischt nur, wo es eine Wahl gibt.** `typenMischen` läuft je Gruppe — drei
Gruppen (Energieturm, Datenzentren, Probenlager), **getrennt** gemischt. Über die Grenze
hinweg zu tauschen verschöbe jemanden zwischen „dort stehen die Starken" und „dort stehen
die Schwächsten". Der Energieturm ist eine Gruppe aus *einem* Gebäude; ein sortenreiner
Energieturm ist damit möglich — ihn aufzubrechen hieße, einen Schwächeren an das
wertvollste Startgebäude zu setzen.

Getestet in `tests/schluchtsturm_verteilung.spec.js`, beide Prüfungen gegengeprüft (mit
der alten gemeinsamen Gruppe rot). Ein zweiter Test prüft ausdrücklich, dass kein Spieler
die Gruppengrenze überspringt.

## Kartenhälfte, Spawnzonen, Einstellungsvarianten

Drei Einstellungen unter „⚙ Erweitert", alle **je Team**:

| Einstellung | Werte | wirkt |
|---|---|---|
| Bespielte Kartenhälfte | `ganz` · `links` · `rechts` (`CS_SEITEN`) | sperrt die Gebäude der anderen Hälfte |
| Gebäude an den Spawnzonen | `aus` · `eigen` · `gegner` (`CS_SPAWN_REGEL`) | sperrt die Gebäude vor einer Spawnzone |
| Einstellungsvariante | frei benannt, max. `CS_PRESET_MAX` | speichert und lädt beides samt Sollstärken |

**Die Spawn-Regel gibt es in beide Richtungen, und das ist Absicht.** Vor jeder Spawnzone
stehen dauernd Spieler, die auf ihren Teleport-Cooldown warten. Am *eigenen* Spawn heißt
das, dass die Gebäude nebenbei mitgenommen werden — es muss niemand fest hin. Am
*gegnerischen* heißt es das Gegenteil: was man dort nimmt, ist sofort wieder weg. Welche
Lesart gilt, entscheidet der Nutzer. Welche Gebäude gemeint sind, steht ausgeschrieben in
`CS_SPAWN_BLD`.

Vier Dinge, die nicht wegoptimiert werden dürfen:

- **`csEffSlots` füllt die frei gewordenen Plätze wieder auf.** Sperrt man eine Hälfte,
  bleiben sonst genau die Spieler ohne Gebäude stehen, die vorher drüben standen. Die
  eingestellte Sollstärke bleibt daneben unverändert und gilt wieder, sobald die Sperre
  fällt.
- **`csKapazitaet` warnt, wenn es nicht aufgeht.** „Nur links" plus „eigenen Spawn
  aussparen" lässt bei Morgenbringern nur Energieturm und Datenzentrum I übrig: bei
  `CS_MAXCAP` 5 sind das 10 Plätze plus 5 Assassinen für 20 Spieler. Ohne die Warnung
  fielen fünf still in „nicht zugewiesen".
- **Energieturm und Labor gehören zu jeder Hälfte** (`CS_MITTE`). Beide stehen in
  `CS_ANCHOR` auf `x:194`, also auf der Mittelachse; ihr `side` dort ist nur ein Tiebreak
  fürs SVG-Layout und taugt nicht als Aussage. Wer stattdessen `side` abfragt, verliert
  bei „nur rechts" den Energieturm — das wertvollste Dauergebäude.
- **`csPresetLoad` stempelt die Slots auf die Fraktion des Zielteams.** Sonst rechnet
  `csGetSlots` die geladenen Zahlen beim nächsten Zugriff auf die Vorgaben zurück, weil
  `f` und `m` noch aus der gespeicherten Variante stammen — die Variante wäre sofort
  wieder weg.

**Eine Variante gehört zu einer Fraktion, nicht zu einem Team.** Welches Team welche
Fraktion spielt, wechselt wöchentlich; der Zuschnitt hängt fest an der Fraktion, weil die
Karte asymmetrisch ist.

- **Eindeutig ist `(name, faction)`, nicht der Name** (`csPresetFind`). „XP33-Aufstellung
  alt" gibt es sinnvollerweise für beide Fraktionen; ein reiner Namensvergleich träfe beim
  Überschreiben die falsche.
- **Die Auswahlliste gruppiert nach Fraktion**, die des Teams zuerst. Die fremden bleiben
  sichtbar — verstecken hieße, jemand sucht eine Variante, die da ist.
- **Laden über die Fraktionsgrenze fragt nach.** Erlaubt, aber fast immer ein Versehen:
  die Sollstärken sind um den anderen Spawn herum gebaut.

Das `label` eines `<optgroup>` ist ein Attribut und kein Textknoten — der i18n-Observer
fasst es nicht an. Der Fraktionsname dort läuft ausdrücklich über `trs()`.

Varianten liegen im `cs`-Payload von `ws_planner_state` (`csPresets`), nicht unter einem
eigenen Key — damit teilen sie Speichern, Auflösen und Mandantentrennung mit dem übrigen
Schluchtsturm-Stand. Die Aufstellung selbst speichern sie nicht; die entsteht beim
nächsten Auto-Verteilen neu. Getestet in `tests/schluchtsturm_varianten.spec.js`.

## Wechsler für die späten Gebäude

Vier Modi unter „⚙ Erweitert → Einstellungen". Gemessen mit vollem Kader (20 Spieler,
Morgenbringer, Stand ab 8:00):

| Modus | Energieturm | DZ I | DZ II | Probenlager | Verteidigung |
|---|---|---|---|---|---|
| **Datenzentren schonen** (Vorgabe) | 3 | 2 | 2 | je 1 | je 1 |
| Energieturm gibt ab | 1 | 2 | 2 | je 1 | je 2 |
| Gleichmäßig verteilen | 2 | 2 | 1 | je 1 | je 2 |
| Probenlager geben ab | 3 | 3 | 3 | **leer** | je 2 |

Der Modus setzt die Plätze der Verteidigungssysteme mit (1 bei „schonen", sonst 2) —
deshalb der Hinweis, dass ein Wechsel die Sollstärken darunter auf die Vorgaben
zurücksetzt. „Probenlager geben ab" ist der einzige Modus, in dem bewusst ein Gebäude leer
bleibt; das steht im Hinweistext.

**Falle:** beim Hochzählen der Vorgabe-Version prüfte das Laden weiterhin `v===4` — von
Hand verstellte Sollstärken hätten keinen Neustart überlebt.

## Die Gebäude-Karten im Übersichtsbild enden am Kartenrand

Unter dem Bild steht „WECHSEL-FAHRPLAN", und er wird **nach** den Gebäude-Karten
gezeichnet. Eine Karte, die unter den Kartenrand rutscht, wird also von ihm zugedeckt —
sichtbar an den untersten Namen, weiß auf weiß (bei XP33 traf es `ALPEROKÇELİK`).

Getroffen ist immer die **letzte Karte einer Spalte**, und zwar systematisch: Probenlager
I und II stehen in `CS_ANCHOR` beide auf `y:398` (III und IV ebenso). Das zweite wird
deshalb bei jeder Aufstellung unter das erste geschoben und sammelt allen Versatz der
Spalte ein.

`layout()` schiebt die Spalte nach dem Setzen von oben noch einmal **von unten nach oben**
zurecht: jede Karte gibt die Grenze für die darüber vor. Der frühere Lauf war wirkungslos
— er rückte zuerst die unterste Karte an ihren *noch unverschobenen* Vorgänger heran (also
um 0) und erst danach den Vorgänger. Gemessen: vorher y 670–757 bei Fahrplan ab 738,
danach y 643–730.

Passt eine Spalte auch dicht gepackt nicht in die Karte, bleibt der Überstand stehen —
Karten übereinanderzuschieben wäre nicht besser. Getestet in
`tests/cs_karte_rand.spec.js`, gemessen an dem, was der Nutzer sieht.

## Das Briefing

Der Text im Mail-Tab ist **5.827 Zeichen in 14 Abschnitten**, ohne Spielernamen und ohne
Fraktionsbezug, alle Zeilen unter 65 Zeichen. Der Ablauf-Abschnitt zieht Text aus der
Phasen-Definition und wird automatisch umgebrochen — ändert man die Phasentexte, ändert
sich das Briefing mit.

Zwei Stellen sind nicht aus dem In-Game-Regelbildschirm belegt: „Kraftwerk halten" stammt
aus einem englischen Guide („Power Station"), und ob die drei grünen F-Marker auf der
Karte die Kraftwerke sind, ist offen. „Die Abklingzeit ist hier spürbar länger als im
Wüstensturm" kommt aus dem Season-Help-Chat.

Für eine Allianz-Mail sind 5.800 Zeichen viel — der Vorschlag, bei weiteren Zusätzen zu
teilen (die ersten sechs Abschnitte als Pflichtlektüre, den Rest als Nachschlagewerk),
steht noch offen.

## Sessions

- `docs/sessions/2026-07-27-3af791cc.md` — Modus implementiert, Punkteverteilung, Briefing
- `docs/sessions/2026-08-11-0b1baaa7.md` — 20 + 10 Plätze, Startzeiten
- `docs/sessions/2026-08-28-86dd2587.md` — Wechsler-Modi, Persistenz-Falle
- `docs/sessions/2026-08-31-e65440b8.md` — Ersatz-Knöpfe A·AE·B·BE
- `docs/sessions/2026-09-01-bdf4fb08.md` — Kartenhälfte, Spawn, Varianten je Fraktion
- `docs/sessions/2026-09-08-a304bec6.md` — Fahrplan deckt Karten zu, Stärke-Leiter
- `docs/sessions/2026-09-15-0b9f0206.md` — Energieturm als eigene Stufe (`240d836`)

## Gesamtablauf und Aufstellung ohne Browser (seit 18.11.2026)

`.venv/bin/python -u -m scripts.event_ablauf cs --schreiben --pushover` (Hub-Routine
`cs-ablauf`, noch ohne Zeitplan). Der Ablauf ist derselbe wie beim Wüstensturm (siehe
[`wuestensturm.md`](wuestensturm.md), Abschnitt „Gesamtablauf“): Mitglieder, Suchlauf,
Aufstellung, Einsteller, Rückschreiben. Drei Teile sind eigens für den Schluchtsturm:

- **`scripts/cs_plan.mjs`** rechnet die Aufstellung headless mit der Logik des Werkzeugs. `csRosterGroups(t)` liefert fest + Rotation-Haupt (→ `A`/`B`), Rotation-Ersatz (→ `AE`/`BE`) und die Warteliste (bleibt `AC`/`BC`). `csAutoAssign()` vergibt die Gebäude. Beide Funktionen stehen dafür als `window.__headless` in `src/app/globals.js` bereit; der zweite Name daneben ist `csLoadState`. Alle Schreibzugriffe sind gesperrt.
- **„Anmeldung geschlossen“ aus der Vorwoche.** `csAnmeldungClosed` stand am 18.11.2026 noch vom Kampf des 17.11. auf `true`, und `csRosterGroups` hätte die eingefrorene alte Aufstellung zurückgegeben. Der Suchlauf schreibt nur `csTeamAssign` und lässt den Schalter stehen. `cs_plan.mjs` nimmt die eingefrorene Aufstellung deshalb nur, wenn das letzte CS-Event **heute oder später** liegt, gerechnet mit dem Datum in Berlin, nicht in UTC. Sonst rechnet es aus den aktuellen Anmeldungen. Das Rückschreiben setzt den Schalter dann auf `false`.
- **Rückschreiben in einem einzigen PATCH:** `csTeamAssign`, `csPlanA/B`, `csAnmeldungClosed` und `savedAt`. Zwei Schreibvorgänge hintereinander ließen dazwischen einen halben Stand stehen.

**Der CS-Suchlauf pflegt jetzt auch die Heldenkraft**, wie der WS-Suchlauf (`tool.schreibe_heldenkraft`). Er nimmt sie nur aus Zeilen, die als die des Gesuchten bestätigt sind, und schreibt sie auch ohne `--schreiben`.
