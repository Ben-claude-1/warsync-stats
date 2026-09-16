---
thema: Sprachen DE/EN — die Anzeigeschicht
code: src/core/i18n.js (I18N_EN, I18N_EN_RE, I18N_SKIP, trs, trEN, LOC, i18nMissing)
verwandt: frontend-build-deploy, png-export-karten, anmeldung-rotation-ersatz
---

# Sprachen: Deutsch geschrieben, Englisch angezeigt

## Das Prinzip

Die Oberfläche wird **auf Deutsch geschrieben**. Englisch entsteht durch eine
Anzeigeschicht: nach jedem Rendern laufen Textknoten und die Attribute
`placeholder`/`title`/`aria-label` durch `I18N_EN` (feste Strings) bzw. `I18N_EN_RE`
(Muster für Texte mit eingesetzten Werten). Bei `LANG==='de'` startet der Observer nicht.

Die Sprache wird beim Login gewählt.

**Bei neuen UI-Texten:** deutschen String wie gewohnt schreiben, danach die englische
Entsprechung in `I18N_EN` ergänzen. Fehlt sie, bleibt der Text auf Englisch deutsch stehen
— die App bricht nicht. Was fehlt, zeigt in der Browser-Konsole `i18nMissing()`.

## Die Fallen, jede einzeln belegt

**Reihenfolge in `I18N_EN_RE`.** Die Muster werden verkettet angewandt; spezifische Regeln
müssen **vor** generischen stehen, sonst frisst die generische weg, worauf die spezifische
zielt. Konkret beim Ersatz-Streifen: die Regel dafür muss vor dem allgemeinen
`\bErsatz\b` stehen, sonst übersetzt die generische nur das erste Wort und lässt den Rest
deutsch stehen.

**`TEXTAREA` wird nicht übersetzt.** Dort stehen die Allianz-Nachrichten (Mail-Export,
Strategie-Briefing, Allianz-Text), die im Spiel gepostet werden. Sonst speichert ein
englischer Nutzer beim Bearbeiten eine englische Ansage für die ganze Allianz.

**Canvas ist kein DOM.** Beschriftungen in den PNG-Exporten brauchen einen expliziten
`trs()`-Aufruf. Wer nur das HTML ergänzt, hat das Bild nicht übersetzt — und das Bild ist
das, was gepostet wird.

**Attribute, die kein Textknoten sind.** Das `label` eines `<optgroup>` fasst der Observer
nicht an — der Fraktionsname dort läuft ausdrücklich über `trs()`.

**Jedes Element zerschneidet den Textknoten, und der Observer übersetzt je Knoten.** Die
Zeile „Bisher WS 5/1 · CS 2/0 · C 3" trägt deshalb bewusst **kein** `<strong>` in der Mitte
— auf Englisch stünde sie sonst halb deutsch da.

**Die Anzeigeschicht faltet Zeilenumbrüche zu einem Leerzeichen.** Beim `trs()`-Umweg um
`window.confirm` darf der Schlüssel in `I18N_EN` deshalb **kein** `\n` enthalten, sonst
greift er nie.

**Zahlenformate übersetzt der Observer nicht** — er ersetzt ganze Textknoten. Zahlen und
Datum laufen deshalb über `LOC()` (`de-DE` ↔ `en-GB`), nie hart `'de-DE'` schreiben. Bei
abgekürzten Größen muss `LOC()` **Trennzeichen und Einheit** führen: „249,1 Mio" ↔
„249.1M" (`kurz()` in `src/ui/lwatlas.js`).

**Halb übersetzte Hinweistexte sind mehrfach aufgefallen** („For team A anmelden", der
Hinweistext der Anmeldung) — beim Ergänzen eines Bereichs lohnt der Blick auf die
umliegenden Strings.

## Die Ausnahme: das Schluchtsturm-Übersichtsbild ist immer englisch

`csMapSvg` bleibt englisch, auch bei deutscher Oberfläche. Es wird als PNG in der Allianz
gepostet, und im Spiel heißen die Gebäude englisch — auch auf dem Hintergrundbild
`assets/cs_map_bg.png`. Dafür gibt es `trEN()`: dieselbe Übersetzung wie `trs()`, nur ohne
die `LANG`-Abfrage. Neue Texte in diesem SVG deshalb über `trEN()` führen und keine
deutschen Wörter fest einsetzen — auch nicht in zusammengesetzten Strings wie
`'ab '+zeit`.

Der Observer hilft dort ohnehin nicht: `I18N_SKIP` enthält `SVG`, SVG-Texte laufen
grundsätzlich nicht durch die Anzeigeschicht.

## Was nicht übersetzt wird

**Tank / Air / Missile** bleiben auch auf Deutsch stehen — so heißen sie im Spiel, wie die
Gebäude im Schluchtsturm. Übersetzt sind nur „T1-Typ" und „– unbekannt".

## Sessions

- `docs/sessions/2026-08-02-cb9c54b3.md` — Sprachwahl beim Login
- `docs/sessions/2026-08-31-e65440b8.md` — halb deutsche Tooltips, vollständig übersetzt
- `docs/sessions/2026-09-02-bd644b96.md` — englische Entsprechungen für die Assassinen
