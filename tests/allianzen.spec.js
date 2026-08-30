import { test, expect } from '@playwright/test';
import { fakeLogin, collectErrors, fixturePlayers, ALLIANZ_A, ALLIANZ_B } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════════
//  MEHRERE ALLIANZEN NEBENEINANDER
// ══════════════════════════════════════════════════════════════════════════════
// Der Kern ist nicht die Oberfläche, sondern eine Zusicherung über jede einzelne
// Anfrage: keine Zeile einer Mandanten-Tabelle wird gelesen oder geschrieben,
// ohne dass die Allianz mitgeht. Fiele die an einer Stelle weg, sähe der Admin
// der einen Allianz still die Daten der anderen — ohne Fehlermeldung, ohne dass
// es jemandem auffiele. Genau darauf zielen die ersten Tests.

// Tabellen, die einer Allianz gehören — Spiegel von src/core/tenant.js. Bewusst
// hier noch einmal aufgeschrieben: liefe der Test gegen dieselbe Konstante, würde
// eine versehentlich geleerte Liste den Test mitleeren statt ihn zu brechen.
const MANDANTEN_TABELLEN = [
  'ws_players', 'ws_events', 'ws_participation', 'ws_player_history',
  'ws_planner_state', 'ws_polls', 'ws_poll_votes', 'vs_weeks', 'vs_entries',
  'zug_rides', 'ws_rankings', 'ws_versammlungen', 'ws_player_coords',
];

function zerlege(url) {
  const u = new URL(url);
  const tabelle = u.pathname.split('/rest/v1/')[1] || '';
  const filter = u.searchParams.get('alliance_id') || null;
  return {
    tabelle,
    allianz: filter ? filter.replace(/^eq\./, '') : null,
    onConflict: u.searchParams.get('on_conflict'),
    url,
  };
}

// Datenbank-Attrappe, die die Allianz tatsächlich auswertet: sie liefert nur die
// Zeilen der angefragten Allianz zurück. Eine Attrappe, die stur dieselben Daten
// ausgibt, könnte eine fehlende Trennung gar nicht zeigen.
async function stubDb(page, daten = {}) {
  const anfragen = [];
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const info = { ...zerlege(req.url()), methode: req.method() };
    let rumpf = null;
    if (req.method() !== 'GET' && req.method() !== 'DELETE') {
      try { rumpf = JSON.parse(req.postData() || 'null'); } catch { rumpf = req.postData(); }
    }
    info.rumpf = rumpf;
    anfragen.push(info);
    const name = info.tabelle.split('?')[0];
    if (name === 'alliances') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ALLIANZ_A, ALLIANZ_B]) });
    }
    if (req.method() === 'GET') {
      const alle = daten[name] || [];
      const gefiltert = info.allianz ? alle.filter((r) => r.alliance_id === info.allianz) : alle;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gefiltert) });
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/analyze*', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
  return anfragen;
}

// Wo die Allianz stehen muss, hängt von der Methode ab:
//  · GET/PATCH/DELETE adressieren vorhandene Zeilen → Filter in der URL.
//  · POST legt neue an → Spalte im Datensatz.
// Beides zu verlangen wäre falsch, beides durchgehen zu lassen wertlos.
function ohneAllianz(anfragen) {
  return anfragen.filter((x) => {
    if (!MANDANTEN_TABELLEN.includes(x.tabelle)) return false;
    if (x.methode === 'POST') {
      const zeilen = Array.isArray(x.rumpf) ? x.rumpf : [x.rumpf];
      return zeilen.some((r) => !r || !r.alliance_id);
    }
    return !x.allianz;
  });
}

// ── 1. Jede Anfrage trägt die Allianz ────────────────────────────────────────

test('keine Anfrage an eine Mandanten-Tabelle geht ohne Allianz hinaus', async ({ page }) => {
  const fehler = collectErrors(page);
  const anfragen = await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  // Jede Seite einmal öffnen — das deckt die Lesewege ab.
  for (const seite of ['home', 'ws', 'cs', 'vs', 'zugfahrt', 'allianz', 'umfragen', 'profil', 'admin', 'rankings']) {
    await page.evaluate((p) => window.nav(p), seite);
    await page.waitForTimeout(60);
  }
  // Und ein vollständiger Ladelauf: synced zurücksetzen, dann löst nav() in
  // renderShell loadData() aus — das fasst alle übrigen Tabellen an.
  await page.evaluate(() => { window.APP.synced = false; window.nav('home'); });
  await expect.poll(() => page.evaluate(() => window.APP.synced), { timeout: 5000 }).toBe(true);
  // Ranglisten und Umfragen laden erst beim Öffnen ihrer Seite nach.
  await page.evaluate(() => window.nav('rankings'));
  await page.evaluate(() => window.nav('umfragen'));
  await page.waitForTimeout(200);

  expect(anfragen.length, 'die Attrappe hat gar nichts gesehen').toBeGreaterThan(0);
  // Alle Mandanten-Tabellen müssen dabei auch wirklich vorgekommen sein, sonst
  // prüft der Test nur, dass nichts passiert ist.
  const beruehrt = new Set(anfragen.map((a) => a.tabelle));
  expect([...beruehrt].filter((t) => MANDANTEN_TABELLEN.includes(t)).length).toBeGreaterThan(5);
  expect(ohneAllianz(anfragen).map((x) => `${x.methode} ${x.tabelle}`)).toEqual([]);
  expect(fehler.relevant).toEqual([]);
});

test('Schreibwege nehmen die Allianz in den Datensatz auf', async ({ page }) => {
  const anfragen = await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  // Ein Schreibweg, der ohne Oberfläche auskommt: der geteilte Planungsstand.
  await page.evaluate(() => window.saveWSState());
  await expect.poll(() => anfragen.filter((a) => a.tabelle === 'ws_planner_state' && a.methode === 'POST').length)
    .toBeGreaterThan(0);

  const push = anfragen.find((a) => a.tabelle === 'ws_planner_state' && a.methode === 'POST');
  expect(push.rumpf.alliance_id, 'Planungsstand ohne Allianz gespeichert').toBe(ALLIANZ_A.id);
  // Der Eindeutigkeits-Schlüssel muss die Allianz enthalten, sonst überschreibt die
  // eine Allianz den Planungsstand der anderen.
  expect(push.onConflict).toBe('alliance_id,key');
});

test('ohne gewählte Allianz wird gar nicht erst angefragt', async ({ page }) => {
  const anfragen = await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  const fehler = await page.evaluate(async () => {
    window.APP.allianceId = null;
    try { await window.APP.__nichts; } catch { /* egal */ }
    // Direkt über einen Schreibweg gehen, der sonst durchliefe.
    try { window.saveWSState(); } catch (e) { return e.message; }
    return null;
  });
  await page.waitForTimeout(1200);
  // Entweder es knallt sofort, oder es geht schlicht nichts hinaus — beides ist
  // richtig. Falsch wäre nur eine Anfrage ohne Allianz.
  expect(ohneAllianz(anfragen)).toEqual([]);
  expect(fehler === null || /Allianz/.test(fehler)).toBeTruthy();
});

// ── 2. Umschalten ────────────────────────────────────────────────────────────

test('nur der Super-Admin bekommt den Umschalter', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');

  await fakeLogin(page, { role: 'superadmin' });
  await expect(page.locator('.hd-alli')).toBeVisible();
  await expect(page.locator('.hd-alli option')).toHaveCount(2);

  // Allianz-Admin: volle Rechte in seiner Allianz, aber kein Umschalter — und er
  // sieht in APP.alliances ohnehin nur die eigene.
  await fakeLogin(page, { role: 'r4', allianceAdmin: true, alliances: [ALLIANZ_A] });
  await expect(page.locator('.hd-alli')).toHaveCount(0);
  await expect(page.locator('.hd-sub')).toHaveText('TSTA #1');

  await fakeLogin(page, { role: 'r3', alliances: [ALLIANZ_A] });
  await expect(page.locator('.hd-alli')).toHaveCount(0);
});

test('Umschalten lädt die andere Allianz und zeigt deren Spieler', async ({ page }) => {
  const fehler = collectErrors(page);
  const spielerA = fixturePlayers(4).map((p) => ({ ...p, name: 'AlphaSpieler ' + p.name.slice(-2), alliance_id: ALLIANZ_A.id }));
  const spielerB = fixturePlayers(2).map((p) => ({ ...p, name: 'BravoSpieler ' + p.name.slice(-2), alliance_id: ALLIANZ_B.id }));
  const anfragen = await stubDb(page, { ws_players: [...spielerA, ...spielerB] });
  await page.goto('/index.html');
  await fakeLogin(page, { players: spielerA });

  await page.evaluate((id) => window.switchAlliance(id), ALLIANZ_B.id);
  await expect.poll(() => page.evaluate(() => window.APP.synced), { timeout: 5000 }).toBe(true);

  // Kopfzeile folgt der Ansicht.
  await expect(page.locator('.hd-alli')).toHaveValue(ALLIANZ_B.id);

  // Die geladenen Spieler sind die der neuen Allianz — und nur die.
  const namen = await page.evaluate(() => window.APP.data.players.map((p) => p.name));
  expect(namen.length).toBe(2);
  expect(namen.every((n) => n.startsWith('BravoSpieler'))).toBeTruthy();

  // Ab dem Wechsel trägt jede Anfrage die neue Allianz.
  const nachWechsel = anfragen.slice(anfragen.findIndex((a) => a.allianz === ALLIANZ_B.id));
  expect(nachWechsel.filter((a) => a.allianz === ALLIANZ_A.id)).toEqual([]);
  expect(ohneAllianz(anfragen)).toEqual([]);
  expect(fehler.relevant).toEqual([]);
});

test('der Wechsel lässt nichts von der vorigen Allianz stehen', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  await page.evaluate(() => {
    window.APP.teamAssign = { 'Testspieler 01': 'A', 'Testspieler 02': 'B' };
    window.APP.lineupA.z1 = ['Testspieler 01'];
    window.APP.csTeamAssign = { 'Testspieler 03': 'A' };
    window.APP.anmeldungClosed = true;
    window.APP.wsEventId = 'irgendwas';
  });
  await page.evaluate((id) => window.switchAlliance(id), ALLIANZ_B.id);
  await expect.poll(() => page.evaluate(() => window.APP.synced), { timeout: 5000 }).toBe(true);

  const rest = await page.evaluate(() => ({
    teamAssign: Object.keys(window.APP.teamAssign).length,
    lineup: window.APP.lineupA.z1.length,
    csTeamAssign: Object.keys(window.APP.csTeamAssign).length,
    geschlossen: window.APP.anmeldungClosed,
    eventId: window.APP.wsEventId,
  }));
  expect(rest).toEqual({ teamAssign: 0, lineup: 0, csTeamAssign: 0, geschlossen: false, eventId: null });
});

test('ein wartender Planungsstand landet nicht in der neuen Allianz', async ({ page }) => {
  // plannerPush ist entprellt. Wer während der Wartezeit umschaltet, dürfte den
  // Stand der alten Allianz sonst in die neue schreiben — der übelste Fall, weil
  // er die fremde Aufstellung stillschweigend überschreibt.
  const anfragen = await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  await page.evaluate((id) => {
    window.APP.teamAssign = { 'Testspieler 01': 'A' };
    window.saveWSState();        // startet den entprellten Push (900 ms)
    window.switchAlliance(id);   // sofort danach umschalten
  }, ALLIANZ_B.id);
  await page.waitForTimeout(1500);

  const pushes = anfragen.filter((a) => a.tabelle === 'ws_planner_state' && a.methode === 'POST');
  // Falls überhaupt einer durchging: dann mit der ALTEN Allianz im Datensatz und
  // niemals mit der neuen.
  expect(pushes.filter((p) => p.rumpf?.alliance_id === ALLIANZ_B.id)).toEqual([]);
});

test('der lokale Puffer trennt die Allianzen', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);

  await page.evaluate(() => { window.APP.teamAssign = { 'Testspieler 01': 'A' }; window.saveWSState(); });
  const schluesselA = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('warsync_ws_state')));

  await page.evaluate((id) => window.switchAlliance(id), ALLIANZ_B.id);
  await expect.poll(() => page.evaluate(() => window.APP.synced), { timeout: 5000 }).toBe(true);
  await page.evaluate(() => { window.APP.teamAssign = { 'Testspieler 09': 'B' }; window.saveWSState(); });

  const alle = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('warsync_ws_state')));
  expect(alle.length, 'beide Allianzen teilen sich einen localStorage-Schlüssel').toBe(2);
  expect(alle).toEqual(expect.arrayContaining(schluesselA));

  // Und die Inhalte sind wirklich verschieden.
  const inhalte = await page.evaluate((ks) => ks.map((k) => JSON.parse(localStorage.getItem(k)).teamAssign), alle);
  expect(inhalte[0]).not.toEqual(inhalte[1]);
});

// ── 3. Rechte ────────────────────────────────────────────────────────────────

test('Allianz-Admin kommt ins Panel, sieht aber keine Allianz-Verwaltung', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');

  await fakeLogin(page, { role: 'r4', allianceAdmin: true, alliances: [ALLIANZ_A] });
  await page.evaluate(() => window.nav('admin'));
  const inhalt = await page.locator('#pc').innerHTML();
  expect(inhalt).not.toContain('Kein Zugriff');
  // Seine eigene Allianz sieht er — anlegen, umschalten und kopieren nicht.
  expect(inhalt).toContain('Deine Allianz');
  expect(inhalt).not.toContain('Neue Allianz anlegen');
  expect(inhalt).not.toContain('in andere Allianz kopieren');
  expect(inhalt).not.toContain('switchAlliance(');
  // Verwaltungsaufgaben innerhalb der Allianz stehen ihm offen.
  expect(inhalt).toContain('Zugangsverwaltung');
  expect(inhalt).toContain('Berechtigungen');
});

test('Super-Admin sieht die Allianz-Verwaltung vollständig', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { role: 'superadmin' });
  await page.evaluate(() => window.nav('admin'));
  const inhalt = await page.locator('#pc').innerHTML();
  expect(inhalt).toContain('Neue Allianz anlegen');
  expect(inhalt).toContain('in andere Allianz kopieren');
  expect(inhalt).toContain('switchAlliance(');
});

test('gewöhnliche Spieler kommen nicht ins Panel', async ({ page }) => {
  await stubDb(page);
  await page.goto('/index.html');
  for (const rolle of ['r3', 'r4', 'r5']) {
    await fakeLogin(page, { role: rolle, alliances: [ALLIANZ_A] });
    await page.evaluate(() => window.nav('admin'));
    await expect(page.locator('#pc'), `Rolle ${rolle} kommt ins Admin-Panel`).toContainText('Kein Zugriff');
  }
});

test('ein Allianz-Admin kann sich nicht selbst über die Allianzen heben', async ({ page }) => {
  const anfragen = await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { role: 'r4', allianceAdmin: true, alliances: [ALLIANZ_A] });
  // Der direkte Aufruf, wie ihn jemand über die Konsole absetzen würde.
  await page.evaluate(() => window.adminSetPerm('Testspieler 01', 'super_admin', true));
  await page.evaluate(() => window.switchAlliance('22222222-2222-4222-8222-222222222222'));
  await page.waitForTimeout(300);
  expect(anfragen.filter((a) => a.methode === 'PATCH' && JSON.stringify(a.rumpf).includes('super_admin'))).toEqual([]);
  expect(await page.evaluate(() => window.APP.allianceId)).toBe(ALLIANZ_A.id);
});

// ── 4. Anmeldung ─────────────────────────────────────────────────────────────

async function loginStub(page, spielerZeilen) {
  await page.route('**/rest/v1/**', async (route) => {
    const u = new URL(route.request().url());
    const tabelle = u.pathname.split('/rest/v1/')[1];
    if (tabelle.startsWith('alliances')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ALLIANZ_A, ALLIANZ_B]) });
    }
    if (tabelle.startsWith('ws_players') && u.searchParams.get('name')?.startsWith('ilike.')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spielerZeilen) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}
// sha256('geheim1234') — die App vergleicht den Hash, nicht das Passwort.
const HASH_GEHEIM = 'd7c8dbb6b0f16dd1fe4e1d5f39fd4b1eaeba4f5a71bd6d4d69ec5da60cffbe4a';

async function hashVon(page, pw) {
  return page.evaluate(async (p) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }, pw);
}

test('derselbe Name in zwei Allianzen führt zur Rückfrage statt zum Raten', async ({ page }) => {
  await page.goto('/index.html');
  const hash = await hashVon(page, 'geheim1234');
  await loginStub(page, [
    { name: 'Doppel', alliance_id: ALLIANZ_A.id, role: 'R4', password_hash: hash, access_enabled: true },
    { name: 'Doppel', alliance_id: ALLIANZ_B.id, role: 'R3', password_hash: hash, access_enabled: true },
  ]);
  await page.reload();
  await page.fill('#lu', 'Doppel');
  await page.fill('#lp', 'geheim1234');
  await page.click('#login-btn');
  await expect(page.locator('#login-err')).toContainText('Für welche Allianz anmelden?');
  await expect(page.locator('#login-err button')).toHaveCount(2);

  await page.locator('#login-err button', { hasText: 'TSTB' }).click();
  await expect(page.locator('.bnav')).toBeVisible();
  expect(await page.evaluate(() => window.APP.allianceId)).toBe(ALLIANZ_B.id);
  // Ein gewöhnlicher Spieler sieht nur seine Allianz — kein Umschalter.
  await expect(page.locator('.hd-alli')).toHaveCount(0);
});

test('der Super-Admin kommt ohne Rückfrage herein und sieht alle Allianzen', async ({ page }) => {
  await page.goto('/index.html');
  const hash = await hashVon(page, 'geheim1234');
  await loginStub(page, [
    { name: 'Chef', alliance_id: ALLIANZ_A.id, role: 'R4', password_hash: hash, access_enabled: true, super_admin: true },
    { name: 'Chef', alliance_id: ALLIANZ_B.id, role: 'R4', password_hash: hash, access_enabled: true, super_admin: true },
  ]);
  await page.reload();
  await page.evaluate(() => localStorage.removeItem('ws_alliance_id'));
  await page.fill('#lu', 'Chef');
  await page.fill('#lp', 'geheim1234');
  await page.click('#login-btn');
  await expect(page.locator('.bnav')).toBeVisible();
  expect(await page.evaluate(() => window.APP.user.role)).toBe('superadmin');
  // Feste Reihenfolge nach Tag — nicht dem Zufall der Datenbank überlassen.
  expect(await page.evaluate(() => window.APP.allianceId)).toBe(ALLIANZ_A.id);
  await expect(page.locator('.hd-alli option')).toHaveCount(2);
  await page.evaluate(() => localStorage.removeItem('ws_alliance_id'));
});

test('falsches Passwort und gesperrter Zugang bleiben unterscheidbar', async ({ page }) => {
  await page.goto('/index.html');
  const hash = await hashVon(page, 'geheim1234');
  await loginStub(page, [{ name: 'Gesperrt', alliance_id: ALLIANZ_A.id, role: 'R3', password_hash: hash, access_enabled: false }]);
  await page.reload();
  await page.fill('#lu', 'Gesperrt');
  await page.fill('#lp', 'falsch');
  await page.click('#login-btn');
  await expect(page.locator('#login-err')).toContainText('Falsches Passwort');
  await page.fill('#lp', 'geheim1234');
  await page.click('#login-btn');
  await expect(page.locator('#login-err')).toContainText('Kein Zugang');
});

// Rang ändern schrieb den neuen Wert klein geschrieben in den lokalen Zustand
// ('r3'), während die Datenbank 'R3' bekam. Bis zum nächsten Laden bildete der
// Spieler dadurch eine eigene Gruppe in der Mitgliederliste, und roleRank()
// kannte den Wert nicht — er landete auf dem Rückfallwert und sortierte sich
// zwischen die R2.
test('Rang ändern lässt den Spieler in seiner Rang-Gruppe', async ({ page }) => {
  // stubDb beantwortet den PATCH mit 201 — ohne durchgehenden Schreibzugriff käme
  // die App gar nicht erst zum Zustands-Update.
  await stubDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, {
    players: [
      { name: 'Testspieler A', role: 'R3', active: true, hero_power: 120_000_000 },
      { name: 'Testspieler B', role: 'R2', active: true, hero_power: 110_000_000 },
      { name: 'Testspieler C', role: 'R4', active: true, hero_power: 130_000_000 },
    ],
  });

  await page.evaluate(async () => {
    window.nav('allianz');
    await window.apdSetRank('Testspieler C', 'R3');
  });

  const rolle = await page.evaluate(() => window.APP.data.players.find((p) => p.name === 'Testspieler C').role);
  expect(rolle).toBe('R3');

  // In der nach Rang sortierten Liste steht genau eine R3-Überschrift, und der
  // umgestufte Spieler steht darunter statt in einer eigenen Gruppe.
  const gruppen = await page.evaluate(() =>
    [...document.querySelectorAll('#pc div')]
      .map((e) => e.textContent.trim())
      .filter((t) => /^── .+ ──$/.test(t)));
  expect(gruppen.filter((g) => /r3/i.test(g))).toHaveLength(1);
  expect(gruppen.join(' ')).not.toContain('r3 ');
});
