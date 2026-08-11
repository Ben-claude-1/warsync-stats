import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Ersatzspieler im Schluchtsturm (20 gesetzt + 10 Ersatz, beide in der Aufstellung)
// und die wählbaren Startzeiten beider Events.

// Einteilung direkt in den Zustand schreiben. Über die Knöpfe wären das 30 Klicks
// pro Team, und jeder davon löst ein Rendern samt Speichern aus.
async function einteilen(page, { ws = {}, cs = {} } = {}) {
  await page.evaluate(({ ws, cs }) => {
    window.APP.teamAssign = ws;
    window.APP.csTeamAssign = cs;
  }, { ws, cs });
}

function namen(n, von = 0) {
  return Array.from({ length: n }, (_, i) => `Testspieler ${String(von + i + 1).padStart(2, '0')}`);
}

// Gleiche Rechnung wie getNextFriday() in der App — der Test darf nicht davon
// abhängen, an welchem Wochentag er läuft.
function naechsterFreitag() {
  const now = new Date();
  const add = now.getDay() <= 5 ? 5 - now.getDay() : 6;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Schluchtsturm nimmt 20 gesetzte und 10 Ersatzspieler je Team', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(60) });

  const grenzen = await page.evaluate(() => {
    const setz = (name, slot) => window.csSetTeamAssign(name, slot);
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    for (let i = 1; i <= 20; i++) setz(nm(i), 'A');
    for (let i = 21; i <= 30; i++) setz(nm(i), 'AE');
    // Beide Gruppen sind jetzt voll — der 21. gesetzte und der 11. Ersatz prallen ab.
    window.alert = () => {};
    setz(nm(31), 'A');
    setz(nm(32), 'AE');
    const v = window.APP.csTeamAssign;
    return {
      gesetzt: Object.values(v).filter((x) => x === 'A').length,
      ersatz: Object.values(v).filter((x) => x === 'AE').length,
      abgewiesen: [v[nm(31)], v[nm(32)]],
    };
  });
  expect(grenzen.gesetzt).toBe(20);
  expect(grenzen.ersatz).toBe(10);
  expect(grenzen.abgewiesen).toEqual([undefined, undefined]);
  expect(errors.relevant).toEqual([]);
});

test('Ersatzspieler stehen im Aufstellungs-Pool, aber hinter den Gesetzten', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  // Der Ersatzspieler ist hier der STÄRKSTE des Teams (Nummer 01). Trotzdem darf er
  // beim Auto-Verteilen keinem gesetzten Spieler die Assassinen-Rolle wegnehmen.
  const zuteilung = {};
  zuteilung[namen(1)[0]] = 'AE';
  namen(20, 1).forEach((n) => { zuteilung[n] = 'A'; });
  await einteilen(page, { cs: zuteilung, ws: zuteilung });

  const cs = await page.evaluate(() => {
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const plan = window.APP.csPlanA || {};
    return {
      imPool: !!plan['Testspieler 01'],
      assassinen: Object.entries(plan).filter(([, p]) => p && !p.s && p.d === 'viruslab').map(([n]) => n),
    };
  });
  // Im Pool ja — als Assassine nein.
  expect(cs.imPool).toBe(true);
  expect(cs.assassinen).not.toContain('Testspieler 01');
  expect(cs.assassinen.length).toBeGreaterThan(0);

  const ws = await page.evaluate(() => {
    window.APP.team = 'A';
    window.autoAssign();
    const L = window.APP.lineupA;
    const alle = Object.values(L).flat();
    return { imPool: alle.includes('Testspieler 01'), silo: L.ass };
  });
  expect(ws.imPool).toBe(true);
  expect(ws.silo).not.toContain('Testspieler 01');
});

test('Wüstensturm-Zeit ist wählbar und steht mit Serverzeit in der Aufstellung', async ({ page }) => {
  const writes = await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await einteilen(page, { ws: Object.fromEntries(namen(6).map((n) => [n, 'A'])) });
  // Das Event des kommenden Freitags liegt sonst nicht vor — ohne es gäbe es
  // nichts, woran die geänderte Zeit geschrieben werden könnte.
  await page.evaluate((friday) => {
    window.APP.data.events = [
      { id: 'ev-a', event_date: friday, team: 'A', time_slot: '13:00', result: 'pending' },
      { id: 'ev-b', event_date: friday, team: 'B', time_slot: '22:00', result: 'pending' },
    ];
  }, naechsterFreitag());

  await page.evaluate(() => { window.APP.team = 'A'; window.nav('ws'); window.setWSView('aufstellung'); });
  // Vorgabe: Team A 13:00 EU = 09:00 Serverzeit.
  await expect(page.locator('#pc')).toContainText('Team A · 13:00 EU · 09:00 Server');

  await page.evaluate(() => window.setWsZeit('A', '03:00'));
  await expect(page.locator('#pc')).toContainText('Team A · 03:00 EU · 23:00 Server');
  // Team B bleibt unberührt — die Zeiten hängen am Team, nicht am Event.
  await expect(page.locator('#pc')).toContainText('⚔ Team B · 22:00');

  // Die neue Zeit gehört ans Event in der Datenbank, nicht nur in die Anzeige.
  await expect
    .poll(() => writes.filter((w) => w.startsWith('PATCH /rest/v1/ws_events')).length)
    .toBeGreaterThan(0);

  // Auch die Mail, die im Spiel gepostet wird, führt beide Zeiten.
  await page.evaluate(() => window.setWSView('mail'));
  await expect(page.locator('#pc')).toContainText('03:00 EU · 23:00 Server');
});

test('Schluchtsturm: Team A und B lassen sich getrennt auf 16:00 oder 03:00 legen', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await einteilen(page, { cs: Object.fromEntries(namen(6).map((n) => [n, 'A'])) });

  await page.evaluate(() => { window.APP.csTeam = 'A'; window.nav('cs'); window.csSetView('aufstellung'); });
  await expect(page.locator('#pc')).toContainText('Team A · 16:00 EU · 12:00 Server');

  await page.evaluate(() => window.csSetZeit('B', '03:00'));
  await page.evaluate(() => window.csSetView('anmeldung'));
  await expect(page.locator('#pc')).toContainText('Team A · 16:00 EU · 12:00 Server');
  await expect(page.locator('#pc')).toContainText('Team B · 03:00 EU · 23:00 Server');

  // Das Übersichtsbild ist das, was in der Allianz landet — dort muss beides stehen.
  const svg = await page.evaluate(() => window.APP.csTeam && document.body && (() => {
    window.showCSMap();
    const s = document.querySelector('#csmap-body svg').outerHTML;
    document.getElementById('csmap').remove();
    return s;
  })());
  expect(svg).toContain('16:00 EU · 12:00 Server');
  expect(errors.relevant).toEqual([]);
});

test('Ersatzspieler sind im Übersichtsbild als solche erkennbar', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  // 15 gesetzte Spieler lassen in den Gebäude-Slots noch Platz — sonst bekäme der
  // Ersatzspieler gar kein Gebäude und stünde folgerichtig nicht auf der Karte.
  const zuteilung = {};
  namen(15).forEach((n) => { zuteilung[n] = 'A'; });
  zuteilung['Testspieler 21'] = 'AE';
  await einteilen(page, { cs: zuteilung });

  const svg = await page.evaluate(() => {
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    window.showCSMap();
    const s = document.querySelector('#csmap-body svg').outerHTML;
    document.getElementById('csmap').remove();
    return s;
  });
  // Das Bild ist immer englisch — im Spiel heißen die Gebäude so.
  expect(svg).toContain('* substitute');
  expect(svg).toMatch(/Testspieler 21 \*/);
});

test('Anmeldung und Zeitwahl laufen am Handy nicht über', async ({ page }) => {
  await isolateDb(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await einteilen(page, { cs: { 'Testspieler 01': 'A', 'Testspieler 02': 'AE' } });

  for (const [seite, ansicht] of [['cs', 'anmeldung'], ['cs', 'aufstellung']]) {
    await page.evaluate(([s, v]) => { window.nav(s); window.APP.csView = v; window.renderPage(); }, [seite, ansicht]);
    const ueber = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ueber, `${seite}/${ansicht} läuft ${ueber}px über`).toBeLessThanOrEqual(0);
  }
  await page.evaluate(() => { window.nav('ws'); window.setWSView('aufstellung'); });
  const ueberWs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ueberWs).toBeLessThanOrEqual(0);
});

test('Einteilung aus dem Wüstensturm nimmt die Ersatzbank mit', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await einteilen(page, { ws: { 'Testspieler 01': 'A', 'Testspieler 02': 'AE', 'Testspieler 03': 'BE' } });

  const cs = await page.evaluate(() => {
    window.confirm = () => true;
    window.csImportFromWS('kopieren');
    return window.APP.csTeamAssign;
  });
  // Früher wurde 'AE' auf 'A' zurückgebogen — dann stand ein Ersatzspieler als gesetzt da.
  expect(cs).toEqual({ 'Testspieler 01': 'A', 'Testspieler 02': 'AE', 'Testspieler 03': 'BE' });
});
