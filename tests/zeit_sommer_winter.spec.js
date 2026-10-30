import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, fixturePlayers } from './helpers.js';

// Die Serverzeit ist fest UTC−2, die europäische springt mit der Sommerzeit.
// Bis zum 30.10.2026 stand der Abstand fest auf 4 Stunden, und nach der
// Umstellung zeigte das Aufstellungsbild „13:00 EU", obwohl das Event um 12:00
// begann. Gespeichert bleibt der Schlüssel ('13:00' = 09:00 Server), die
// europäische Zeit wird für den Freitag des Events gerechnet.

async function kartenLabel(page, jetzt) {
  await page.clock.setFixedTime(new Date(jetzt));
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await page.evaluate(() => { window.APP.wsTime = { A: '13:00', B: '22:00' }; window.showWSAufstellungKarte('A'); });
  const a = await page.locator('#karte-team-label').textContent();
  await page.locator('#karte-tab-B').click();
  const b = await page.locator('#karte-team-label').textContent();
  return { a, b };
}

test('Sommer: 13:00 EU · 09:00 Server', async ({ page }) => {
  const { a, b } = await kartenLabel(page, '2026-09-08T10:00:00Z');
  expect(a).toBe('Team A · 13:00 EU · 09:00 Server');
  expect(b).toBe('Team B · 22:00 EU · 18:00 Server');
});

test('Winter: 12:00 EU · 09:00 Server — die Serverzeit bleibt', async ({ page }) => {
  const { a, b } = await kartenLabel(page, '2026-10-30T10:00:00Z');
  expect(a).toBe('Team A · 12:00 EU · 09:00 Server');
  expect(b).toBe('Team B · 21:00 EU · 18:00 Server');
});

// Gerechnet wird für den Freitag des Events, nicht für heute: am Samstag vor
// der Umstellung (24.10.) gilt für den 30.10. schon die Winterzeit.
test('Vor der Umstellung zählt das Datum des Events', async ({ page }) => {
  const { a } = await kartenLabel(page, '2026-10-24T10:00:00Z');
  expect(a).toBe('Team A · 12:00 EU · 09:00 Server');
});

// „EU" heißt Europe/Berlin, auch auf einem Gerät in einer anderen Zeitzone.
test.describe('Gerät in New York', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('zeigt dieselbe EU-Zeit', async ({ page }) => {
    const { a } = await kartenLabel(page, '2026-10-30T10:00:00Z');
    expect(a).toBe('Team A · 12:00 EU · 09:00 Server');
  });
});
