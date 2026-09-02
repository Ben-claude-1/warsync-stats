import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Beide Anmeldungen zeigen dieselbe Zeile: sortiert nach der Gesamtkraft der
// Helden, mit T1 daneben. Der Rang stand früher vor der Stärke und schob die
// R5/R4 nach oben — beim Einteilen zählt aber, was jemand mitbringt.

// Rang und Stärke laufen hier bewusst auseinander: mit einer Liste, in der beide
// dasselbe sagen, wäre die Sortierung nicht prüfbar.
const SPIELER = [
  { name: 'Rang hoch', role: 'R5', hero_power: 100_000_000, active: true, t1: 21, level: 30 },
  { name: 'Kraft mittel', role: 'R3', hero_power: 150_000_000, active: true, t1: 33, level: 30 },
  { name: 'Kraft hoch', role: 'R3', hero_power: 200_000_000, active: true, t1: 48, level: 30 },
];

// Die Namen in der Reihenfolge, in der die Liste sie zeigt.
const namen = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#pc [onclick^="openPlayer"]')].map((e) => e.textContent.trim()));

test('Der Wüstensturm sortiert nach Heldenkraft, nicht nach Rang', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await page.evaluate(() => { window.nav('ws'); window.setWSView('anmeldung'); });

  expect(await namen(page)).toEqual(['Kraft hoch', 'Kraft mittel', 'Rang hoch']);
  expect(errors.relevant).toEqual([]);
});

test('Der Schluchtsturm sortiert genauso', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await page.evaluate(() => { window.nav('cs'); window.csSetView('anmeldung'); });

  expect(await namen(page)).toEqual(['Kraft hoch', 'Kraft mittel', 'Rang hoch']);
});

for (const [event, oeffnen] of [
  ['Wüstensturm', () => { window.nav('ws'); window.setWSView('anmeldung'); }],
  ['Schluchtsturm', () => { window.nav('cs'); window.csSetView('anmeldung'); }],
]) {
  test(`${event}: Heldenkraft und T1 stehen nebeneinander`, async ({ page }) => {
    await isolateDb(page);
    await page.goto('/index.html');
    await fakeLogin(page, { players: SPIELER });
    await page.evaluate(oeffnen);

    // Die eine Zahl sagt nichts über die andere — deshalb beide, in derselben Zeile.
    const liste = page.locator('#pc');
    await expect(liste).toContainText('200,0 Mio');
    await expect(liste).toContainText('T1 48');
    await expect(liste).toContainText('100,0 Mio');
    await expect(liste).toContainText('T1 21');
  });

  test(`${event}: fünf Knöpfe je Zeile, ein zweiter Klick meldet ab`, async ({ page }) => {
    await isolateDb(page);
    await page.goto('/index.html');
    await fakeLogin(page, { players: SPIELER });
    await page.evaluate(oeffnen);

    const knoepfe = () => page.locator('#pc button[onclick*="Kraft hoch"]');
    await expect(knoepfe()).toHaveText(['A', 'AE', 'B', 'BE', 'C']);

    const wert = () => page.evaluate(() =>
      (window.APP.page === 'cs' ? window.APP.csTeamAssign : window.APP.teamAssign)['Kraft hoch']);
    await knoepfe().nth(0).click();
    expect(await wert()).toBe('A');
    // Derselbe Knopf noch einmal meldet ab — dieselbe Regel in beiden Events.
    await knoepfe().nth(0).click();
    expect(await wert()).toBeFalsy();
  });
}

test('Beide Anmeldungen rendern dieselbe Zeile', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });

  // Verglichen wird das Gerüst, nicht der Inhalt: Team-Farben, Grenzen und der
  // Handler hinter den Knöpfen dürfen sich unterscheiden, der Aufbau nicht.
  const geruest = async (oeffnen) => {
    await page.evaluate(oeffnen);
    return page.evaluate(() => {
      const el = [...document.querySelectorAll('#pc [onclick^="openPlayer"]')]
        .find((e) => e.textContent.trim() === 'Kraft hoch').closest('div[style*="display:flex"]');
      return el.innerText;
    });
  };
  const ws = await geruest(() => { window.nav('ws'); window.setWSView('anmeldung'); });
  const cs = await geruest(() => { window.nav('cs'); window.csSetView('anmeldung'); });
  expect(ws).toBe(cs);
});
