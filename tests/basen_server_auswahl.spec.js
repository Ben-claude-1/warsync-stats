import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, ALLIANZ_A } from './helpers.js';

// Oben auf der Seite „Basen" lässt sich ein anderer Server eintragen, um
// Spieler auf einem Server zu suchen, auf dem die eigene Allianz nicht steht
// (z. B. den eines VS-Gegners). Zwei Dinge stehen dabei auf dem Spiel:
//
// * **Jede Abfrage muss dem neuen Server folgen** — `karte_basen` und
//   `lwa_spieler`/`lwa_allianzen` sind server-, nicht allianzgetrennt, und der
//   Filter kommt aus `serverOf()`. Ein vergessener Reset der Caches zeigte
//   nach dem Wechsel weiter den alten Server.
// * **Zurücksetzen muss wieder auf den Server der eigenen Allianz führen.**

async function routen(page, server) {
  const basenFragen = [];
  const lwaFragen = [];
  await page.route('**/rest/v1/karte_basen*', async (route) => {
    const url = new URL(route.request().url());
    basenFragen.push(url.searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/lwa_spieler*', async (route) => {
    const url = new URL(route.request().url());
    lwaFragen.push(url.searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/lwa_allianzen*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  return { basenFragen, lwaFragen };
}

async function oeffneBasen(page) {
  await page.evaluate(() => window.nav('basen'));
  await expect(page.locator('#bs-server')).toBeVisible();
}

test('ein eingetragener Server läuft in Basen- wie LW-Atlas-Abfragen mit', async ({ page }) => {
  await isolateDb(page);
  const { basenFragen, lwaFragen } = await routen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  // Vor dem Wechsel läuft alles noch mit dem Server der eigenen Allianz.
  expect(basenFragen.at(-1).get('server')).toBe('eq.' + ALLIANZ_A.server);
  expect(lwaFragen.at(-1).get('server')).toBe('eq.' + ALLIANZ_A.server);

  // Die Karte mit dem neuen Server steht sofort (reines Rendern), die
  // Nachfrage bei karte_basen/lwa_spieler läuft erst danach über setTimeout —
  // deshalb hier auf die tatsächliche Anfrage warten statt auf den Rumpf.
  await page.fill('#bs-server', '#9999');
  const basenAnfrage = page.waitForRequest((r) => r.url().includes('karte_basen') && r.url().includes('9999'));
  const lwaAnfrage = page.waitForRequest((r) => r.url().includes('lwa_spieler') && r.url().includes('9999'));
  await page.click('button:has-text("Anzeigen")');
  await basenAnfrage;
  await lwaAnfrage;

  await expect(page.locator('.card', { hasText: 'Fremder Server' })).toBeVisible();
  expect(basenFragen.at(-1).get('server')).toBe('eq.#9999');
  expect(lwaFragen.at(-1).get('server')).toBe('eq.#9999');
});

test('Zurücksetzen führt wieder auf den Server der eigenen Allianz', async ({ page }) => {
  await isolateDb(page);
  const { basenFragen } = await routen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await page.fill('#bs-server', '#9999');
  const fremdeAnfrage = page.waitForRequest((r) => r.url().includes('karte_basen') && r.url().includes('9999'));
  await page.click('button:has-text("Anzeigen")');
  await fremdeAnfrage;
  await expect(page.locator('.card', { hasText: 'Fremder Server' })).toBeVisible();

  const eigeneAnfrage = page.waitForRequest((r) =>
    r.url().includes('karte_basen') && r.url().includes(encodeURIComponent(ALLIANZ_A.server)));
  await page.click('button:has-text("Eigener Server")');
  await eigeneAnfrage;

  await expect(page.locator('.card', { hasText: 'Fremder Server' })).toHaveCount(0);
  expect(basenFragen.at(-1).get('server')).toBe('eq.' + ALLIANZ_A.server);
  await expect(page.locator('#bs-server')).toHaveValue(ALLIANZ_A.server);
});

test('die Auswahl bleibt beim Neuaufruf der Seite stehen', async ({ page }) => {
  await isolateDb(page);
  await routen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneBasen(page);

  await page.fill('#bs-server', '#9999');
  await page.click('button:has-text("Anzeigen")');
  await expect(page.locator('.card', { hasText: 'Fremder Server' })).toBeVisible();

  await page.evaluate(() => window.nav('home'));
  await oeffneBasen(page);
  await expect(page.locator('.card', { hasText: 'Fremder Server' })).toBeVisible();
  await expect(page.locator('#bs-server')).toHaveValue('#9999');
});
