import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin } from './helpers.js';

// Gemischte T1-Typen je Gebäude.
//
// „When making the teams for each building, try to have mix types — avoid only
// tanks." (Cocojamb im Allianz-Chat, 14.09.2026). Ein Gebäude, an dem nur Tanks
// stehen, fällt gegen den passenden Konter geschlossen um.
//
// **Die Stärke-Leiter bleibt unangetastet.** Getauscht wird nur innerhalb einer
// Runde der Slot-Folge — wer in derselben Runde steht, ist gleich eingestuft.
// Über Rundengrenzen hinweg zu tauschen hieße, einen Schwächeren auf ein
// wichtigeres Gebäude zu setzen; das ist eine andere Entscheidung.

// Sechs Spieler, nach Stärke: A, T, T, A, T, T — und drei Gebäude mit je zwei
// Plätzen. Stur Index für Index verteilt bekäme das erste Gebäude **beide**
// Air-Spieler und die beiden anderen je zwei Tanks: drei sortenreine Gebäude.
// Gemischt bleibt nur eins sortenrein, weil es nur zwei Air-Spieler gibt.
const SPIELER = [
  { name: 'Air Eins', hero_power: 200e6, t1: 50, t1_type: 'A', role: 'R4', active: true, level: 34 },
  { name: 'Tank Eins', hero_power: 190e6, t1: 50, t1_type: 'T', role: 'R3', active: true, level: 34 },
  { name: 'Tank Zwei', hero_power: 180e6, t1: 50, t1_type: 'T', role: 'R3', active: true, level: 34 },
  { name: 'Air Zwei', hero_power: 170e6, t1: 50, t1_type: 'A', role: 'R3', active: true, level: 34 },
  { name: 'Tank Drei', hero_power: 160e6, t1: 50, t1_type: 'T', role: 'R3', active: true, level: 34 },
  { name: 'Tank Vier', hero_power: 150e6, t1: 50, t1_type: 'T', role: 'R3', active: true, level: 34 },
];

// Drei Gebäude mit je zwei Plätzen, sonst nichts — Silo, Arsenal, Söldnerfabrik
// und Ölquellen auf 0, damit niemand als Assassine oder Springer herausfällt und
// alle sechs in Gebäuden landen.
const SLOTS = {
  silo: 0, arsenal: 0, soeldner: 0, oelquellen: 0,
  infozentrum: 2, oelraf1: 2, sciencehub: 2,
  oelraf2: 0, laz1: 0, laz2: 0, laz3: 0, laz4: 0,
};

async function verteilen(page) {
  return page.evaluate((slots) => {
    window.APP.bldSlotsA = { ...slots };
    window.APP.team = 'A';
    window.APP.teamAssign = {};
    window.APP.data.players.forEach((p) => { window.APP.teamAssign[p.name] = 'A'; });
    window.autoAssign();
    // Gebäude → Typen der dort stehenden Spieler
    const proGebaeude = {};
    Object.entries(window.APP.bldAssign).forEach(([name, bk]) => {
      const p = window.APP.data.players.find((x) => x.name === name);
      (proGebaeude[bk] = proGebaeude[bk] || []).push(p.t1_type);
    });
    return proGebaeude;
  }, SLOTS);
}

test('kein Gebäude bekommt beide Spieler desselben knappen Typs', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  const proGebaeude = await verteilen(page);

  const gebaeude = Object.values(proGebaeude);
  expect(gebaeude).toHaveLength(3);
  for (const typen of gebaeude) expect(typen).toHaveLength(2);

  // Air ist der knappe Typ: die beiden dürfen nicht zusammen an einem Gebäude
  // stehen — genau das täte die stumpfe Verteilung.
  expect(gebaeude.filter((t) => t[0] === 'A' && t[1] === 'A')).toHaveLength(0);
  // Zwei der drei Gebäude sind damit gemischt, das dritte bleibt Tank/Tank —
  // mehr geben zwei Air-Spieler nicht her.
  expect(gebaeude.filter((t) => new Set(t).size === 2)).toHaveLength(2);
});

test('die Stärksten bleiben auf den wichtigsten Gebäuden', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await verteilen(page);

  // Die erste Runde verteilt die drei Stärksten auf die drei Gebäude — jeder auf
  // ein eigenes. Getauscht wird erst in der zweiten Runde, und nur untereinander.
  const wo = await page.evaluate(() => ({ ...window.APP.bldAssign }));
  const ersteRunde = ['Air Eins', 'Tank Eins', 'Tank Zwei'].map((n) => wo[n]);
  expect(new Set(ersteRunde).size).toBe(3);
  const zweiteRunde = ['Air Zwei', 'Tank Drei', 'Tank Vier'].map((n) => wo[n]);
  expect(new Set(zweiteRunde).size).toBe(3);
});
