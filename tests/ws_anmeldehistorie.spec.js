import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers, ALLIANZ_A } from './helpers.js';

// Reiter „📜 Historie": wie stand ein Spieler in den letzten Wochen —
// A/B/AE/BE/AC/BC/ABC oder leer. ws_participation kennt nur die 30 mit Platz;
// wer AC/BC/ABC war, bekommt dort nie eine Zeile. Der neue Snapshot
// (ws_anmeldestand, core/anmeldehistorie.js) schließt das, aber erst ab dem
// Tag, an dem er angelegt wurde — für ältere Wochen bleibt „AC/BC" von „gar
// nicht angemeldet" ununterscheidbar, und genau das muss die Anzeige ehrlich
// als „?" statt als „–" zeigen.

// Dieselbe Rechnung wie getNextFriday() in src/ui/ws.js bzw. anmLetzteFreitage()
// in src/core/anmeldehistorie.js.
function freitag(plusWochen = 0) {
  const now = new Date();
  const day = now.getDay();
  const add = day <= 5 ? 5 - day : 6;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add + plusWochen * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function oeffneHistorie(page) {
  await page.evaluate(() => { window.nav('ws'); window.setWSView('historie'); });
}

test('Reiter fehlt ohne ws-Recht', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { role: 'r3' });
  await page.evaluate(() => { window.nav('ws'); });
  await expect(page.locator('.stab', { hasText: 'Historie' })).toHaveCount(0);
});

test('Aus ws_participation rekonstruiert: A/AE, Unbekanntes als „?"', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  const woche = freitag(0); // die erste Spalte der Historie, ohne ws_anmeldestand-Zeile
  const evA = { id: 'ev-a', event_date: woche, team: 'A', mode: 'ws' };
  const evB = { id: 'ev-b', event_date: woche, team: 'B', mode: 'ws' };
  await page.evaluate(([evA, evB]) => {
    window.APP.data.events = [evA, evB];
    window.APP.data.participation = [
      { event_id: 'ev-a', player_name: 'Testspieler 01', registered: true, substitute: false },
      { event_id: 'ev-b', player_name: 'Testspieler 02', registered: true, substitute: true },
    ];
    window.APP.data.anmeldestand = [];
  }, [evA, evB]);
  await oeffneHistorie(page);

  const zeile01 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 01' }) });
  const zeile02 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 02' }) });
  const zeile03 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 03' }) });
  await expect(zeile01.locator('td').nth(1)).toHaveText('A');
  await expect(zeile02.locator('td').nth(1)).toHaveText('BE');
  // Testspieler 03 hat für diese Woche keine Teilnahme-Zeile und die Woche hat
  // auch keinen vollständigen Snapshot — das ist „unbekannt", kein „leer".
  await expect(zeile03.locator('td').nth(1)).toHaveText('?');
  expect(errors.relevant).toEqual([]);
});

test('Mit ws_anmeldestand: AC/BC sichtbar, Fehlendes wird „leer" statt „?"', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  const neueWoche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.events = [];
    window.APP.data.participation = [];
    // Nur EIN Spieler hat eine Zeile — das genügt, damit die ganze Woche als
    // erfasst gilt (core/anmeldehistorie.js: anmWocheGedeckt).
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, wert: 'AC' },
    ];
  }, [neueWoche]);
  await oeffneHistorie(page);

  const zeile01 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 01' }) });
  const zeile02 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 02' }) });
  await expect(zeile01).toContainText('AC');
  // Testspieler 02 fehlt in ws_anmeldestand, aber die Woche selbst ist erfasst
  // (Testspieler 01 hat eine Zeile) → echtes „nicht angemeldet", kein „?".
  await expect(zeile02.locator('td').nth(1)).toHaveText('–');
});

test('Auf Englisch sind Tab und Legende übersetzt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  // setLang() lädt die Seite neu — die Sprache muss deshalb vor dem Laden stehen.
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  await oeffneHistorie(page);

  await expect(page.locator('.stab', { hasText: 'History' })).toBeVisible();
  await expect(page.locator('.ch', { hasText: 'Sign-up history' })).toBeVisible();
  await expect(page.locator('.note', { hasText: 'Who stood where, and when' })).toBeVisible();
  expect(errors.relevant).toEqual([]);
});
