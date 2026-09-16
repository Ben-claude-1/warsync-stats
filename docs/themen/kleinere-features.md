---
thema: Kleinere Bereiche — Hive-Aufstellung, Zugfahrt, Allianz-Kommunikation
code: src/core/hive.js, src/ui/hive.js · Zugfahrt (zug_rides)
verwandt: png-export-karten, frontend-build-deploy
---

# Kleinere Bereiche

## Hive-Aufstellung

Bauplan für die Hive — welche Basis auf welches Feld gehört, mit Kampfkraftangabe. Eigene
Kachel im Dashboard (die sechste), Logik in `src/core/hive.js`, Oberfläche in
`src/ui/hive.js`. Modi: Zentrum, Innenring, Bereich.

Getestet in `tests/hive.spec.js` (Kachel · Zentrum-Modus · Innenring · Bereich-Modus · zu
klein · leere Eingabe).

Das Hive-Raster ist auch außerhalb des Features nützlich: die Basen stehen auf einem
**3-Einheiten-Raster** (Y ≡ 2 mod 3), und das dient dem Kartenarchiv als unabhängige
Gegenprobe für gerechnete Koordinaten.

Bei den Tests entstand eine Zeile in `ws_planner_state` (x:436, y:507) aus einem
Testlauf — ein Beispiel dafür, dass Browser-Tests in die Produktiv-Datenbank schreiben
(siehe `datenbank-backup.md`).

## Zugfahrt-Einteilung

7-Tage-Plan, der automatisch R4/R5 als Zugführer am Montag, Mittwoch und Freitag einplant.
Tabelle `zug_rides` (mandantengetrennt, `on_conflict` führt `'alliance_id,ride_date'`).

Im Tab „Einteilung (7 Tage)" gibt es zwei Knöpfe:

- **📷 Bild erstellen** — erzeugt den Plan als PNG (940×732 px) und lädt ihn herunter; auf
  iOS öffnet er sich im neuen Tab → langer Druck → „Zum Fotoalbum sichern".
- **📤 Teilen / Kopieren** — am Handy das native Teilen-Menü, am Desktop in die
  Zwischenablage.

Das Bild zeigt Titelband mit Allianz und Datumsbereich, Spalten **TAG · ZUGFÜHRER · VIP**
mit Rang-Kürzel, Mo/Mi/Fr rot markiert (roter Balken links + „R4/R5"-Tag), Zebra-Streifen
und eine Legende mit Erstellungsdatum. Es spiegelt immer den aktuellen Stand — gespeicherte
Einteilungen **und** noch offene Auto-Vorschläge.

Das Canvas-Muster daraus (Scale 2 für Schärfe, dann `toDataURL`/`toBlob`) ist dasselbe wie
bei den Aufstellungsbildern — siehe `png-export-karten.md`.

## Allianz-Kommunikation

**Allianz-Mails sind auf 500 Zeichen begrenzt**, und das ist eine harte Grenze: ein Text
mit exakt 500 wird abgeschnitten, falls das Spiel Zeilenumbrüche als `\r\n` zählt. **495 ist
die sichere Obergrenze.**

Beim Kürzen fällt zuerst weg, was den Ton trägt — „Mir ist wichtig, dass…" (die Absicht als
Bens, nicht als Regel), „Das will ich vermeiden" (die Konsequenz als etwas, das er nicht
will, sondern müsste), „zeitweise" (Raum für den, der einmal wegen RL fehlt). Bei einer
Ansage an die Allianz lohnt es, die längere Fassung zu prüfen, bevor man kürzt.

**Die Strategie-Texte stehen in `TEXTAREA` und werden bewusst nicht übersetzt** — sonst
speichert ein englischer Nutzer beim Bearbeiten eine englische Ansage für die ganze
Allianz (siehe `i18n-de-en.md`).

Der Schluchtsturm-Briefing-Text ist mit 5.827 Zeichen deutlich länger, weil er als
Nachschlagewerk gedacht ist — Details in `schluchtsturm.md`.

## Discord

Der Allianz-Discord wird über einen Einladungslink betreten (Form
`https://discord.gg/<code>`), entweder im Browser oder direkt in der App. Der Server
erscheint danach links in der Serverleiste; die Chatkanäle werden sichtbar, sobald eine
etwaige Verifizierung abgeschlossen ist.

## Sessions

- `docs/sessions/2026-08-08-e39699e4.md` — Hive-Bauplan, Modularisierung, 26 Tests
- `docs/sessions/2026-06-29-d3fb0bc9.md` — Zugfahrt-Plan als PNG
- `docs/sessions/2026-08-06-b98154ee.md` — die 500-Zeichen-Grenze
- `docs/sessions/2026-09-11-56c8bb44.md` — Discord-Zugang
