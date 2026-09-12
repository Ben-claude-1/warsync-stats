import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin } from './helpers.js';

// Spieler und Allianzen aus LW Atlas, unter „Basen".
//
// Drei Dinge stehen hier auf dem Spiel:
//
// * **Die Namensnennung.** „Powered by LW Atlas" mit Rückverweis ist Bedingung
//   für den API-Schlüssel — ohne sie kann er entzogen werden. Sie ist eine
//   unscheinbare Zeile am Seitenende und damit genau die Art Ding, die bei einem
//   Umbau verschwindet, ohne dass es jemandem auffällt.
// * **Der Server-Filter.** `lwa_spieler` ist wie `karte_basen` bewusst nicht
//   mandantengetrennt; die Wache in api.js greift also nicht, und ein
//   vergessener Filter zeigte die Spieler einer fremden Welt.
// * **Zahlen folgen der Sprache.** Fest verdrahtet stünde im englischen Tool ein
//   deutsches Komma — 249,1 Mio statt 249.1M.

const SPIELER = [
  { player_uid: '1', name: 'Treetz', level: 34, allianz: 'kiSS', alliance_id: 'aa',
    rang: 3, x: 522, y: 424, power: 249080062, army_power: 7e7, army_kill: 42133916,
    last_active_at: new Date().toISOString(), gesehen_at: null },
  { player_uid: '2', name: 'Ben the men', level: 33, allianz: 'XP33', alliance_id: 'bb',
    rang: 4, x: 481, y: 554, power: 205600000, army_power: 6e7, army_kill: 2500000,
    last_active_at: new Date().toISOString(), gesehen_at: null },
];

const ALLIANZEN = [
  { alliance_id: 'aa', tag: 'kiSS', mitglieder: 98, gemeldet: 98, power: 20775963244, kills: 557371574, gescannt_at: null },
  { alliance_id: 'bb', tag: 'XP33', mitglieder: 98, gemeldet: 98, power: 20974646065, kills: 433225770, gescannt_at: null },
];

// Muss NACH isolateDb() laufen — in Playwright gewinnt die zuletzt registrierte Route.
async function lwaTabellen(page) {
  const fragen = [];
  await page.route('**/rest/v1/lwa_spieler*', async (route) => {
    const url = new URL(route.request().url());
    fragen.push(url.searchParams);
    const aid = (url.searchParams.get('alliance_id') || '').replace(/^eq\./, '');
    const muster = (url.searchParams.get('name') || '').replace(/^ilike\./, '');
    let rows = SPIELER;
    if (aid) rows = rows.filter((s) => s.alliance_id === aid);
    if (muster) {
      const rx = new RegExp('^' + muster.replace(/%/g, '.*') + '$', 'i');
      rows = rows.filter((s) => rx.test(s.name));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/rest/v1/lwa_allianzen*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ALLIANZEN) }));
  return fragen;
}

async function oeffne(page) {
  await page.evaluate(() => window.nav('basen'));
  await expect(page.locator('#lw-q')).toBeVisible();
  await expect(page.locator('#lw-spieler tbody tr').first()).toBeVisible();
}

test('jede Abfrage trägt den Server — sonst stünde dort eine fremde Welt', async ({ page }) => {
  await isolateDb(page);
  const fragen = await lwaTabellen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  expect(fragen.length).toBeGreaterThan(0);
  for (const f of fragen) expect(f.get('server')).toMatch(/^eq\.#/);
});

test('zeigt Kraft und Kills, die Gefährlichsten zuerst', async ({ page }) => {
  await isolateDb(page);
  await lwaTabellen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  const erste = page.locator('#lw-spieler tbody tr').first();
  await expect(erste).toContainText('Treetz');
  await expect(erste).toContainText('42,1 Mio');
});

test('ein Klick auf eine Allianz zeigt nur deren Spieler', async ({ page }) => {
  await isolateDb(page);
  const fragen = await lwaTabellen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  await page.locator('#lw-allianzen tbody tr', { hasText: 'XP33' }).click();
  await expect(page.locator('#lw-spieler')).toContainText('Ben the men');
  await expect(page.locator('#lw-spieler')).not.toContainText('Treetz');
  // Welche Allianz gemeint ist, muss im Rumpf stehen: die Kopfzeile der Karte
  // wird beim Klick nicht neu gezeichnet und behauptete sonst weiter „alle".
  await expect(page.locator('#lw-spieler')).toContainText('XP33');
  expect(fragen.at(-1).get('alliance_id')).toBe('eq.bb');
});

test('die Namensnennung steht auf der Seite und verweist zurück', async ({ page }) => {
  await isolateDb(page);
  await lwaTabellen(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  const hinweis = page.locator('a[href="https://lwatlas.com"]');
  await expect(hinweis).toBeVisible();
  await expect(hinweis.locator('..')).toContainText('Powered by');
});

test('auf Englisch stehen die Zahlen englisch da', async ({ page }) => {
  await isolateDb(page);
  await lwaTabellen(page);
  // Sprache vor dem Laden setzen: der Umschalter lädt die Seite neu, das käme
  // dem fakeLogin dazwischen.
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffne(page);
  const erste = page.locator('#lw-spieler tbody tr').first();
  await expect(erste).toContainText('42.1M');
  await expect(erste).not.toContainText('Mio');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});
