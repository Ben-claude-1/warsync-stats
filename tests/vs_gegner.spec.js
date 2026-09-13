import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, ALLIANZ_A } from './helpers.js';

// Der VS-Gegner unter „VS-Duell" → „🎯 <Kürzel>".
//
// Anders als die eigene Spielerliste unter „Basen" ist das hier **nicht** an
// den eigenen Server gebunden (`serverOf()`) — der Gegner steht praktisch nie
// auf demselben Server. `lwaAllianzSpieler` fragt deshalb Server und Allianz
// direkt ab, statt über den Mandanten zu gehen.
//
// Seit dem 13.09.2026 wird er ausgewählt statt im Quelltext nachgetragen. Zwei
// Dinge daran sind still, wenn sie brechen:
//
// * **Wer der Gegner ist, gehört der Allianz** (`ws_planner_state`, Schlüssel
//   `vs`) — sonst sähen zwei Mitglieder verschiedene Gegner.
// * **Stöbern verstellt ihn nicht.** Ein Blick auf eine andere Allianz darf
//   nichts schreiben; sonst änderte ein Neugieriger den Gegner für alle.

const GEGNER_SPIELER = [
  { player_uid: '9', name: 'ShieldBreaker', level: 34, allianz: 'cult', alliance_id: 'zz',
    rang: 3, x: 512, y: 233, power: 205000000, army_power: 6e7, army_kill: 12000000,
    last_active_at: new Date().toISOString(), gesehen_at: null },
];

const ALLIANZ_LISTE = [
  { server: '#1655', tag: 'cult', spieler: 100, mit_daten: 99, power: 21406851773, kills: 1168827379 },
  // Ohne geholte Mitgliederliste: nur von der Karte, deshalb ohne Kraft und Kills.
  { server: '#1655', tag: 'VI5A', spieler: 108, mit_daten: 0, power: null, kills: null },
  { server: '#1699', tag: 'SDWE', spieler: 90, mit_daten: 90, power: 1e10, kills: 5e8 },
];

// Muss NACH isolateDb() laufen — in Playwright gewinnt die zuletzt registrierte Route.
async function gegnerRouten(page) {
  const fragen = [];
  await page.route('**/rest/v1/lwa_spieler*', async (route) => {
    const url = new URL(route.request().url());
    fragen.push(url.searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEGNER_SPIELER) });
  });
  await page.route('**/rest/v1/lwa_allianz_liste*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALLIANZ_LISTE) }));
  return fragen;
}

// Der eingestellte Gegner der Allianz, wie ihn plannerPull aus der DB holt.
async function mitGegner(page, vs = { server: '#1655', tag: 'cult' }) {
  await page.evaluate((v) => { window.APP.planner.vs = v; }, vs);
}

async function oeffne(page) {
  await page.evaluate(() => { window.APP.vsView = 'gegner'; window.nav('vs'); });
  await expect(page.locator('#vs-gegner-body table')).toBeVisible();
}

test('fragt Server und Allianz des Gegners ab, nicht den eigenen Mandanten', async ({ page }) => {
  await isolateDb(page);
  const fragen = await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);
  expect(fragen.length).toBeGreaterThan(0);

  const letzte = fragen.at(-1);
  expect(letzte.get('server')).toBe('eq.#1655');
  expect(letzte.get('allianz')).toBe('eq.cult');
  // Der Gegner ist nicht der eigene Mandant — sonst liefe die Abfrage ins Leere,
  // ohne dass es auffiele.
  expect(letzte.get('server')).not.toBe('eq.' + ALLIANZ_A.server);
  // Kopfzeile und Reiter nennen denselben Gegner.
  await expect(page.locator('button', { hasText: '🎯' })).toHaveText('🎯 cult');
});

test('zeigt Spieler mit Koordinate', async ({ page }) => {
  await isolateDb(page);
  await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);
  const zeile = page.locator('#vs-gegner-body tbody tr').first();
  await expect(zeile).toContainText('ShieldBreaker');
  await expect(zeile).toContainText('512 / 233');
});

test('die Namensnennung steht auch hier', async ({ page }) => {
  await isolateDb(page);
  await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);
  const hinweis = page.locator('#vs-gegner-body').locator('..').locator('a[href="https://lwatlas.com"]');
  await expect(hinweis).toBeVisible();
});

test('erst der Server, dann die Allianz — beide Listen stehen zur Wahl', async ({ page }) => {
  await isolateDb(page);
  await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);

  const server = page.locator('select[aria-label="Server"]');
  const allianz = page.locator('select[aria-label="Allianz"]');
  await expect(server).toHaveValue('#1655');
  await expect(server.locator('option')).toHaveText(['#1655', '#1699']);
  // Nur die Allianzen des gewählten Servers, und ohne Mitgliederliste steht das dran.
  await expect(allianz.locator('option')).toHaveCount(2);
  await expect(allianz.locator('option').nth(1)).toContainText('ohne Kraft/Kills');
});

test('ein Blick auf eine andere Allianz schreibt nichts', async ({ page }) => {
  const writes = await isolateDb(page);
  const fragen = await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);

  await page.selectOption('select[aria-label="Allianz"]', 'VI5A');
  await expect.poll(() => fragen.at(-1).get('allianz')).toBe('eq.VI5A');

  // Der gemeinsame Stand bleibt, wie er war — und es wurde nichts geschrieben.
  expect(await page.evaluate(() => window.APP.planner.vs.tag)).toBe('cult');
  expect(writes.filter((w) => w.includes('ws_planner_state'))).toHaveLength(0);
  // Der Reiter zeigt, was man ansieht, und die Zeile darunter sagt, dass es nur
  // ein Blick ist.
  await expect(page.locator('button', { hasText: '🎯' })).toHaveText('🎯 VI5A');
  await expect(page.locator('#vs-gegner-body').locator('..')).toContainText('Nur angesehen');
});

test('„Als Gegner setzen" schreibt ihn für die ganze Allianz fort', async ({ page }) => {
  await isolateDb(page);
  await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await mitGegner(page);
  await oeffne(page);

  await page.selectOption('select[aria-label="Allianz"]', 'VI5A');
  const geschrieben = page.waitForRequest(
    (r) => r.url().includes('ws_planner_state') && r.method() === 'POST');
  await page.click('button:has-text("Als Gegner setzen")');
  const leib = JSON.parse((await geschrieben).postData());
  expect(leib.key).toBe('vs');
  expect(leib.data.tag).toBe('VI5A');
  expect(leib.data.server).toBe('#1655');

  // Danach ist es kein Blick mehr, sondern der Gegner.
  await expect(page.locator('#vs-gegner-body').locator('..')).not.toContainText('Nur angesehen');
});

test('wer nicht einteilen darf, kann den Gegner nicht setzen', async ({ page }) => {
  await isolateDb(page);
  await gegnerRouten(page);
  await page.goto('/index.html');
  await fakeLogin(page, { role: 'r3' });
  await mitGegner(page);
  await oeffne(page);

  await page.selectOption('select[aria-label="Allianz"]', 'VI5A');
  await expect(page.locator('button:has-text("Als Gegner setzen")')).toHaveCount(0);
  // Ansehen darf er trotzdem — die Auswahl selbst bleibt bedienbar.
  await expect(page.locator('select[aria-label="Allianz"]')).toHaveValue('VI5A');
});
