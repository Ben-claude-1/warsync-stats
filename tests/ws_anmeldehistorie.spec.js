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

test('Nachgetragen: Wert gekennzeichnet, aber die Woche ist nicht abgedeckt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  const woche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.events = [];
    window.APP.data.participation = [];
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum,
        wert: 'BC', quelle: 'nachtrag', stand_um: '2026-10-14T20:17:21+00:00' },
      // 'C' ohne Uhrzeit: der alte Wert aus der Zeit vor AC/BC. Er muss als
      // „ohne Platz" durchgehen, sonst sähe eine Woche von Anfang September
      // aus wie eine ohne Ausschlüsse.
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 02', mode: 'ws', event_date: datum,
        wert: 'C', quelle: 'nachtrag', stand_um: '2026-10-14T20:17:21+00:00' },
    ];
  }, [woche]);
  await oeffneHistorie(page);

  const zelle01 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 01' }) }).locator('td').nth(1);
  const zelle02 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 02' }) }).locator('td').nth(1);
  const zelle03 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 03' }) }).locator('td').nth(1);
  await expect(zelle01).toHaveText('BC');
  await expect(zelle02).toHaveText('C');
  // Der Nachtrag trägt seinen Zeitpunkt sichtbar — ein Stand von Mittwoch ist
  // nicht der Schlussstand vom Donnerstag 04:00.
  await expect(zelle01.locator('span').first()).toHaveAttribute('title', /Nachgetragen.*14\.10/);
  await expect(zelle01.locator('span').first()).toHaveCSS('border-bottom-style', 'dotted');
  // **Der Kern der Sache:** Testspieler 03 fehlt im Nachtrag, und das heißt
  // NICHT „nicht angemeldet" — ein Beleg kennt niemanden, der sich danach noch
  // gemeldet hat (Ben_the_men am 09.10.2026). Also „?" statt „–".
  await expect(zelle03).toHaveText('?');
  await expect(zelle03.locator('span')).toHaveAttribute('title', /Nachtrag dieser Woche/);
  expect(errors.relevant).toEqual([]);
});

test('Der fixierte Kader schlägt das „leer" einer abgedeckten Woche', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  const woche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.events = [{ id: 'ev-a', event_date: datum, team: 'A', mode: 'ws' }];
    window.APP.data.participation = [
      { event_id: 'ev-a', player_name: 'Testspieler 02', registered: true, substitute: true },
    ];
    // Die Woche ist per Kader-Lock abgedeckt — aber für Testspieler 02 gibt es
    // dort keine Zeile, weil der Nachtrag für fixierte Wochen nur die C-Werte
    // schreibt. Seine Teilnahme-Zeile ist das härtere Wissen und muss gewinnen.
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, wert: 'AC', quelle: 'lock' },
    ];
  }, [woche]);
  await oeffneHistorie(page);

  const zelle02 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 02' }) }).locator('td').nth(1);
  const zelle03 = page.locator('tr', { has: page.locator('strong', { hasText: 'Testspieler 03' }) }).locator('td').nth(1);
  await expect(zelle02).toHaveText('AE');
  // Testspieler 03 hat weder Zeile noch Teilnahme — in einer per Lock
  // abgedeckten Woche heißt das wirklich „nicht angemeldet".
  await expect(zelle03).toHaveText('–');
});

test('📷 zeigt den Beleg mit Zeitpunkt und lädt das Bild nach', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  await page.route('**/rest/v1/ws_anmeldebeleg*', (route) => {
    if (route.request().url().includes('id=eq.42')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ bild: 'AAAA' }]) });
    }
    return route.continue();
  });
  const woche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, wert: 'A' },
    ];
    window.APP.data.anmeldebeleg = [
      { id: 42, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, quelle: 'suchlauf', wert: 'A', erkannt_um: '2026-10-07T11:47:03+00:00' },
    ];
  }, [woche]);
  await oeffneHistorie(page);

  const kamera = page.locator('span[title="1 Beweisbild"]');
  await expect(kamera).toBeVisible();
  await kamera.click();

  await expect(page.locator('#beleg-overlay')).toContainText('Beweisbild · Testspieler 01');
  await expect(page.locator('#beleg-overlay')).toContainText('Suchlauf');
  await expect(page.locator('#beleg-overlay img')).toHaveAttribute('src', 'data:image/png;base64,AAAA');

  await page.locator('#beleg-overlay button').click();
  await expect(page.locator('#beleg-overlay')).toHaveCount(0);
  expect(errors.relevant).toEqual([]);
});

test('Ohne Beleg erscheint keine Kamera', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  const woche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, wert: 'A' },
    ];
    window.APP.data.anmeldebeleg = [];
  }, [woche]);
  await oeffneHistorie(page);
  await expect(page.locator('span[title^="1 Beweisbild"]')).toHaveCount(0);
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

test('Auf Englisch ist auch das Beleg-Overlay übersetzt', async ({ page }) => {
  await isolateDb(page);
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(3) });
  await page.route('**/rest/v1/ws_anmeldebeleg*', (route) => {
    if (route.request().url().includes('id=eq.42')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ bild: null }]) });
    }
    return route.continue();
  });
  const woche = freitag(0);
  await page.evaluate(([datum]) => {
    window.APP.data.anmeldestand = [
      { alliance_id: window.APP.allianceId, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, wert: 'A' },
    ];
    window.APP.data.anmeldebeleg = [
      { id: 42, player_name: 'Testspieler 01', mode: 'ws', event_date: datum, quelle: 'suchlauf', wert: 'A', erkannt_um: '2026-10-07T11:47:03+00:00' },
    ];
  }, [woche]);
  await oeffneHistorie(page);

  const kamera = page.locator('span[title="1 evidence image"]');
  await expect(kamera).toBeVisible();
  await kamera.click();
  await expect(page.locator('#beleg-overlay')).toContainText('Evidence · Testspieler 01');
  await expect(page.locator('#beleg-overlay')).toContainText('Search run');
  // bild:null → das Laden ist fehlgeschlagen, auch das muss englisch stehen.
  await expect(page.locator('#beleg-overlay')).toContainText('Image could not be loaded.');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});
