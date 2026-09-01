import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers, ALLIANZ_A } from './helpers.js';

// Team C („angemeldet, aber kein Platz"), die Begrenzung auf 20 + 10 und die
// Prioliste, die daraus entsteht.

const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;

// Legt eine gefälschte ws_priority-Tabelle an, die auf GET antwortet und
// POST/PATCH mitschreibt. Muss NACH isolateDb() laufen — in Playwright gewinnt
// die zuletzt registrierte Route.
async function prioTabelle(page, zeilen = []) {
  const store = { rows: [...zeilen], writes: [] };
  await page.route('**/rest/v1/ws_priority*', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store.rows) });
    }
    const body = JSON.parse(req.postData() || '[]');
    store.writes.push({ url: new URL(req.url()).search, rows: body });
    body.forEach((r) => {
      const i = store.rows.findIndex((x) => x.player_name === r.player_name);
      if (i >= 0) store.rows[i] = { ...store.rows[i], ...r };
      else store.rows.push(r);
    });
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  return store;
}

function prioZeile(name, counter, cTotal = counter) {
  return { alliance_id: ALLIANZ_A.id, player_name: name, counter, c_total: cTotal, last_ws_date: null, last_cs_date: null };
}

test('Der C-Knopf steht in beiden Anmeldungen und meldet niemanden ab', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(10) });

  const werte = await page.evaluate(() => {
    window.setTeamAssign('Testspieler 01', 'C');
    window.csSetTeamAssign('Testspieler 02', 'C');
    return { ws: window.APP.teamAssign['Testspieler 01'], cs: window.APP.csTeamAssign['Testspieler 02'] };
  });
  expect(werte).toEqual({ ws: 'C', cs: 'C' });

  // Sichtbar in beiden Anmeldungen, mit eigener Gruppe in der Liste.
  await page.evaluate(() => { window.nav('ws'); window.setWSView('anmeldung'); });
  await expect(page.locator('#pc')).toContainText('Angemeldet, aber kein Platz (1)');
  await page.evaluate(() => { window.nav('cs'); window.csSetView('anmeldung'); });
  await expect(page.locator('#pc')).toContainText('Angemeldet, aber kein Platz (1)');
  expect(errors.relevant).toEqual([]);
});

test("'C' ist unbegrenzt — sonst gäbe es für die Übrigen keinen Platz", async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(60) });
  const zahl = await page.evaluate(() => {
    const n = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    for (let i = 1; i <= 40; i++) window.setTeamAssign(n(i), 'C');
    return Object.values(window.APP.teamAssign).filter((v) => v === 'C').length;
  });
  expect(zahl).toBe(40);
});

test("Ein 'C'-Spieler bekommt kein Gebäude und keinen Ersatzplatz", async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(20) });

  const g = await page.evaluate(() => {
    const n = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    // Der Stärkste steht auf 'C'. Die Markierung muss die Stärke schlagen —
    // sonst wäre eine bewusste Entscheidung nichts wert.
    window.csSetTeamAssign(n(1), 'C');
    for (let i = 2; i <= 12; i++) window.csSetTeamAssign(n(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    return { plan: Object.keys(window.APP.csPlanA || {}) };
  });
  expect(g.plan).toHaveLength(11);
  expect(g.plan).not.toContain('Testspieler 01');
});

test('Die Prioliste zeigt nur Zähler über 0, größter zuerst', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await prioTabelle(page, [
    prioZeile('Testspieler 03', 1),
    prioZeile('Testspieler 01', 4),
    prioZeile('Testspieler 05', 0),
    prioZeile('Testspieler 02', 2),
  ]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(10) });
  await page.evaluate(async () => {
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.nav('ws');
    window.setWSView('prio');
  });

  const tabelle = page.locator('.card', { hasText: 'Warteschlange' });
  await expect(tabelle).toContainText('3 Spieler · 7 offene Vormerkungen');
  // Testspieler 05 steht auf 0 und taucht gar nicht auf.
  await expect(tabelle).not.toContainText('Testspieler 05');
  const namen = await tabelle.locator('tbody tr td:nth-child(2) strong').allTextContents();
  expect(namen).toEqual(['Testspieler 01', 'Testspieler 02', 'Testspieler 03']);

  // Derselbe Reiter hängt im Schluchtsturm und zeigt dieselbe Liste.
  await page.evaluate(() => { window.nav('cs'); window.csSetView('prio'); });
  const csTabelle = page.locator('.card', { hasText: 'Warteschlange' });
  await expect(csTabelle).toContainText('3 Spieler · 7 offene Vormerkungen');
  expect(await csTabelle.locator('tbody tr td:nth-child(2) strong').allTextContents())
    .toEqual(['Testspieler 01', 'Testspieler 02', 'Testspieler 03']);
  expect(errors.relevant).toEqual([]);
});

test('Die Prio-Marke steht auch in der Anmeldung neben dem Namen', async ({ page }) => {
  await isolateDb(page);
  await prioTabelle(page, [prioZeile('Testspieler 02', 3)]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  await page.evaluate(async () => {
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.nav('ws');
    window.setWSView('anmeldung');
  });
  await expect(page.locator('#pc')).toContainText('⭐ Prio 3');
});

test('Der Stepper korrigiert den Zähler und geht nicht unter 0', async ({ page }) => {
  await isolateDb(page);
  const store = await prioTabelle(page, [prioZeile('Testspieler 01', 1)]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  await page.evaluate(async () => {
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.nav('ws');
    window.setWSView('prio');
  });
  await page.evaluate(async () => { await window.prioAdjust('Testspieler 01', -1); });
  // Auf 0 heruntergesetzt heißt: aus der Liste raus, aber die Zeile bleibt.
  expect(store.rows.find((r) => r.player_name === 'Testspieler 01').counter).toBe(0);
  await expect(page.locator('#pc')).toContainText('Niemand wartet');

  await page.evaluate(async () => { await window.prioAdjust('Testspieler 01', -1); });
  expect(store.rows.find((r) => r.player_name === 'Testspieler 01').counter).toBe(0);

  await page.evaluate(async () => { await window.prioAdjust('Testspieler 01', 1); });
  expect(store.rows.find((r) => r.player_name === 'Testspieler 01').counter).toBe(1);
  // Die Korrektur darf den Anmeldeschluss-Stempel nicht anfassen — sonst zählte
  // ein erneutes Schließen doch wieder doppelt. `c_total` ebenso wenig: die
  // Stepper rücken jemanden in der Warteschlange, sie schreiben nicht um, was war.
  expect(store.writes.every((w) => w.rows.every((r) =>
    !('last_ws_date' in r) && !('last_cs_date' in r) && !('c_total' in r)))).toBe(true);
  expect(store.rows.find((r) => r.player_name === 'Testspieler 01').c_total).toBe(1);
});

test('Der Anmeldeschluss schreibt die Prioliste fort: +1 auf C, -1 mit Platz', async ({ page }) => {
  await isolateDb(page);
  const store = await prioTabelle(page, [
    prioZeile('Testspieler 01', 2),   // hat jetzt einen Platz → 1
    prioZeile('Testspieler 34', 1),   // wieder kein Platz     → 2
  ]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  page.on('dialog', (d) => d.accept());

  await page.evaluate(async () => {
    const n = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.APP.teamAssign = {};
    for (let i = 1; i <= 20; i++) window.APP.teamAssign[n(i)] = 'A';
    for (let i = 21; i <= 30; i++) window.APP.teamAssign[n(i)] = 'AE';
    for (let i = 31; i <= 35; i++) window.APP.teamAssign[n(i)] = 'C';
    await window.wsCloseAnmeldung();
  });

  const stand = (name) => store.rows.find((r) => r.player_name === name);
  expect(stand('Testspieler 01').counter).toBe(1);   // eingeteilt → runter
  expect(stand('Testspieler 34').counter).toBe(2);   // wieder C   → hoch
  expect(stand('Testspieler 31').counter).toBe(1);   // erstmals C → neue Zeile
  // Wer eingeteilt wurde und ohnehin bei 0 stand, bekommt keine Zeile: sonst
  // stünde die halbe Allianz mit einer Null in der Tabelle.
  expect(stand('Testspieler 05')).toBeUndefined();
  // Zweites Schließen für denselben Freitag zählt nicht doppelt.
  const vorher = JSON.stringify(store.rows);
  await page.evaluate(async () => { await window.wsCloseAnmeldung(); });
  expect(JSON.stringify(store.rows)).toBe(vorher);
});

// Beide Anmeldeschlüsse zahlen auf denselben Zähler ein. Der Schluchtsturm-Weg
// braucht dafür ein Event in der Datenbank — deshalb hier ein Attrappen-
// ws_events, das die Sperre vergibt.
async function eventsAttrappe(page) {
  await page.route('**/rest/v1/ws_events*', (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET') {
      const team = /team=eq\.([AB])/.exec(url);
      const body = team ? [{ id: 'ev-cs-' + team[1], team: team[1], mode: 'cs', roster_locked_at: null }] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (req.method() === 'PATCH') {
      // Nicht leer = diese Sitzung hat die Sperre bekommen.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"ev-cs"}]' });
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/ws_participation*', (route) =>
    route.fulfill({ status: route.request().method() === 'GET' ? 200 : 201, contentType: 'application/json', body: '[]' }));
}

test('Ein Zähler für beide Events: zweimal C in einer Woche macht 2', async ({ page }) => {
  await isolateDb(page);
  const store = await prioTabelle(page);
  await eventsAttrappe(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  page.on('dialog', (d) => d.accept());

  await page.evaluate(async () => {
    const n = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.data.priority = [];
    // Testspieler 35 meldet sich für beide Events und geht beide Male leer aus.
    // Testspieler 01 bekommt in beiden einen Platz.
    window.APP.teamAssign = {};
    window.APP.csTeamAssign = {};
    for (let i = 1; i <= 20; i++) { window.APP.teamAssign[n(i)] = 'A'; window.APP.csTeamAssign[n(i)] = 'A'; }
    window.APP.teamAssign[n(35)] = 'C';
    window.APP.csTeamAssign[n(35)] = 'C';
    await window.wsCloseAnmeldung();
  });
  expect(store.rows.find((r) => r.player_name === 'Testspieler 35').counter).toBe(1);

  await page.evaluate(async () => { await window.csCloseAnmeldung(); });
  const zeile = store.rows.find((r) => r.player_name === 'Testspieler 35');
  expect(zeile.counter).toBe(2);
  // Eine Zeile, kein `mode` — und zwei getrennte Stempel, sonst hätte der
  // Schluchtsturm-Schluss den des Wüstensturms blockiert (beide können auf
  // denselben Tag fallen).
  expect(store.rows.filter((r) => r.player_name === 'Testspieler 35')).toHaveLength(1);
  expect(zeile.last_ws_date).toBeTruthy();
  expect(zeile.last_cs_date).toBeTruthy();
  expect(zeile.mode).toBeUndefined();
  // Wer in beiden einen Platz hatte, bleibt bei 0 und bekommt keine Zeile.
  expect(store.rows.find((r) => r.player_name === 'Testspieler 01')).toBeUndefined();
});

test('C gesamt zählt nur hoch — auch wenn der offene Zähler wieder fällt', async ({ page }) => {
  await isolateDb(page);
  const store = await prioTabelle(page, [prioZeile('Testspieler 34', 2, 6)]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  page.on('dialog', (d) => d.accept());

  // Testspieler 34 bekommt diese Woche einen Platz: der offene Zähler sinkt,
  // die Lebenszeit-Summe bleibt. Genau daran sieht man, wen es ständig trifft —
  // wer abwechselnd spielt und aussetzt, steht offen dauernd bei 0 oder 1.
  await page.evaluate(async () => {
    const n = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.APP.teamAssign = {};
    for (let i = 30; i <= 45; i++) window.APP.teamAssign[n(i)] = 'A';
    window.APP.teamAssign[n(1)] = 'C';
    await window.wsCloseAnmeldung();
  });
  const z34 = store.rows.find((r) => r.player_name === 'Testspieler 34');
  expect(z34.counter).toBe(1);
  expect(z34.c_total).toBe(6);
  // Wer neu auf C landet, startet bei 1 in beiden.
  const z01 = store.rows.find((r) => r.player_name === 'Testspieler 01');
  expect(z01.counter).toBe(1);
  expect(z01.c_total).toBe(1);
});

test('Die Bilanz zählt gesetzt und Ersatz je Event aus den Kaderzeilen', async ({ page }) => {
  await isolateDb(page);
  await prioTabelle(page, [prioZeile('Testspieler 03', 0, 4)]);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });

  await page.evaluate(async () => {
    window.APP.data.priority = await (await fetch('/rest/v1/ws_priority')).json();
    window.APP.data.events = [
      { id: 'w1', mode: 'ws', team: 'A', event_date: '2026-08-07' },
      { id: 'w2', mode: 'ws', team: 'B', event_date: '2026-08-14' },
      { id: 'c1', mode: 'cs', team: 'A', event_date: '2026-08-10' },
    ];
    window.APP.data.participation = [
      // Team A und Team B werden zusammengezählt — welches der beiden sagt über
      // die Belastung nichts aus und wechselt ohnehin wöchentlich.
      { event_id: 'w1', player_name: 'Testspieler 03', substitute: false, waitlisted: false },
      { event_id: 'w2', player_name: 'Testspieler 03', substitute: true, waitlisted: false },
      { event_id: 'c1', player_name: 'Testspieler 03', substitute: false, waitlisted: false },
      // Wartelisten-Zeilen sind kein Einsatz.
      { event_id: 'w1', player_name: 'Testspieler 04', substitute: false, waitlisted: true },
    ];
    window.nav('ws');
    window.setWSView('prio');
  });

  const karte = page.locator('.card', { hasText: 'Einsatz-Bilanz' });
  const zeile = karte.locator('tbody tr', { hasText: 'Testspieler 03' });
  await expect(zeile.locator('td').nth(1)).toHaveText('4');    // C gesamt
  await expect(zeile.locator('td').nth(2)).toHaveText('1 · 1'); // WS: gesetzt · Ersatz
  await expect(zeile.locator('td').nth(3)).toHaveText('1 · 0'); // CS
  // Nur Warteliste heißt kein Einsatz — Testspieler 04 steht auf Strichen.
  const zeile04 = karte.locator('tbody tr', { hasText: 'Testspieler 04' });
  await expect(zeile04.locator('td').nth(2)).toHaveText('–');

  // Dieselben Zahlen stehen im Spielerprofil und in der Anmeldung.
  await page.evaluate(() => window.openPlayer('Testspieler 03'));
  await expect(page.locator('#overlay')).toContainText('1 gesetzt · 1 Ersatz');
  await expect(page.locator('#overlay')).toContainText('Team C gesamt');
  await page.evaluate(() => { window.closeOverlay(); window.setWSView('anmeldung'); });
  await expect(page.locator('#pc')).toContainText('Bisher WS 1/1 · CS 1/0 · C 4');
});

test('Jede Anfrage an ws_priority trägt die Allianz', async ({ page }) => {
  await isolateDb(page);
  const store = await prioTabelle(page, [prioZeile('Testspieler 01', 1)]);
  const gesehen = [];
  page.on('request', (r) => { if (r.url().includes('ws_priority')) gesehen.push(r.url()); });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  await page.evaluate(async () => {
    window.APP.data.priority = [{ player_name: 'Testspieler 01', counter: 1 }];
    window.nav('ws'); window.setWSView('prio');
    await window.prioAdjust('Testspieler 01', 1);
  });
  expect(gesehen.length).toBeGreaterThan(0);
  // GET filtert über die URL, der Upsert stempelt die Spalte in den Datensatz.
  gesehen.filter((u) => !u.includes('on_conflict')).forEach((u) => expect(u).toContain('alliance_id=eq.'));
  store.writes.forEach((w) => w.rows.forEach((r) => expect(r.alliance_id).toBe(ALLIANZ_A.id)));
});
