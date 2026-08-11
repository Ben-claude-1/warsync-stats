import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Verlauf der Gesamtkraft der Helden — eigenes Diagramm neben der Truppenstärke,
// und jede Eintragung legt einen Verlaufs-Eintrag mit Zeitstempel an.

// Synthetischer Verlauf: T1 waechst langsam, die Heldenkraft deutlich. Bewusst
// mit Luecken — nicht jeder Eintrag traegt beide Werte, genau wie in echt.
function verlauf(name) {
  return [
    { id: 'h1', player_name: name, recorded_at: '2026-05-01T10:00:00Z', t1: 20, t2: 18, hero_power: 150_000_000 },
    { id: 'h2', player_name: name, recorded_at: '2026-06-01T10:00:00Z', t1: 22, t2: 19 },
    { id: 'h3', player_name: name, recorded_at: '2026-07-01T10:00:00Z', t1: 24, t2: 20, hero_power: 162_000_000 },
    { id: 'h4', player_name: name, recorded_at: '2026-08-01T10:00:00Z', t1: 26, t2: 21, hero_power: 171_000_000 },
  ];
}

async function mitVerlauf(page, name = 'Testlauf') {
  await page.evaluate(({ n, h }) => { window.APP.playerHistory[n] = [...h].reverse(); }, { n: name, h: verlauf(name) });
}

test('Profil zeigt Truppen- und Helden-Verlauf getrennt', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Testlauf', role: 'R5', t1: 26, t2: 21, hero_power: 171_000_000, active: true }] });
  await mitVerlauf(page);
  await page.evaluate(() => window.nav('profil'));

  await expect(page.locator('#pc')).toContainText('Truppenstärke-Verlauf');
  await expect(page.locator('#pc')).toContainText('🦸 Helden-Verlauf');
  // Nur die drei Eintraege mit Heldenkraft zaehlen fuer diesen Verlauf.
  await expect(page.locator('#pc')).toContainText('3 Einträge');
  // Die Entwicklung als Zahl: 150 → 171 Mio.
  await expect(page.locator('#pc')).toContainText('+21 M');
  expect(errors.relevant).toEqual([]);
});

test('Helden-Verlauf zeichnet nur Punkte, die einen Wert tragen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Testlauf', role: 'R5', hero_power: 171_000_000, active: true }] });
  await mitVerlauf(page);

  await page.evaluate(() => window.nav('profil'));

  // Der Eintrag vom 01.06. hat keine Heldenkraft. Frueher zog eine solche Luecke
  // die Linie auf null herunter — jetzt gibt es dort schlicht keinen Punkt.
  const helden = await page.locator('#pc .card', { hasText: '🦸 Helden-Verlauf' }).locator('svg').first();
  const kreise = await helden.locator('circle').count();
  expect(kreise).toBe(3);
  const polyline = await helden.locator('polyline').first().getAttribute('points');
  expect(polyline.split(' ')).toHaveLength(3);

  // Die Achse startet beim Helden-Verlauf nicht bei 0 — sonst waere ein Plus von
  // 14 % eine waagerechte Linie.
  const achse = await helden.locator('text').first().textContent();
  expect(parseFloat(achse)).toBeGreaterThan(100);
});

test('Truppen-Verlauf bleibt bei Luecken auf seiner Linie', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Testlauf', role: 'R5', t1: 26, active: true }] });
  await page.evaluate(() => {
    window.APP.playerHistory['Testlauf'] = [
      { id: 'a', player_name: 'Testlauf', recorded_at: '2026-07-01T10:00:00Z', t1: 24, t4: 5 },
      { id: 'b', player_name: 'Testlauf', recorded_at: '2026-06-01T10:00:00Z', t1: 22 },
      { id: 'c', player_name: 'Testlauf', recorded_at: '2026-05-01T10:00:00Z', t1: 20, t4: 4 },
    ];
    window.nav('profil');
  });
  const svg = page.locator('#pc .card', { hasText: 'Truppenstärke-Verlauf' }).locator('svg').first();
  // T1 hat drei Punkte, T4 nur zwei — und T4 faellt zwischendurch nicht auf null.
  expect(await svg.locator('circle').count()).toBe(5);
  const linien = await svg.locator('polyline').evaluateAll((els) => els.map((e) => e.getAttribute('points').split(' ').length));
  expect(linien.sort()).toEqual([2, 3]);
});

// Laesst genau die beiden Schreibwege durch, die das Speichern braucht, und
// merkt sich, was gesendet wurde. isolateDb() weist sonst jeden Schreibzugriff ab
// — dann bricht saveStrength schon beim Spieler-PATCH ab und man testet nichts.
async function schreibwegeMitschneiden(page) {
  const gesendet = [];
  await page.route('**/rest/v1/ws_players*', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    gesendet.push({ tabelle: 'ws_players', method: req.method(), body: req.postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/rest/v1/ws_player_history*', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const body = req.postDataJSON();
    gesendet.push({ tabelle: 'ws_player_history', method: req.method(), body });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ ...(Array.isArray(body) ? body[0] : body), id: 'neu-1', recorded_at: '2026-08-11T20:00:00Z' }]),
    });
  });
  return gesendet;
}

test('Heldenkraft lässt sich im Profil eintragen und landet mit Zeitstempel im Verlauf', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  const gesendet = await schreibwegeMitschneiden(page);
  await fakeLogin(page, { players: [{ name: 'Testlauf', role: 'R5', t1: 26, hero_power: 171_000_000, active: true }] });
  await mitVerlauf(page);
  await page.evaluate(() => window.nav('profil'));

  // Das Feld steht im Profil, vorbelegt mit dem aktuellen Wert in Mio.
  await expect(page.locator('#manHP')).toHaveValue('171');
  await page.locator('#manHP').fill('178.5');
  await page.locator('#saveBtn').click();
  await expect.poll(() => gesendet.filter((g) => g.tabelle === 'ws_player_history').length).toBeGreaterThan(0);

  // Der Spieler bekommt den absoluten Wert, nicht die Mio-Zahl aus dem Feld.
  const patch = gesendet.find((g) => g.tabelle === 'ws_players' && g.method === 'PATCH');
  expect(patch.body.hero_power).toBe(178_500_000);

  // Und der neue Stand landet zusaetzlich als eigene Zeile in der Historie —
  // ueberschrieben wird nichts, geloescht auch nicht.
  const hist = gesendet.find((g) => g.tabelle === 'ws_player_history' && g.method === 'POST');
  expect(hist.body[0].hero_power).toBe(178_500_000);
  expect(hist.body[0].player_name).toBe('Testlauf');
  expect(gesendet.some((g) => g.method === 'DELETE')).toBe(false);

  // Der Zeitstempel kommt aus der Datenbank und steht danach im lokalen Verlauf.
  // Der Eintrag wird erst nach der Antwort in den lokalen Verlauf gehaengt.
  await expect.poll(() => page.evaluate(() => window.APP.playerHistory['Testlauf'].length)).toBe(5);
  const neuester = await page.evaluate(() => window.APP.playerHistory['Testlauf'][0]);
  expect(neuester.recorded_at).toBe('2026-08-11T20:00:00Z');
  expect(neuester.hero_power).toBe(178_500_000);
});

test('Heldenkraft allein genügt zum Speichern', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  const gesendet = await schreibwegeMitschneiden(page);
  await fakeLogin(page, { players: [{ name: 'Testlauf', role: 'R5', active: true }] });
  await page.evaluate(() => window.nav('profil'));

  const dialoge = [];
  page.on('dialog', async (d) => { dialoge.push(d.message()); await d.dismiss(); });
  await page.locator('#manHP').fill('167.2');
  await page.locator('#saveBtn').click();
  // Frueher verlangte das Formular T1 — die Heldenkraft steht im Spiel aber auf
  // einem anderen Bildschirm, und wer nur sie nachtraegt, soll durchkommen.
  await expect.poll(() => gesendet.filter((g) => g.tabelle === 'ws_player_history').length).toBeGreaterThan(0);
  expect(dialoge).toEqual([]);
});

test('Spieler-Overlay zeigt den Helden-Verlauf mit', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ name: 'Testspieler 01', role: 'R4', t1: 26, hero_power: 171_000_000, active: true }] });
  await page.evaluate(() => { window.APP.playerHistory['Testspieler 01'] = []; });
  await page.evaluate((h) => { window.APP.playerHistory['Testspieler 01'] = h.reverse(); },
    verlauf('Testspieler 01'));
  await page.evaluate(() => window.openPlayer('Testspieler 01'));
  await expect(page.locator('#overlay')).toContainText('🦸 Helden-Verlauf');
});
