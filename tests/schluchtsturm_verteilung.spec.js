import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Wer kommt bei der Auto-Verteilung an welches Gebäude.
//
// Die Reihenfolge ist eine Stärke-Leiter: die Stärksten werden Assassinen, dann
// füllen sich Energieturm und Datenzentren, und **zuletzt** die Probenlager. Die
// bringen mit 15/s am wenigsten ein und werden nicht umkämpft — dort stehen die
// Schwächsten richtig, während vorne die Starken gebraucht werden.
//
// Vorher lief die Verteilung reihum über alle sieben Startgebäude: die Probenlager
// bekamen Spieler aus der Mitte des Feldes, und die beiden Schwächsten standen am
// Energieturm und am Datenzentrum.

// Deutlich fallende Heldenkraft: S01 ist der stärkste, S20 der schwächste.
function spieler(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `S${String(i + 1).padStart(2, '0')}`,
    role: 'R3', hero_power: (200 - i * 5) * 1_000_000, active: true, t1: 40 - i, level: 30,
  }));
}
const NAMEN = (n) => Array.from({ length: n }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
// Rang in der Stärke-Leiter: S01 → 1, S20 → 20. Kleiner heißt stärker.
const rang = (name) => Number(name.slice(1));

// Verteilt Team A und gibt zurück, wer wo steht.
async function verteilen(page, { faction = 'morgen', seite = 'links', anzahl = 20 } = {}) {
  return page.evaluate(({ faction, seite, namen }) => {
    namen.forEach((n) => { window.APP.csTeamAssign[n] = 'A'; });
    window.APP.csTeam = 'A';
    window.APP.csFaction = { A: faction, B: faction };
    window.APP.csSeite = { A: seite, B: seite };
    window.APP.csStrength = 'hero';
    window.APP.csView = 'aufstellung';
    window.nav('cs');
    window.csAutoAssign();
    const nach = {};
    // Das Startgebäude zählt: wer später wechselt, steht ab 0:00 trotzdem dort.
    Object.entries(window.APP.csPlanA).forEach(([n, p]) => {
      const b = p.s || p.d || 'ohne';
      (nach[b] = nach[b] || []).push(n);
    });
    return nach;
  }, { faction, seite, namen: NAMEN(anzahl) });
}

test('die Schwächsten stehen in den Probenlagern, die Stärksten im Labor', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  const nach = await verteilen(page);
  const lager = Object.entries(nach).filter(([b]) => b.startsWith('lager')).flatMap(([, ns]) => ns);
  const vorne = Object.entries(nach)
    .filter(([b]) => b === 'kraftturm' || b.startsWith('dc_'))
    .flatMap(([, ns]) => ns);

  expect(lager.length, 'die Probenlager sind besetzt').toBeGreaterThan(0);
  expect(vorne.length, 'Energieturm und Datenzentren sind besetzt').toBeGreaterThan(0);

  // Kein Spieler an einem wichtigen Gebäude darf schwächer sein als der stärkste
  // im Probenlager — sonst stünden sie in der falschen Reihenfolge.
  const staerkstesLager = Math.min(...lager.map(rang));
  const schwaechstesVorne = Math.max(...vorne.map(rang));
  expect(schwaechstesVorne, `${vorne.join(',')} vorne gegen ${lager.join(',')} im Lager`)
    .toBeLessThan(staerkstesLager);

  // Und die Assassinen sind die Stärksten von allen.
  const ass = nach.viruslab || [];
  expect(ass.length).toBeGreaterThan(0);
  expect(Math.max(...ass.map(rang))).toBeLessThan(Math.min(...vorne.map(rang)));

  expect(errors.relevant).toEqual([]);
});

test('reihum bleibt es innerhalb der Probenlager', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  const nach = await verteilen(page);
  const lager = Object.entries(nach).filter(([b]) => b.startsWith('lager')).map(([, ns]) => ns.length);

  // Kein Probenlager steht leer, solange ein anderes zwei Mann hat: die Verteilung
  // geht reihum, nur eben erst nachdem die wichtigen Gebäude versorgt sind.
  expect(Math.max(...lager) - Math.min(...lager), `Belegung ${lager.join('/')}`)
    .toBeLessThanOrEqual(1);
});

test('niemand fällt bei der Umstellung aus der Zuteilung', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  // Beide Fraktionen: Ordnungshüter belegen die ganze Karte (die Probenlager haben
  // dort 0 Plätze), Morgenbringer nur eine Hälfte.
  for (const [faction, seite] of [['ordnung', 'ganz'], ['morgen', 'links']]) {
    const nach = await verteilen(page, { faction, seite });
    const alle = Object.values(nach).flat();
    expect(alle.sort(), `${faction}/${seite}: alle 20 sind zugeteilt`).toEqual(NAMEN(20));
    expect(nach.ohne, `${faction}/${seite}: niemand ohne Gebäude`).toBeUndefined();
  }
});
