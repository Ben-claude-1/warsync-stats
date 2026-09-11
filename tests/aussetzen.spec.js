import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers, ALLIANZ_A } from './helpers.js';

// Wer beim Wüstensturm gefehlt hat, setzt beim nächsten aus. Die Zeilen schreibt
// der Dienst (scripts/ws_service/eintragen.py); das Tool zeigt sie in der
// Anmeldung neben dem Namen und lässt sie aufheben.

// Derselbe Freitag, den die Anmeldung zeigt (getNextFriday in src/ui/ws.js).
async function naechsterFreitag(page, plusTage = 0) {
  return page.evaluate((plus) => {
    const now = new Date();
    const day = now.getDay();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day <= 5 ? 5 - day : 6) + plus);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, plusTage);
}

function zeile(name, eventDate) {
  return { alliance_id: ALLIANZ_A.id, player_name: name, mode: 'ws', event_date: eventDate,
           grund: 'Gefehlt beim Wüstensturm am 2026-09-11 (Team A)', quelle_event_id: null };
}

test('Die Marke steht nur beim Freitag, an dem jemand aussetzt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  const freitag = await naechsterFreitag(page);
  const spaeter = await naechsterFreitag(page, 7);
  await page.evaluate(([a, b]) => {
    window.APP.data.aussetzen = [a, b];
    window.nav('ws'); window.setWSView('anmeldung');
  }, [zeile('Testspieler 02', freitag), zeile('Testspieler 03', spaeter)]);

  // Genau einmal: Testspieler 03 setzt erst eine Woche später aus.
  const marke = page.locator('#pc span', { hasText: /^⛔ Aussetzen/ });
  await expect(marke).toHaveCount(1);
  // … und zwar in der Zeile dessen, der aussetzt.
  await expect(marke.locator('xpath=..')).toContainText('Testspieler 02');
  expect(errors.relevant).toEqual([]);
});

test('Aufheben löscht genau diese Zeile — für diese Allianz', async ({ page }) => {
  await isolateDb(page);
  const geloescht = [];
  await page.route('**/rest/v1/ws_aussetzen*', async (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') {
      geloescht.push(decodeURIComponent(new URL(req.url()).search));
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  page.on('dialog', (d) => d.accept());
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  const freitag = await naechsterFreitag(page);
  await page.evaluate((z) => {
    window.APP.data.aussetzen = [z];
    window.nav('ws'); window.setWSView('anmeldung');
  }, zeile('Testspieler 02', freitag));

  await page.locator('span[title="Aussetzen aufheben"]').click();
  await expect(page.locator('#pc')).not.toContainText('⛔ Aussetzen');
  expect(geloescht).toHaveLength(1);
  expect(geloescht[0]).toContain('player_name=eq.Testspieler 02');
  expect(geloescht[0]).toContain(`event_date=eq.${freitag}`);
  expect(geloescht[0]).toContain(`alliance_id=eq.${ALLIANZ_A.id}`);
});

test('Auf Englisch sind Marke, Tooltip und Rückfrage übersetzt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  // setLang() lädt die Seite neu — die Sprache muss deshalb vor dem Laden stehen.
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  const freitag = await naechsterFreitag(page);
  const frage = [];
  page.on('dialog', (d) => { frage.push(d.message()); d.dismiss(); });
  await page.evaluate((z) => {
    window.APP.data.aussetzen = [z];
    window.nav('ws'); window.setWSView('anmeldung');
  }, zeile('Testspieler 02', freitag));

  const marke = page.locator('#pc span', { hasText: /Sitting out/ }).first();
  await expect(marke).toBeVisible();
  await expect(marke).toHaveAttribute('title', 'Missed Desert Storm on 2026-09-11 (Team A) — sits out this time');
  await page.locator('span[title="Lift sit-out"]').click();
  expect(frage).toEqual(['Lift the sit-out for Testspieler 02? The player can then be scheduled again.']);
  expect(errors.relevant).toEqual([]);
});
