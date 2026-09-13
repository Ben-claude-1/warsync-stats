import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin } from './helpers.js';

// Koordinate im Spielerprofil-Overlay — nachgeschlagen bei LW Atlas, exakt nach
// Name und eigenem Server, ohne Fuzzy-Abgleich. Kommt erst nach dem Rendern an
// (eigene Anfrage), deshalb wird auf den Platzhalter `#ov-koord` gewartet statt
// sofort im Overlay-Text zu suchen.

async function lwaRoute(page, treffer) {
  const fragen = [];
  await page.route('**/rest/v1/lwa_spieler*', async (route) => {
    const url = new URL(route.request().url());
    fragen.push(url.searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(treffer) });
  });
  return fragen;
}

test('zeigt die Koordinate, wenn LW Atlas einen Treffer liefert', async ({ page }) => {
  await isolateDb(page);
  await lwaRoute(page, [{ x: 481, y: 554 }]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Ben the men', role: 'R5', active: true }] });
  await page.evaluate(() => window.openPlayer('Ben the men'));
  await expect(page.locator('#ov-koord')).toContainText('481 / 554');
  await expect(page.locator('#overlay')).toContainText('Koordinate');
});

test('zeigt nichts, wenn kein Treffer da ist', async ({ page }) => {
  await isolateDb(page);
  await lwaRoute(page, []);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Unbekannt42', role: 'R3', active: true }] });
  await page.evaluate(() => window.openPlayer('Unbekannt42'));
  await page.waitForTimeout(200);
  await expect(page.locator('#ov-koord')).toBeEmpty();
  await expect(page.locator('#overlay')).not.toContainText('Koordinate');
});

test('fragt exakt nach Name und dem eigenen Server, kein Muster', async ({ page }) => {
  await isolateDb(page);
  const fragen = await lwaRoute(page, [{ x: 1, y: 2 }]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Ben the men', role: 'R5', active: true }] });
  await page.evaluate(() => window.openPlayer('Ben the men'));
  await expect(page.locator('#ov-koord')).toContainText('1 / 2');
  const letzte = fragen.at(-1);
  expect(letzte.get('name')).toBe('ilike.Ben the men');
  expect(letzte.get('server')).toMatch(/^eq\.#/);
});
