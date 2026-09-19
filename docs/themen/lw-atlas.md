---
thema: LW Atlas — die zweite Quelle für Karte, Spieler und Allianzen
code: scripts/lwatlas/ (api.py, sync.py, ergebnis.py) · src/core/lwatlas.js, src/ui/lwatlas.js
tabellen: lwa_spieler, lwa_allianzen · Sicht lwa_allianz_liste
verwandt: basen-erkennung, vs-duell, kampfanalyse, spielerdaten
---

# LW Atlas

## Worum es geht

`https://api.lwatlas.com` liefert dieselbe Auskunft, die unser Kartenscan mühsam aus
Bildern liest — nur aus den Spieldaten selbst. Namen in japanischer, kyrillischer und
chinesischer Schrift stehen dort richtig, wo die Texterkennung `5 1 ZaoTail` statt
`ザオタイ ZaoTai` liefert. Dahinter steht das Hobbyprojekt einer Einzelperson, ohne
Verbindung zum Spielehersteller.

## Zugang und Pflichten

**Der Schlüssel liegt außerhalb des Repos** in `~/.config/warsync/lwatlas.env` (Rechte
600, Variable `LWATLAS_KEY`), zusätzlich im Tresor unter `Last war developer`. Er wurde
einmalig per E-Mail zugestellt und ist **nicht wiederherstellbar** — die Website zeigt nur
eine gekürzte Vorschau.

**Namensnennung ist Pflicht.** „Powered by LW Atlas" mit Rückverweis steht unter der
Basen-Seite; ohne sie kann der Schlüssel entzogen werden. Sie ist eine unscheinbare Zeile
und deshalb ausdrücklich in `tests/lwatlas.spec.js` verankert. Untersagt sind außerdem
Weiterverkauf, Massen-Weiterverbreitung und ein daraus gebauter konkurrierender
öffentlicher Kartendienst; interne Allianz-Nutzung ist davon nicht betroffen.

**Cloudflare weist die Python-Kennung mit 403 ab**, bevor die API sie überhaupt sieht.
Ohne eigenen `User-Agent` sieht das wie eine gesperrte Route aus und verleitet dazu, den
umständlichen Map-Scan-Job zu bauen, den es dafür nicht braucht.

## Das Kontingent ist die knappe Ressource, nicht die Zeit

Die kostenlose Stufe hat **10.000 Anfragen je 30 Tage** und füllt sich erst zum Stichtag
wieder auf — ein leergelaufenes Kontingent legt auch den täglichen Kartenabruf lahm.
`Zugang` in `scripts/lwatlas/api.py` zählt `X-Quota-Remaining` bei jeder Antwort mit,
bricht ab, **bevor** `RESERVE` (500) unterschritten ist, warnt unter 25 % Rest und hält mit
1,1 s Abstand die 60 Anfragen je Minute ein.

Drei Sparmaßnahmen gehören zusammen:

- **Mitgliederlisten nur für frische Allianzen.** Auf der Karte stehen auch Kürzel, deren
  letzte Basis im Dezember gesehen wurde — auf #1668 sind das 159 gegen 79 lebende. Jede
  kostet eine Anfrage und liefert die Mitglieder einer Allianz, die es so nicht mehr gibt.
- **Antworten liegen bis zu `--cache-h` Stunden** unter
  `~/.local/state/warsync/lwatlas/cache`. Ein misslungener Schreibvorgang darf nicht noch
  einmal achtzig Anfragen kosten; genau das ist am 12.09.2026 passiert, und der zweite
  Anlauf kostete dadurch null.
- **`--ohne-mitglieder`** holt nur die Karte: eine einzige Anfrage je Server.

Stand nach dem 20.09.2026: Kontingent **9.484 / 10.000** (#1668 mit 100, #1655 mit 35,
dazu fünf Kartenabrufe zum Abschätzen). Ein voller Lauf kostet eine Anfrage je Allianz:
#1668 63 · #1655 35 · #1629 77 · #1635 81 · #1664 61 · #1669 70 · #1699 57. Bei starkem
Abfall melden.

## Tabellen

Beide **serverweit** wie `karte_basen` und deshalb nicht in `TENANT_TABLES` (Migration
`db/2026-09-12_lwatlas.sql`): `lwa_spieler` (alle Spieler des Servers) und
`lwa_allianzen`. Gefüllt von `scripts/lwatlas/sync.py --server 1668 --schreiben`, gelesen
über `src/core/lwatlas.js`, angezeigt unter „Basen" (`src/ui/lwatlas.js`).

Nachzutragen ist nur das Kontingent-teure Stück:
`scripts/lwatlas/sync.py --server 1655 --nur-allianz cult --schreiben` holt Karte plus
**eine** Mitgliederliste (zwei Anfragen statt rund 110).

**Die Auswahlliste des VS-Gegners kommt aus der Sicht `lwa_allianz_liste`, nicht aus
`lwa_allianzen`** (Migration `db/2026-09-13_lwa_allianz_liste.sql`). In der Tabelle steht
nur, wessen Mitgliederliste jemand geholt hat — auf dem frisch geholten #1655 war das
**eine** von 73. Eine Auswahl daraus sähe leer aus, obwohl der Kartenabruf alle Kürzel
längst kennt. Die Sicht gruppiert `lwa_spieler` nach `(server, allianz)` — im Browser ginge
das nicht, PostgREST kann kein DISTINCT.

`power` und `kills` summieren dort nur über Spieler mit Mitgliederliste; `mit_daten` sagt,
auf wie vielen sie beruhen. Ist es 0, steht in der Auswahl **„ohne Kraft/Kills"** und
darunter der Befehl, der sie holt. Ohne den Hinweis sieht eine Allianz, deren Liste fehlt,
aus wie eine harmlose — dieselbe Falle wie „Stufe 0" gegen „nicht gelesen".

## Ein Lauf ersetzt seine Welt — und der Server hängt am Spieler (20.09.2026)

Der Upsert löschte nie. Wer die Welt verlässt, blieb mit Position, Kraft und Kills von
vorletzter Woche stehen und sah in der Suche aus wie ein heutiger Nachbar: zwei Stände
nebeneinander sehen aus wie einer. **Was ein Lauf nicht gesehen hat, löscht `raeumen`**
(`--kein-raeumen` lässt es bleiben, über 25 % Verlust bricht es ab und verlangt
`--raeumen-erzwingen` — eine verkürzte Antwort sähe von innen wie eine Massenabwanderung
aus). Dasselbe gilt für die Kopfzeilen in `lwa_allianzen`, sobald ein Lauf **alle** Listen
geholt hat: am 20.09. flogen 32 mit Summen vom 13.09. heraus.

**Der Server steht am Spieler, nicht an der Anfrage.** Eine Mitgliederliste geht über
Welten hinweg: `cult` saß mit 90 Mitgliedern auf #1655, mit 6 auf #1668 und mit einem auf
#1698. Unter dem angefragten Server verbucht, stand die Allianz **doppelt** in der Tabelle
— 97 Uids einmal als #1655 und einmal als #1668, beide frisch, keine davon falsch
aussehend. Jede Zeile trägt deshalb jetzt ihr eigenes `warzoneId`; wer woanders steht,
bleibt dem Lauf jener Welt überlassen, statt hier als Ausschnitt ohne Karte zu landen.

**Die Karte ist die vollständige Auskunft über ihre Welt.** Seitdem gilt: Karte und 63
Mitgliederlisten zusammen lieferten für #1668 **keinen einzigen** Spieler, den die Karte
nicht schon hatte (8.214 = 8.214). Die Listen steuern Kraft und Kills bei, keine Namen.

**Der Irrweg dorthin ist die eigentliche Lehre.** Zwischendurch stand hier, die Karte sei
löchrig: neun Allianzen (HOT4, MMAX, uN1T …) fehlten auf ihr, meldeten aber frische
Mitgliederlisten mit Koordinaten wie 428/517 — mitten im Kerngebiet. Daraus wurde
„836 lebende Spieler würden gelöscht". **Falsch:** sie sind nicht auf #1668, sondern auf
#1670, #1639 und anderswo. Koordinaten sind kein Beleg für eine Welt — 428/517 gibt es in
jeder. Auch `binabean`, der AR1S führt, steht heute auf #1637 und nicht mehr auf der
Karte, auf der seine alte Basis lag.

Nicht jede Welt gehört in die Tabelle: eine Zeile entsteht nur aus dem Lauf **ihrer**
Welt. Der Zwischenstand hatte 20 halbe Welten angelegt (eine davon mit einer einzigen
Zeile); sie sind wieder weg.

## Der Schlüssel ist `player_uid`, nicht der Name

Wer sich umbenennt, bleibt dieselbe Zeile. Das ist keine Feinheit: beim ersten
Kaderabgleich am 12.09.2026 war die **Hälfte** der vermeintlichen Abgänge eine Umbenennung
mit Sonderzeichen — `CraideN` → `notCraidenAnymore`, `SINNER` → `ꜱɪɴɴᴇʀ`
(Kapitälchen-Unicode), `ERZAN` → `ΞRζλη` (griechische Zwillinge: Ξ=E, ζ=z, λ=A, η=n). Die
letzten beiden erwischt auch der Skelett-Abgleich nicht. Belegt wurden sie über den
**Ort**: unter derselben Koordinate stand in `karte_basen` noch der alte Name.

`ws_players` hat **keine** `player_uid`-Spalte. Solange das so ist, bleibt jeder
automatische Kaderabgleich Schätzung.

## Kraft sagt nichts über Gefahr

kiSS stand am 12.09.2026 mit 20,8 Mrd Kraft hinter XP33 (21,0 Mrd), hatte aber ein Drittel
mehr Kills (557 gegen 433 Mio). Deshalb steht in der Allianzliste beides nebeneinander und
sortiert wird nach **Kills**. Die Spalte „Zuletzt aktiv" ist die zweite Hälfte der
Einschätzung: ein starker Spieler, der seit zwei Wochen nicht da war, verteidigt seine
Basis nicht.

`kurz()` in `src/ui/lwatlas.js` führt Trennzeichen **und** Einheit über `LOC()` („249,1
Mio" ↔ „249.1M"). Der i18n-Beobachter hilft dort nicht — er übersetzt ganze Textknoten,
keine Zahlenformate.

## Koordinate am Spieler

Im Spielerprofil-Overlay steht „📍 Koordinate: X / Y", sofern LW Atlas einen Treffer für
den **exakten** Namen auf dem eigenen Server hat. Bewusst **nicht** dauerhaft in
`ws_players` gespeichert, sondern live nachgeschlagen, und **kein Fuzzy-Abgleich** — damit
bei Umbenennungen nie der Standort einer anderen Person angezeigt wird. Die alte Tabelle
`ws_player_coords` ist seit April tot und wurde bewusst nicht wiederbelebt. Test:
`tests/profil_koordinate.spec.js`.

## Kills schlagen Kraft als Vorhersagekennzahl

Über die vier Kämpfe, für die Ergebnisse vorlagen (11.09.2026):

| Modell | mittlerer Fehler | Sieg/Niederlage richtig | Spannweite der Vorhersagen |
|---|---|---|---|
| Kraft, Ø-Aufstellung | 7,1 Punkte | 2 von 4 | **2,7** |
| **Kills, Ø-Aufstellung** | **4,7 Punkte** | **3 von 4** | 24,7 |
| Kraft, Bestbesetzung | 6,8 | 2 von 4 | 1,2 |
| Kills, Bestbesetzung | 18,5 | 2 von 4 | 17,1 |

**Die Kraft taugt strukturell nicht als Maßstab.** Ihre Vorhersagen liegen alle zwischen
50,8 und 53,5 % — eine Spannweite von 2,7 Punkten über vier völlig verschiedene Kämpfe.
Sie sagt jedes Mal „wird knapp". Der Grund: **alle fünf Allianzen liegen bei 19,4 bis 21,0
Mrd Kraft.** Auf diesem Niveau kann die Kennzahl gar nichts unterscheiden.

Kills unterscheiden sehr wohl (Ø je Spieler): TW2N 9,1 · GfF 5,9 · aly1 5,6 · KOARA 4,9 ·
**XP33 4,4**. Eine Spanne von 1 zu 2 — und XP33 steht am unteren Ende.

**Ehrlichkeit dazu:** vier Datenpunkte sind wenig, und das Modell wurde **nach** dem Blick
auf die Daten ausgewählt. Der Test hat aber mehr geleistet als Kurvenanpassen: er hat die
Kraft-Modelle als *strukturell* untauglich entlarvt, unabhängig davon, wie gut sie zufällig
passen.

Die weiterführende Analyse (wo der Einbruch saß, welche Erklärungen sich nicht trennen
lassen) steht in `kampfanalyse.md`.

## Sessions

- `docs/sessions/2026-09-11-528f1d15.md` — Kills vs. Kraft als Vorhersagemodell
- `docs/sessions/2026-09-12-73a19aae.md` — Koordinatenanzeige, Server #1668 aktualisiert
