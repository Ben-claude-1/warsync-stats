import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Wer kommt bei der Auto-Verteilung an welches Gebäude.
//
// Die Reihenfolge ist eine Stärke-Leiter mit vier Stufen: die Stärksten werden
// Assassinen, dann füllt sich der **Energieturm** (50/s), danach gleichmäßig die
// beiden Datenzentren (je 20/s), und **zuletzt** die Probenlager. Die bringen mit
// 15/s am wenigsten ein und werden nicht umkämpft — dort stehen die Schwächsten
// richtig, während vorne die Starken gebraucht werden.
//
// Zwei Fassungen davor: erst lief die Verteilung reihum über alle sieben
// Startgebäude (die Probenlager bekamen Spieler aus der Mitte des Feldes, die
// beiden Schwächsten standen am Energieturm), danach reihum über Energieturm und
// Datenzentren gemeinsam — der Energieturm bekam damit nur jeden dritten Spieler
// und stand mit denselben Leuten da wie ein halb so wertvolles Datenzentrum.

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

test('der Energieturm wird vor den Datenzentren voll besetzt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  // Ordnungshüter auf der ganzen Karte: 5 Assassinen, dann je 5 Plätze für
  // Energieturm und die beiden Datenzentren. Reihum über alle drei verteilt
  // bekäme der Energieturm die Ränge 6, 9, 12, 15 und 18 — hier müssen es 6 bis 10
  // sein, also die geschlossene Spitze hinter den Assassinen.
  const nach = await verteilen(page, { faction: 'ordnung', seite: 'ganz' });
  const turm = nach.kraftturm || [];
  const dz = [...(nach.dc_w || []), ...(nach.dc_o || [])];

  expect(turm.length, 'der Energieturm ist voll besetzt').toBe(5);
  expect(dz.length, 'beide Datenzentren sind besetzt').toBe(10);
  expect(turm.map(rang).sort((a, b) => a - b), `am Energieturm stehen ${turm.join(',')}`)
    .toEqual([6, 7, 8, 9, 10]);
  expect(Math.max(...turm.map(rang)), `${turm.join(',')} am Turm gegen ${dz.join(',')} in den DZ`)
    .toBeLessThan(Math.min(...dz.map(rang)));

  expect(errors.relevant).toEqual([]);
});

test('bei knappem Kader gibt der Energieturm den schwächsten Platz ab', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(11) });

  // 11 Angemeldete: 5 Assassinen, 6 übrig für drei Gebäude mit je 5 Plätzen. Der
  // volle Energieturm ließe das zweite Datenzentrum mit 0/s leer stehen — teurer
  // als der Platz, den er dafür abgibt. Abgegeben wird der **schwächste**: die
  // Spitze (Ränge 6–9) bleibt am Turm, die Ränge 10 und 11 decken die Lücken.
  const nach = await verteilen(page, { faction: 'ordnung', seite: 'ganz', anzahl: 11 });
  expect((nach.dc_w || []).length, 'Datenzentrum I besetzt').toBe(1);
  expect((nach.dc_o || []).length, 'Datenzentrum II besetzt').toBe(1);
  expect((nach.kraftturm || []).map(rang).sort((a, b) => a - b)).toEqual([6, 7, 8, 9]);
});

test('der Rest verteilt sich gleichmäßig auf die Datenzentren', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  const nach = await verteilen(page, { faction: 'ordnung', seite: 'ganz' });
  const w = (nach.dc_w || []).length, o = (nach.dc_o || []).length;
  expect(Math.abs(w - o), `Belegung ${w}/${o}`).toBeLessThanOrEqual(1);
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

// ── Gemischte T1-Typen ──────────────────────────────────────────────────────
// „try to have mix types — avoid only tanks" (Cocojamb, 14.09.2026). Getauscht
// wird nur **innerhalb einer Runde**, und die drei Gruppen — Energieturm,
// Datenzentren, Probenlager — werden getrennt gemischt. Sonst verschöbe der
// Tausch jemanden über die Stärke-Leiter hinweg, die dieser Test weiter oben
// absichert.
//
// Der Energieturm ist deshalb ausgenommen: er ist eine Gruppe aus **einem**
// Gebäude, dort steht die Spitze des Feldes und es gibt nichts zu tauschen. Ihn
// mitzuprüfen hieße, eine Zusicherung zu behaupten, die der Code nicht gibt —
// dass es hier trotzdem gemischt aussieht, ist die Folge der Testdaten.

// Dieselbe fallende Stärke, aber abwechselnd Air und Tank in Zweierblöcken:
// stur Index für Index verteilt bekäme so jedes Gebäude zwei gleiche Typen.
function spielerMitTypen(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `S${String(i + 1).padStart(2, '0')}`,
    role: 'R3', hero_power: (200 - i * 5) * 1_000_000, active: true, t1: 40 - i, level: 30,
    t1_type: i % 2 === 0 ? 'A' : 'T',
  }));
}

test('kein Gebäude bekommt nur einen Typ, wenn ein anderer verfügbar war', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spielerMitTypen(20) });
  // Ganze Karte: nur so sind beide Datenzentren dabei, und nur dann hat die
  // Gruppe „Datenzentren" überhaupt zwei Gebäude, zwischen denen getauscht
  // werden kann.
  const nach = await verteilen(page, { seite: 'ganz' });

  const typVon = {};
  spielerMitTypen(20).forEach((p) => { typVon[p.name] = p.t1_type; });
  const mehrfach = Object.entries(nach)
    .filter(([b, ns]) => !['ohne', 'viruslab', 'kraftturm'].includes(b) && ns.length > 1);
  expect(mehrfach.length).toBeGreaterThan(0);
  for (const [bld, namen] of mehrfach) {
    const typen = new Set(namen.map((n) => typVon[n]));
    expect(typen.size, `${bld} steht sortenrein: ${namen.map((n) => typVon[n]).join(' ')}`).toBeGreaterThan(1);
  }
});

test('der Tausch verschiebt niemanden über die Gruppengrenze', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spielerMitTypen(20) });
  const nach = await verteilen(page, { seite: 'ganz' });

  // Die drei Stufen bleiben getrennt, auch wenn der Typ-Tausch etwas anderes
  // nahelegen würde: Energieturm vor Datenzentrum vor Probenlager.
  const stufen = [
    nach.kraftturm || [],
    [...(nach.dc_w || []), ...(nach.dc_o || [])],
    Object.entries(nach).filter(([b]) => b.startsWith('lager')).flatMap(([, ns]) => ns),
  ];
  stufen.forEach((s) => expect(s.length).toBeGreaterThan(0));
  for (let i = 1; i < stufen.length; i++) {
    expect(Math.min(...stufen[i].map(rang)), `${stufen[i - 1].join(',')} vor ${stufen[i].join(',')}`)
      .toBeGreaterThan(Math.max(...stufen[i - 1].map(rang)));
  }
});
