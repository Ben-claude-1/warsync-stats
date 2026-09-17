import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, fixturePlayers } from './helpers.js';

// Die VS-Tagespunkte unter „VS-Duell" → „📅 Tage".
//
// Die Wochensumme, die es bisher gab, beantwortet die Frage nicht: 43,2 Mio in
// der Woche können sechs ordentliche Tage sein oder zwei starke und vier leere.
// Weil jeder Duelltag eine eigene Aufgabe hat (Montag Radar, Mittwoch
// Technologie …), ist genau das der Unterschied — wer mittwochs nie liefert,
// hat ein Forschungsproblem und kein Fleißproblem.
//
// Drei Dinge stehen hier auf dem Spiel, und alle drei sind still, wenn sie
// brechen:
//
// * **Nicht gelesen ist nicht null.** Die Rangliste im Spiel endet bei 100
//   Zeilen. Wer an einem vollständig gelesenen Tag fehlt und die Liste war
//   nicht voll, hat belegt nichts geholt. War sie voll — oder wurde der Tag gar
//   nicht gelesen —, weiß niemand etwas über ihn, und dann darf die Tabelle
//   auch nichts behaupten.
// * **Der laufende Tag zählt nicht mit.** Wer heute um 10 Uhr 2 Mio hat, hat
//   das Tagesziel nicht verfehlt, er ist noch dabei. Ohne diese Ausnahme stünde
//   jeden Tag die halbe Allianz auf der Mängelliste.
// * **Gezählt wird je Wochentag.** Eine 3 in der Mittwochsspalte ist die
//   eigentliche Auskunft; die Gesamtzahl allein sagt nur, *dass* jemand hängt.

const SPIELER = fixturePlayers(4);
const [A, B, C, D] = SPIELER.map((p) => p.name);

const ZIEL = 7_200_000;

// Zwei volle Wochen, damit sich „je Wochentag" überhaupt zählen lässt: eine
// einzelne Woche hat von jedem Wochentag genau einen.
const W1 = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
const W2 = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];

// A schafft immer alles. B verfehlt **nur mittwochs**, und zwar in beiden
// Wochen — das ist der Fall, den der Reiter sichtbar machen soll. C verfehlt
// verteilt. D fehlt an einem Tag ganz (siehe unten).
function punkte(name, datum) {
  const mi = datum === W1[2] || datum === W2[2];
  if (name === A) return 9_000_000;
  if (name === B) return mi ? 3_000_000 : 8_000_000;
  if (name === C) return datum === W1[0] || datum === W2[4] ? 1_000_000 : 8_500_000;
  return 7_500_000;
}

const TAGE = [...W1, ...W2].flatMap((datum) =>
  [A, B, C, D]
    // D fehlt am 09.09. in der Liste — der Tag ist vollständig gelesen und die
    // Liste war nicht voll, also ist das eine belegte Null.
    .filter((name) => !(name === D && datum === W2[2]))
    .map((name) => ({ datum, player_name: name, pts: punkte(name, datum), rang: 1 })));

// Je Tag ein Lauf. Alle vollständig und mit weniger als 100 Zeilen — bis auf
// den 12.09.: dort war die Liste mit 100 Zeilen voll, über Fehlende sagt sie
// also nichts.
const LAEUFE = [...W1, ...W2].map((datum) => ({
  datum, gelesen: datum === W2[5] ? 100 : 4, vollstaendig: true, letzter_rang: 4,
}));

async function tageAnsicht(page, { tage = TAGE, laeufe = LAEUFE, sub = 'woche', woche = null } = {}) {
  await page.evaluate(({ tage, laeufe, sub, woche }) => {
    window.APP.data.vsTage = tage;
    window.APP.data.vsTageLauf = laeufe;
    window.APP.vsTagView = sub;
    if (woche) window.APP.vsTagWoche = woche;
    window.nav('vs');
    window.APP.vsView = 'tage';
    window.renderPage();
  }, { tage, laeufe, sub, woche });
  await expect(page.locator('table.vst')).toBeVisible();
}

// Die Zeile eines Spielers in der Tabelle.
function zeile(page, name) {
  return page.locator('table.vst tbody tr').filter({ hasText: name });
}

test.beforeEach(async ({ page }) => {
  await isolateDb(page);
  await page.goto('/');
  await fakeLogin(page, { players: SPIELER });
});

test('Woche: verfehlte Tage sind rot, erreichte nicht', async ({ page }) => {
  await tageAnsicht(page, { woche: '2026-09-07' });

  // B verfehlt am Mittwoch (3,0 Mio) und sonst nie.
  const bZellen = zeile(page, B).locator('td.vst-z');
  const roteB = await bZellen.evaluateAll((tds) =>
    tds.filter((td) => td.style.background.includes('220, 60, 60')).map((td) => td.textContent.trim()));
  expect(roteB).toEqual(['3,0 Mio']);

  // A verfehlt nichts.
  const roteA = await zeile(page, A).locator('td.vst-z').evaluateAll((tds) =>
    tds.filter((td) => td.style.background.includes('220, 60, 60')).length);
  expect(roteA).toBe(0);
});

test('Ein Fehlender ist eine belegte Null — aber nur bei nicht voller Liste', async ({ page }) => {
  await tageAnsicht(page, { woche: '2026-09-07' });

  // D fehlt am 09.09. (Mi). Der Tag ist vollständig gelesen, die Liste hatte
  // 4 von 100 Zeilen — er ist also nicht angetreten und steht mit 0 da.
  const dZellen = await zeile(page, D).locator('td.vst-z').allTextContents();
  expect(dZellen.slice(0, 6)).toEqual(['7,5 Mio', '7,5 Mio', '0', '7,5 Mio', '7,5 Mio', '7,5 Mio']);

  // Gegenprobe: war die Liste voll, darf dort keine Null stehen. Am 12.09. ist
  // sie es (100 Zeilen) — ein dort fehlender Spieler bekommt einen Strich.
  await tageAnsicht(page, {
    tage: TAGE.filter((z) => !(z.player_name === D && z.datum === '2026-09-12')),
    woche: '2026-09-07',
  });
  const nachher = await zeile(page, D).locator('td.vst-z').allTextContents();
  expect(nachher[5]).toBe('–');
});

test('Ein Tag ohne Lauf behauptet nichts', async ({ page }) => {
  await tageAnsicht(page, {
    tage: TAGE.filter((z) => z.datum !== '2026-09-10'),
    laeufe: LAEUFE.filter((l) => l.datum !== '2026-09-10'),
    woche: '2026-09-07',
  });
  // Donnerstag ist die vierte Spalte. Ohne Lauf steht dort für jeden ein
  // Strich — auch für die, die an allen anderen Tagen geliefert haben.
  for (const name of [A, B, C, D]) {
    const zellen = await zeile(page, name).locator('td.vst-z').allTextContents();
    expect(zellen[3]).toBe('–');
  }
  await expect(page.locator('.note')).toContainText('nichts gelesen');
});

test('Der laufende Tag zählt nicht als verfehlt', async ({ page }) => {
  // Heute nach Serverzeit — der Tag läuft noch, die Punkte sind zwangsläufig
  // unfertig. Sie werden angezeigt, dürfen aber nirgends als Verfehlung zählen.
  const heute = await page.evaluate(() => {
    const d = new Date(Date.now() - 4 * 3600000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await tageAnsicht(page, {
    tage: [{ datum: heute, player_name: A, pts: 500_000, rang: 1 }],
    laeufe: [{ datum: heute, gelesen: 4, vollstaendig: true, letzter_rang: 4 }],
  });

  // Die Zahl steht da …
  await expect(zeile(page, A)).toContainText('0,5 Mio');
  // … der Kopf sagt, dass der Tag noch läuft …
  await expect(page.locator('table.vst thead')).toContainText('läuft');
  // … und die Spalte „verfehlt" bleibt bei 0.
  const zellen = await zeile(page, A).locator('td.vst-z').allTextContents();
  expect(zellen[zellen.length - 1]).toBe('0');
});

test('Gesamt: gezählt wird je Wochentag', async ({ page }) => {
  await tageAnsicht(page, { sub: 'gesamt' });

  // B hat in beiden Wochen den Mittwoch verfehlt und sonst nichts: Mi 2/2,
  // alle anderen 0/2. Genau diese Verteilung ist der Sinn der Tabelle — die
  // Gesamtzahl 2 allein sagt nicht, dass es immer derselbe Wochentag war.
  const bZellen = await zeile(page, B).locator('td.vst-z').allTextContents();
  expect(bZellen.slice(0, 6).map((t) => t.replace(/\s/g, ''))).toEqual(
    ['0/2', '0/2', '2/2⚠', '0/2', '0/2', '0/2']);
  expect(bZellen[6].replace(/\s/g, '')).toBe('2/12');

  // C verfehlt zweimal, aber an zwei verschiedenen Wochentagen — dieselbe
  // Gesamtzahl wie B, eine ganz andere Aussage.
  const cZellen = await zeile(page, C).locator('td.vst-z').allTextContents();
  expect(cZellen.slice(0, 6).map((t) => t.replace(/\s/g, ''))).toEqual(
    ['1/2', '0/2', '0/2', '0/2', '1/2', '0/2']);

  // A verfehlt nie und steht deshalb unten, nicht oben.
  const namen = await page.locator('table.vst tbody tr td:first-child').allTextContents();
  expect(namen[namen.length - 1]).toContain(A);
});
