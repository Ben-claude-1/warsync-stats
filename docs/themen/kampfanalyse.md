---
thema: Kampfanalyse und Kampfsimulation — Berichte, Moral, Lanchester, Boss-Mechanik
tabelle: combat_reports (Migration db/2026-09-14_combat_reports.sql)
verwandt: lw-atlas, anmeldung-rotation-ersatz, ws-dienst-ergebnis
---

# Kampfanalyse und Kampfsimulation

## Die Sammlung

Ben schickt hin und wieder Last-War-Kampfberichte (Screenshots aus dem Spiel, die als
iCloud-Fotos auf dem Mac landen). Ziel ist eine Sammlung, aus der sich später Kämpfe
vergleichen und simulieren lassen. Tabelle `combat_reports`, gefüllt **direkt** per
`docker exec -i supabase-db psql`, nicht über `api.js`/PostgREST — es gibt dafür (noch)
keine Oberfläche.

**Holen der Bilder:** die letzten *n* Fotos aus Fotos.app per `osascript` exportieren —
über den **Index** (`item (count of media items) - n + 1 thru (count of media items) of
media items`, dann `export … using originals false`), **nicht** über ein
Datums-`whose`-Filter: `media items whose date > …` scheitert an einem AppleScript-Typfehler
(„date kann nicht in Typ specifier umgewandelt werden"), auch mit Variable statt Literal.
Jeder Kampfbericht verteilt sich auf mehrere Screenshots (Helden-/Armee-/Statistiken-Tab,
dazwischen Ausrüstung/Fähigkeiten) — alle exportierten Bilder mit `Read` ansehen und die
Werte per Auge ablesen, **keine OCR-Pipeline dafür bauen**.

**Kein Mandanten-Tisch.** Ein Kampf gehört keiner der beiden Allianzen dieses Werkzeugs —
die Gegenseite kann aus einer dritten Allianz sein. `alliance_id` würde hier nichts
abbilden, also steht die Tabelle bewusst nicht in `TENANT_TABLES`, wie schon `karte_basen`.

**Eine Zeile, zwei JSONB-Spalten (`side_a`/`side_b`), kein Spalten-Wildwuchs.** Das
Berichts-Layout variiert bereits zwischen den ersten beiden ausgewerteten Kämpfen; ein
starres Spaltenschema bräche bei jeder Abweichung. **`side_a` ist immer der Angreifer,
`side_b` immer der Verteidiger** — die Rolle ist die eine Variable, die das Ergebnis
bisher erklärt, und als feste Spaltenbedeutung lässt sie sich ohne `CASE` vergleichen.

Beide Seiten tragen dieselbe Struktur: `name`, `tag`, `server`, `x`/`y`, `rolle`,
`ergebnis`, `verluste`, `kraft` (Helden, Armee, Drohne, Technologie, Dekoration,
Einheiten, Ehrenwand, Overlord, Kosmetik, Andere — alle in Mio),
`kraft_helden_detail`, `aufstellung_bonus`, `tech_boni`, `attribut_boosts`,
`allianz_tech`, `kampffortschritt_level`, `chip_sternstufe`, `overlord`, `drohne_level`,
`moral`, `einheiten_stats`, `gesamtschaden_mio`, `schaden_je_position_mio` und
`erlittener_schaden_je_position_mio` (Reihenfolge aus dem Statistiken-Tab, **nicht**
namentlich den Helden zugeordnet — das ist aus dem Bild allein nicht sicher zu klären)
sowie `besetzung` (Heldenname/Level/Sterne/Ausrüstungslevel aus dem Fähigkeiten-Tab,
getrennt von der Schadensliste geführt statt zusammengeraten).

**Fehlt ein Wert im Screenshot-Satz, bleibt das Feld weg statt geraten zu werden.**

**`kampfbericht_id`** (aus der Fußzeile jedes Berichts-Screenshots) ist der Unique-Key
gegen Dubletten — `ON CONFLICT (kampfbericht_id) DO NOTHING`.

## Der erste Befund — und zwei Fehlschlüsse hintereinander

Am 14.09.2026 stehen zwei Kämpfe 23 Sekunden auseinander, beide mit Ben als einer Seite
und damit mit identischen eigenen Werten — ein kontrolliertes Experiment, wie es sonst
nicht zu bekommen ist. In **beiden** gewann der Verteidiger, mit fast derselben Zahl:

| Zeit | Angreifer | Verteidiger | Schaden A | Schaden V | V/A | Überlebende A / V |
|---|---|---|---|---|---|---|
| 14:23:27 | `[BKNz]對不起錯過` | `[XP33]Ben the men` | 42,4 Mio | 53,3 Mio | **1,258** | 0 / 616 |
| 14:23:50 | `[XP33]Ben the men` | `[CYKA]panglimas` | 41,9 Mio | 52,6 Mio | **1,256** | 0 / 495 |

**Erster Fehlschluss: „die Rolle schlägt die Statistik, der Verteidiger hat ~26 % Bonus."**
Falsch, und lehrreich:

- **Die 1,26 ist keine zweite Messung, sondern dieselbe.** Der berichtete Schaden einer
  Seite ist ~proportional zu den Verlusten der anderen. Verlustverhältnis gegen
  Schadensverhältnis: 1,290 gegen 1,258 und 1,228 gegen 1,256 — 2 % auseinander. „Der
  Sieger macht mehr Schaden" ist tautologisch.
- **Ein Vorteil von 5–6 % genügt für dieses Ergebnis.** Nach dem Lanchester-Quadratgesetz
  (`a·A² − b·B² = const`, weil jede überlebende Einheit weiterschießt) reicht ein Vorsprung
  von **+6,4 %** bzw. **+5,1 %** je Einheit, um den Gegner vollständig auszulöschen und
  selbst 616 bzw. 495 Mann zu behalten. **Totalverlust ist kein Zeichen von Überlegenheit,
  sondern das normale Ende eines knappen Kampfes.**
- Die Moral schien den Vorsprung zu erklären (Kampf 1: „Die Moral der Roten ist das
  1.07-fache") — benötigt waren 6,4 %. Das passte zu gut.

**Zweiter Fehlschluss: „erster Term ist die Moral, nicht die Rolle."** Er hing an einem
ungelesenen Screenshot. In Kampf 2 steht das Gegenteil des Vorhergesagten — „die Blauen
haben das 1.08-fache der Roten", und Blau war Ben:

| | Blau = Angreifer | Rot = Verteidiger | Moral | Ausgang |
|---|---|---|---|---|
| 14:23:27 | `BKNz` | **Ben** | Ben +7 % | Verteidiger siegt |
| 14:23:50 | **Ben** | `panglimas` | Ben +8 % | Verteidiger siegt |

**Blau ist immer der Angreifer, Rot immer der Verteidiger.** Bens Moralvorsprung ist
konstant (~7–8 %, dieselbe Armee). Damit taugt die Moral gerade **nicht** als Erklärung:
sie zeigt in beiden Kämpfen in dieselbe Richtung, während sich das Ergebnis umdreht. Eine
Variable, die sich nicht ändert, erklärt keinen Unterschied.

Rechnet man die Moral heraus, bleibt je Kampf ein Rest aus unbekannter Quelle: **−0,6 %**
in Kampf 1 gegen **+13,5 %** in Kampf 2. Ein *konstanter* Verteidigerbonus müsste in beiden
Zeilen dieselbe Zahl sein — ist er nicht. Auch die Rolle allein erklärt es also nicht.

## Stand der Beweislage, ohne Kür

- **Für** einen Rollenbonus spricht, dass sich zwischen den beiden Kämpfen genau eine
  relevante Größe umdreht — die Rolle — und mit ihr das Ergebnis, obwohl Bens Werte und
  sein Moralvorsprung gleich bleiben. Dazu: der Angreifer, der *gegen* Ben verlor (`BKNz`),
  war auf dem Papier **stärker** als der Verteidiger, gegen den Ben verlor (`panglimas`) —
  Armee 32,0 vs 29,6 Mio, Helden-Tech 84 % vs 64 %, Einheiten-Tech 98 % vs 84 %.
- **Dagegen** spricht, dass es verschiedene Spieler sind. Die fehlenden 13,5 % könnten
  heißen, dass `panglimas` in etwas stärker ist, das der Bericht nicht als Kraftzahl
  ausweist (Truppenstufen, Heldenfähigkeiten im Gefecht).

Mit zwei Kämpfen **nicht trennbar**. Das entscheidende Experiment ist nicht „noch ein
Kampf", sondern ein ganz bestimmter: **derselbe Gegner in beide Richtungen** — einmal von
ihm angegriffen werden, einmal ihn angreifen. Dann ist die Gegnerstärke konstant und nur
die Rolle wechselt.

**Methodische Lehre aus zwei Fehlschlüssen:** beide entstanden daraus, aus zwei
Datenpunkten eine Ursache zu benennen. Die Sammlung ist dafür da, das zu vermeiden — bis
ein Kampf die Rolle isoliert, bleibt in der Doku *keine* Ursache behauptet.

## Was von den öffentlichen Formeln brauchbar ist

`lastwarhandbook.com/guides/troop-combat-math-guide` blockt `WebFetch` mit 403
(Cloudflare, wie LW Atlas) — über den Playwright-Browser kommt man durch. Die Seite ist
teils SEO-Füllmaterial („1 views", widersprüchliche Daten), und die „Kernformel"
`Final Damage = (Base Attack × Skill × Type) − (Defense × Reduction) + Equipment` hat
weder Einheiten noch Zahlen. **Prüfbar ist sie trotzdem** — an der einen Stelle, wo unsere
Berichte gegenlesen können, stimmt sie exakt:

| Gleiche Heldentypen | Guide | unsere Kampfberichte |
|---|---|---|
| 4 Helden | +15 % auf HP/Angriff/Verteidigung | Ben: „…jeweils um 15.0 %" ✓ |
| 5 Helden | +20 % | BKNz: „…jeweils um 20.0 %" ✓ |
| 3 Helden | +5 % | (kein Beleg) |

Damit sind die übrigen Konstanten als Arbeitsgrundlage tragbar:

- **Truppentyp-Konter: ±20 %** (1,20× ausgeteilt, 0,83× erhalten) — zusammen rund 40 %
  Schwung. Der Berichtssatz „Deine Aufstellung ist gleich stark wie die gegnerische" meint
  **diesen** Konter, nicht den Formationsbonus: er stand auch dort, wo BKNz +20 % gegen
  Bens +15 % hatte.
- **Moral 1 : 1**, und wichtiger die **Kaskade**: „Losing troops reduces morale, which
  reduces damage, which causes more losses." Die im Bericht genannte Moral ist damit ein
  **Startwert**, nicht der Kampfwert — das Modell ist rückgekoppelt, und genau deshalb
  kippen knappe Kämpfe in Totalverluste.
- **Die einzige genannte Verteidiger-Asymmetrie** ist ein Gebäudebonus von **+25 % gegen
  Aircraft bei Basisverteidigung**. Sonst nennt auch diese Quelle keinen Rollenbonus.

**Und damit fällt selbst die weg — denn beide Kämpfe waren gar keine Basisverteidigung.**
`#9016` in der Kopfzeile ist **nicht der Server**, sondern das **Schlachtfeld** (die Spalte
heißt deshalb `schlachtfeld`, nicht `ort_server`). Zwei Belege: die Gegner stammen aus
**#1746** und **#1668**, der Kampf lief also serverübergreifend; und die
Berichts-Koordinaten passen nicht zur Weltkarte — in `lwa_spieler` steht Ben auf **482/554**
und panglimas auf **480/442**, im Bericht auf 499/514 und 494/520. Dazu passt „Besiegt 0"
auf **allen vier** Seiten: auf Event-Schlachtfeldern gibt es laut Guide keine dauerhaften
Truppenverluste.

Für die offene Rollenfrage heißt das: Gebäude, Wälle und die
Verteidigungsanlagen-Technologie greifen dort vermutlich überhaupt nicht — die
naheliegendste Quelle eines Verteidigervorteils ist **ausgeschlossen**, und der Rest von
13,5 % bleibt unerklärt. Der Kampfort unterscheidet die beiden Fälle zusätzlich: bei
`BKNz` lag er **exakt auf Bens Position** (499/514), bei `panglimas` auf **keiner** der
beiden (498/519).

## Ein einzelner verlorener Kampf, vollständig zerlegt (13.09.2026)

`Ben the men → [XP33]SyDdu38`, Angriff fehlgeschlagen, −2.796 gegen −1.970. Auf dem Papier
Gleichstand: **40,5M gegen 40,1M** Kampfkraft. Trotzdem alle Truppen verloren, er hatte
855 übrig und **null** Tote. Der Beleg steht im Statistik-Blatt:

| | Ben | Gegner |
|---|---|---|
| Helden-Schaden gesamt | 39,0M | **53,5M** |
| Drohne | 7,1M | 9,3M |

**37 % mehr Schaden bei gleicher Kampfkraft.** In der Reihenfolge des Gewichts:

1. **4 statt 5 Helden desselben Truppentyps** — +15 % statt +20 % auf HP, Angriff und
   Verteidigung, die größte Einzellücke (5,2M gegen 6,8M). Der Ausreißer ist **Adam**
   (Fahrzeug, alle anderen Infanterie) — und ausgerechnet Adam machte mit 1,2M den
   geringsten Schaden. Er hat den Bonus gekostet und selbst nichts eingebracht.
2. **Zweite Truppe gegen Erste Truppe.** Bens Truppe 2 bei **27 %**, seine Truppe 1 auf
   Maximallevel. Helden-Technologie 72 % gegen 82 %.
3. **„Deine Heldenfraktion wird gekontert!"** — erklärt, warum Bens Kimberly mit *höheren*
   Skills (38/38/38/Max) nur 23,3M macht, seine mit 35/35/Max aber 28,9M.
4. **Exklusive Waffen 52 gegen 60 Gesamtlevel.** Bens stehen auf 20/28/**4** — die
   Lv.4-Waffe ist praktisch tot; seine liegen gleichmäßig bei 18/20/22.
5. **Helden-Fähigkeiten** 1,4M gegen 1,5M; bei ihm Williams und Stetmann auf Max.
6. **Verteidigerbonus:** „Zusätzliche Kampfkraft (diesmal)" +8,4M gegen +10,0M.

**Was nicht gefehlt hat:** Armee 30,4 vs 29,7M, Drohne, Technologie, Ausrüstung
(4,8 vs 4,4M), Ehrenwand, Dekoration, Kampffortschritt, alle Attribut-Boosts — alles
vorn. Das sind die Posten mit dem kleinsten Hebel. Verloren wurde in genau den vier
Zahlen, die sich im Kampf **multiplizieren**: Aufstellung, Fraktion, Truppen-Tech, Skills.

## Die Codename-Bosse folgen anderen Regeln als PvP

Wichtig für eine spätere Simulation: **PvE-Boss und PvP sind zwei Modelle, nicht eines mit
anderen Zahlen.**

| Boss | Tage | schwach gegen |
|---|---|---|
| Code 87 | Mo + Do | **Tank** |
| Code 64 | Di + Fr | **Missile** |
| Code 39 | Mi + Sa | **Aircraft** |

Sonntags kein Boss. Vier Fenster täglich (00:00 · 06:00 · 12:00 · 18:00 Serverzeit), je
3 Stunden auf der Karte, **5 Angriffe am Tag**, ab Basis Stufe 8, **keine Rallys**. Drei
Unterschiede entscheiden alles:

- **+50 % statt ±20 %.** Der passende Typ macht 50 % Mehrschaden — keine Schere, kein
  Gegenmalus. Der Bonus **stapelt mit dem Formationsbonus** (5 gleiche Typen +20 %),
  weshalb ein Mono-Typ-Trupp doppelt zahlt: „a 4-star UR tank squad will outdamage a 5-star
  UR aircraft squad against Code 87".
- **90 Sekunden statt Kampf bis zur Vernichtung.** Der Boss stirbt nicht; gewertet wird der
  **höchste Einzelschaden**. Wird der Trupp vorher aufgerieben, zählt der bis dahin
  gemachte Schaden weiter.
- **Damit gilt Lanchester dort nicht.** Das Rückkopplungsmodell lebt davon, dass
  Überlebende weiterschießen — bei einem Zeitlimit gegen ein Ziel, das nicht fällt, zählt
  Schaden pro Sekunde. Wer beides in eine Formel presst, rechnet eines falsch.

**Eine rechenbare Schadensformel gibt es auch hier nicht.** Belastbar sind nur: +50 %
Typbonus, +1 % Angriff je War-Fever-Scout, und ein unbezifferter PvE-Bonus durch Masons
Passiv „Zombie Purge" gegen neutrale Ziele.

**Praktisch für XP33:** 56 Tank, 19 Aircraft, 8 Missile (16 ohne Eintrag). An
Code-87-Tagen (Mo/Do) gut aufgestellt, an Code-64-Tagen (Di/Fr) trifft der Bonus nur acht
Leute. Dieselbe Zahl, die schon beim Mischen der T1-Typen je Gebäude klemmt.

## Wo der Einbruch bei Team-Niederlagen sitzt

Aus der Auswertung der Ergebnis-Mails (11.09.2026): nicht oben, sondern in der Mitte und
unten.

| Ø Einzelpunkte | Top 5 | Mittelfeld | unterste 8 |
|---|---|---|---|
| 04.09. Team A ✅ | 3,83 Mio | 1,82 Mio | 599 Tsd |
| 04.09. Team B ✅ | 4,56 Mio | 2,15 Mio | 651 Tsd |
| **11.09. Team A ❌** | 2,94 Mio (−23 %) | **1,05 Mio (−43 %)** | **323 Tsd (−46 %)** |
| **11.09. Team B ❌** | **4,96 Mio (+9 %)** | 1,46 Mio (−32 %) | 470 Tsd (−28 %) |

Bei Team B haben die Besten sogar **mehr** gemacht als in der Siegeswoche.
Zusammengebrochen ist die zweite Hälfte. In Team A fielen neun von 28 unter 500 Tsd Punkte
— in den Siegen waren das einer bzw. zwei. Dazu fünf, die gar nicht antraten.

**Zwei Erklärungen passen, und sie sind nicht trennbar:** ein Teil der Mannschaft war nicht
wirklich dabei (dafür spricht, dass die Spitze normal ablieferte) — oder die schwächere
Hälfte wurde früh weggeräumt (dafür spricht TW2N mit Ø 9,1 Kills gegen XP33s Ø 4,4). Beides
erzeugt dasselbe Muster. Was die Frage klären würde: **wann** die Punkte entstanden sind.
Das steht nicht in der Mail.

**Die Kraft ist als Erklärung ausgeschlossen, nicht nur unwahrscheinlich:** um das
Punktverhältnis zu erklären, hätten 28 Gegner mit Ø 387 Mio antreten müssen — ihr stärkster
Einzelspieler hat 333 Mio. Nötig wäre das 1,59-fache dessen, was die Allianz überhaupt
aufbieten kann.

## Sessions

- `docs/sessions/2026-09-11-528f1d15.md` — Kills vs. Kraft, wo der Einbruch saß
- `docs/sessions/2026-09-13-6b106d5b.md` — ein Kampf vollständig zerlegt
- `docs/sessions/2026-09-14-06acb96d.md` — `combat_reports`, Lanchester, Boss-Mechanik
