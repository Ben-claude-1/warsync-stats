import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Automatische Fest/Rotation/Ersatz-Vergabe im Schluchtsturm (Anmeldung unbegrenzt,
// höchstens 20 Hauptplätze kommen ins Auto-Verteilen, Ersatz bleibt außen vor)
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

test('Anmeldung ist unbegrenzt, aber höchstens 20 Spieler kommen ins Auto-Verteilen', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(60) });

  const result = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    // 35 Anmeldungen — mehr als die 30 Plätze (20 Haupt + 10 Ersatz). Anmelden
    // selbst kennt kein Limit mehr, das übernimmt erst die Rotation.
    for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const plan = window.APP.csPlanA || {};
    return {
      angemeldet: Object.values(window.APP.csTeamAssign).filter((v) => v === 'A').length,
      imPlan: Object.keys(plan).length,
    };
  });
  expect(result.angemeldet).toBe(35);
  expect(result.imPlan).toBe(20); // nur fest + Rotation-Haupt bekommen eine Gebäudezuweisung
  expect(errors.relevant).toEqual([]);
});

test('Nur die 20 stärksten Angemeldeten kommen ins Auto-Verteilen, der Rest bleibt außen vor', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  // fixturePlayers() ist nach Heldenkraft absteigend sortiert (Testspieler 01 am
  // stärksten) — die Aufstellung sortiert standardmäßig aber nach T1, das im
  // Testfixture aufsteigend läuft. Explizit auf Heldenkraft stellen, sonst
  // würde die Rotation genau umgekehrt sortieren.
  // Ohne Teilnahme-Historie fällt die Rotation für frische Anmeldungen auf
  // dieselbe Reihenfolge zurück, die 20 Stärksten (fest + Rotation-Haupt)
  // landen im Plan.
  const result = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const plan = window.APP.csPlanA || {};
    return {
      staerkster: !!plan[nm(1)],
      schwaechsterImTop20: !!plan[nm(20)],
      ersterErsatz: !!plan[nm(21)],
      warteliste: !!plan[nm(31)],
    };
  });
  expect(result.staerkster).toBe(true);
  expect(result.schwaechsterImTop20).toBe(true);
  expect(result.ersterErsatz).toBe(false); // Ersatz bekommt keine Gebäudezuweisung mehr
  expect(result.warteliste).toBe(false);
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

test('Ersatzspieler stehen nicht im Übersichtsbild — nur die 20 Hauptplätze', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const svg = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    // Heldenkraft statt T1 — siehe Kommentar im vorherigen Test.
    window.APP.csStrength = 'hero';
    // 25 Anmeldungen — die 5 schwächsten (21-25) sind Ersatz und bekommen keine
    // Gebäudezuweisung, tauchen also im exportierten Bild nicht auf.
    for (let i = 1; i <= 25; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    window.showCSMap();
    const s = document.querySelector('#csmap-body svg').outerHTML;
    document.getElementById('csmap').remove();
    return s;
  });
  expect(svg).not.toContain('Testspieler 21');
  expect(svg).not.toContain('Testspieler 25');
  expect(svg).toContain('Testspieler 01');
});

test('Anmeldung und Zeitwahl laufen am Handy nicht über', async ({ page }) => {
  await isolateDb(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await einteilen(page, { cs: { 'Testspieler 01': 'A', 'Testspieler 02': 'B' } });

  for (const [seite, ansicht] of [['cs', 'anmeldung'], ['cs', 'aufstellung']]) {
    await page.evaluate(([s, v]) => { window.nav(s); window.APP.csView = v; window.renderPage(); }, [seite, ansicht]);
    const ueber = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ueber, `${seite}/${ansicht} läuft ${ueber}px über`).toBeLessThanOrEqual(0);
  }
  await page.evaluate(() => { window.nav('ws'); window.setWSView('aufstellung'); });
  const ueberWs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ueberWs).toBeLessThanOrEqual(0);
});

test('Einteilung aus dem Wüstensturm wird unverändert in den Schluchtsturm übernommen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await einteilen(page, { ws: { 'Testspieler 01': 'A', 'Testspieler 02': 'B', 'Testspieler 03': 'B' } });

  const cs = await page.evaluate(() => {
    window.confirm = () => true;
    window.csImportFromWS('kopieren');
    return window.APP.csTeamAssign;
  });
  expect(cs).toEqual({ 'Testspieler 01': 'A', 'Testspieler 02': 'B', 'Testspieler 03': 'B' });
});
