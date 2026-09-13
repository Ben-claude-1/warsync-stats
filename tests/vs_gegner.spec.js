import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin } from './helpers.js';

// Der aktuelle VS-Gegner unter „VS-Duell" → „🎯 SDWE".
//
// Anders als die eigene Spielerliste unter „Basen" ist das hier **nicht** an
// den eigenen Server gebunden (`serverOf()`) — der Gegner steht praktisch nie
// auf demselben Server. `lwaAllianzSpieler` fragt deshalb Server und Allianz
// direkt ab, statt über den Mandanten zu gehen.

const GEGNER_SPIELER = [
  { player_uid: '9', name: 'ShieldBreaker', level: 34, allianz: 'SDWE', alliance_id: 'zz',
    rang: 3, x: 512, y: 233, power: 205000000, army_power: 6e7, army_kill: 12000000,
    last_active_at: new Date().toISOString(), gesehen_at: null },
];

async function gegnerRoute(page) {
  const fragen = [];
  await page.route('**/rest/v1/lwa_spieler*', async (route) => {
    const url = new URL(route.request().url());
    fragen.push(url.searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEGNER_SPIELER) });
  });
  return fragen;
}

async function oeffne(page) {
  await page.evaluate(() => window.nav('vs'));
  await page.locator('button', { hasText: 'SDWE' }).click();
  await expect(page.locator('#vs-gegner-body table')).toBeVisible();
}

test('fragt Server und Allianz des Gegners ab, nicht den eigenen Mandanten', async ({ page }) => {
  await isolateDb(page);
  const fragen = await gegnerRoute(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  expect(fragen.length).toBeGreaterThan(0);
  const letzte = fragen.at(-1);
  expect(letzte.get('server')).toBe('eq.#1699');
  expect(letzte.get('allianz')).toBe('eq.SDWE');
});

test('zeigt Spieler mit Koordinate', async ({ page }) => {
  await isolateDb(page);
  await gegnerRoute(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  const zeile = page.locator('#vs-gegner-body tbody tr').first();
  await expect(zeile).toContainText('ShieldBreaker');
  await expect(zeile).toContainText('512 / 233');
});

test('die Namensnennung steht auch hier', async ({ page }) => {
  await isolateDb(page);
  await gegnerRoute(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  const hinweis = page.locator('#vs-gegner-body').locator('..').locator('a[href="https://lwatlas.com"]');
  await expect(hinweis).toBeVisible();
});
