---
thema: PNG-Export und Kartenbilder — Canvas, Schildgrößen, Kartenbild
code: src/core/png.js, src/ui/karte.js, src/ui/wsmap.js, src/ui/cs.js
verwandt: frontend-build-deploy, i18n-de-en, bluestacks-steuerung, planungsstand-anwesenheit
---

# PNG-Export und Kartenbilder

## Warum das Bild eigene Regeln hat

Das PNG ist das, was in der Allianz gepostet wird. Wer nur die Anzeige im Fenster ändert,
hat das Bild nicht geändert — und umgekehrt. Alle Fehler in diesem Bereich folgen demselben
Muster: die Vorschau sah richtig aus, das gepostete Bild nicht.

## Anzeige und PNG-Export sind entkoppelt

`renderTags` skaliert die Schilder mit der angezeigten Kartenbreite (Faktor 0.0175 ≈ 11 px
bei 632 px), aber mit **Untergrenze 9 px** — maßstabsgetreu wären es am Handy 5,9 px und
damit unlesbar.

`buildKarteCanvas` zeichnet deshalb **nicht aus dem DOM**, sondern aus `pos`/`getGroups()`
mit demselben Faktor auf die Canvas-Breite. Ergebnis: das PNG ist auf jedem Gerät
bitgleich, die Vorschau am Handy zeigt die Schilder etwas größer als das Bild.

**Wer das wieder über `getBoundingClientRect()` löst, holt sich den alten Fehler zurück:**
der Export skalierte mit `naturalWidth / Anzeigebreite` und fiel am Handy doppelt so groß
aus wie am Mac.

## Das Team-Schild folgt demselben Faktor

0.02215 ≈ 14 px bei 632 px, in `renderTags` wie in `buildKarteCanvas`. Es hing im Export an
`cw/18` — bei 1206 px Bildbreite **67 px statt 27 px**, gut zweieinhalbmal so groß wie im
Fenster: im geposteten Bild lag es über dem halben Kartenkopf, während die Vorschau ein
kleines Schild zeigte. Größe, Polster, Radius und der farbige Balken links stehen deshalb in
denselben Verhältnissen zur Schriftgröße wie im CSS.

Getestet in `tests/ws_karte_label.spec.js` — gemessen wird die Schrift, mit der die Canvas
das Schild zeichnet, gegen die der Anzeige, hochgerechnet auf die Bildbreite. **Nur auf dem
Desktop:** am Handy zeigt die Anzeige das Schild bewusst größer als der Maßstab hergibt
(Untergrenze 11 px), dort prüfte der Vergleich die Ausnahme statt der Regel.

## Streifen unter dem Bild: die Höhe muss vorher feststehen

Ersatzspieler (Wüstensturm) und Assassinen stehen **unter** der Karte, nicht darauf. Dabei
gilt zweimal dieselbe Regel:

- **Die Höhe der Canvas muss vor dem ersten Strich feststehen** — ein späteres `c.height=…`
  löscht die Zeichenfläche wieder. `ersatzBand` rechnet das Maß, gezeichnet wird erst
  danach. Im SVG geht die Höhe (`assH`) in die viewBox.
- **Gerechnet wird aus den Daten, nicht aus dem DOM** (`wsErsatzListe()`), sonst hinge das
  PNG wieder an der Anzeigebreite.

Getestet in `tests/ws_karte_ersatz.spec.js`.

## Die Zeichenreihenfolge kann Inhalt verdecken

Im Schluchtsturm-Übersichtsbild wird „WECHSEL-FAHRPLAN" **nach** den Gebäude-Karten
gezeichnet — eine Karte, die unter den Kartenrand rutscht, verschwindet darunter (weiß auf
weiß). Der Fix und die systematische Ursache stehen in `schluchtsturm.md`; geprüft wird an
dem, was der Nutzer sieht (`tests/cs_karte_rand.spec.js`).

## Kartenbild ist zweistufig

In `karte_bg` (im geteilten Planungsstand) steht der Standard für die ganze Allianz.

| Knopf | Wirkung |
|---|---|
| „🔄 Eigenes Bild" | speichert nur in den `localStorage` dieses Geräts und setzt `ws_karte_bg_own` — solange es gesetzt ist, ignoriert das Gerät den Standard |
| „↺ Standardbild" | löscht das Flag |
| „🌐 Als Standard für alle" | nur `canAccess('ws')`, schreibt das aktuelle Bild als neuen Standard |

Ein Upload allein ändert für andere also nichts.

`karte_bg` (Base64-Bild) wird **nicht** beim Seitenaufruf geladen, sondern erst beim Öffnen
der Aufstellungs-Karte.

## Format und Größe

Der Export nach Fotos.app läuft als **JPEG**: aus 2,3 MB PNG wurden 331 KB. „💾 Speichern"
liefert weiterhin PNG (2,6 MB), nur „📷 In Fotos" macht das kleine JPEG.

Dass „Zu Fotos hinzufügen" im Teilen-Menü fehlte, lag nicht am Format, sondern an der
Kombination **JPEG + `title`** — PNG mit Titel ging, JPEG ohne Titel ging, beides zusammen
nicht. Der Titel ist raus.

Für den Weg ins Spiel siehe `bluestacks-steuerung.md` — dort ist der **Media-Scan** der
Hebel, nicht der Ordner.

## Das Canvas-Muster

Canvas zeichnen (Scale 2 für Schärfe), dann via `toDataURL`/`toBlob` herunterladen bzw.
teilen/kopieren. Auf dem Handy öffnet das Bild im neuen Tab → langer Druck → „Zum
Fotoalbum sichern"; „📤 Teilen / Kopieren" nutzt das native Teilen-Menü, am Desktop
landet das Bild in der Zwischenablage. Dasselbe Muster tragen der 7-Tage-Zugfahrtplan
(940×732 px) und die Aufstellungsbilder.

**Canvas ist kein DOM** — Beschriftungen brauchen einen expliziten `trs()`-Aufruf (siehe
`i18n-de-en.md`).

## Sessions

- `docs/sessions/2026-09-02-96421f2f.md` — Team-Schild-Größe angeglichen
- `docs/sessions/2026-09-02-578476a9.md` — Ersatzliste unter der Karte
- `docs/sessions/2026-09-02-5b960667.md` — JPEG-Export, Titel-Falle
- `docs/sessions/2026-09-02-a6a5eabd.md` — JPEG reduziert auf 227.106 Bytes
- `docs/sessions/2026-06-29-d3fb0bc9.md` — das Canvas-Muster am Zugfahrtplan
