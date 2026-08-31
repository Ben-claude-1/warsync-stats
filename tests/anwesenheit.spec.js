import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { isolateDb, fakeLogin, collectErrors, ALLIANZ_A, ALLIANZ_B } from './helpers.js';

// ══════════════════════════════════════════════════════════════════════════════
//  WER IST GERADE ANGEMELDET
// ══════════════════════════════════════════════════════════════════════════════
// Die App hat keine Sitzung auf dem Server — wer da ist, weiß nur der Browser
// selbst und muss es melden. Geprüft wird deshalb beides: dass der Herzschlag
// überhaupt hinausgeht (und die Allianz mitträgt), und dass die Anzeige einen
// stummen Tab nach ein paar Minuten nicht mehr als anwesend führt.

const PW = 'testpasswort';
const HASH = crypto.createHash('sha256').update(PW).digest('hex');

// Anmeldung über den echten Weg (doLogin), nicht über fakeLogin: der Herzschlag
// hängt an anmeldenAls, und genau diese Verdrahtung soll der Test sehen.
async function stubLogin(page, { presence = [] } = {}) {
  const anfragen = [];
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const tabelle = (u.pathname.split('/rest/v1/')[1] || '').split('?')[0];
    let rumpf = null;
    if (req.method() !== 'GET' && req.method() !== 'DELETE') {
      try { rumpf = JSON.parse(req.postData() || 'null'); } catch { rumpf = req.postData(); }
    }
    anfragen.push({ tabelle, methode: req.method(), url: req.url(), rumpf, suche: u.searchParams });
    if (req.method() !== 'GET') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    const antwort = {
      alliances: [ALLIANZ_A, ALLIANZ_B],
      ws_players: [{
        name: 'Testlauf', alliance_id: ALLIANZ_A.id, role: 'R5', ws_admin: true, profile_edit: true,
        password_hash: HASH, access_enabled: true, can_reset_password: true,
        super_admin: true, alliance_admin: true, active: true,
      }],
      ws_presence: presence,
    }[tabelle] || [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort) });
  });
  await page.route('**/analyze*', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
  await page.goto('/index.html');
  await page.fill('#lu', 'Testlauf');
  await page.fill('#lp', PW);
  await page.click('#login-btn');
  await expect(page.locator('.bnav')).toBeVisible();
  return anfragen;
}

test('die Anmeldung meldet den Tab als anwesend — mit Allianz', async ({ page }) => {
  const anfragen = await stubLogin(page);
  await expect.poll(() => anfragen.filter((a) => a.tabelle === 'ws_presence' && a.methode === 'POST').length)
    .toBeGreaterThan(0);
  const schlag = anfragen.find((a) => a.tabelle === 'ws_presence' && a.methode === 'POST');

  // Ohne alliance_id landete der Herzschlag in keiner oder in der falschen Allianz —
  // die Trennung steckt in core/api.js und muss auch hier greifen.
  expect(schlag.rumpf.alliance_id).toBe(ALLIANZ_A.id);
  expect(schlag.rumpf.player_name).toBe('Testlauf');
  expect(schlag.rumpf.device_id, 'ohne Geräte-ID überschreiben sich Handy und Laptop').toBeTruthy();
  expect(schlag.rumpf.first_seen, 'Beginn der Sitzung wird bei jedem Schlag mitgeschickt').toBeTruthy();
  expect(schlag.rumpf.last_seen).toBeTruthy();
  // Der Schlüssel muss die Allianz mitführen, sonst kollidieren zwei Allianzen
  // auf demselben Spielernamen.
  expect(schlag.suche.get('on_conflict')).toBe('alliance_id,player_name,device_id');
});

test('beim Abmelden verschwindet die Zeile wieder', async ({ page }) => {
  const anfragen = await stubLogin(page);
  await page.evaluate(() => window.logout());
  await expect.poll(() => anfragen.filter((a) => a.tabelle === 'ws_presence' && a.methode === 'DELETE').length)
    .toBeGreaterThan(0);
  const weg = anfragen.find((a) => a.tabelle === 'ws_presence' && a.methode === 'DELETE');
  expect(weg.url).toContain('player_name=eq.Testlauf');
  expect(weg.url).toContain('device_id=eq.');
  expect(weg.url).toContain('alliance_id=eq.' + ALLIANZ_A.id);
});

// Die Anzeige selbst: sie bekommt fertige Zeilen und muss daraus lesen, wer
// gerade da ist. Kein Netz nötig — APP.presence ist genau das, was presencePull
// hinterlässt.
async function zeigePresence(page, rows) {
  await page.evaluate((r) => {
    window.APP.presence = r;
    window.nav('admin');
  }, rows);
  await expect(page.locator('#adm-presence-body')).toBeVisible();
}
function zeile(name, minutenHer, extra = {}) {
  const t = new Date(Date.now() - minutenHer * 60000).toISOString();
  return {
    alliance_id: ALLIANZ_A.id, player_name: name, device_id: 'geraet-' + name,
    device: 'Mac', page: 'ws', first_seen: t, last_seen: t, ...extra,
  };
}

test('anwesend ist, wer sich zuletzt gemeldet hat — der Rest steht unter „Zuletzt gesehen"', async ({ page }) => {
  const fehler = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await zeigePresence(page, [zeile('Frisch', 0), zeile('Fastweg', 2), zeile('Langeweg', 40)]);

  const karte = page.locator('#adm-presence-body');
  await expect(karte).toContainText('2 Mitglieder gerade da');
  await expect(karte).toContainText('Frisch');
  await expect(karte).toContainText('Zuletzt gesehen');
  await expect(karte).toContainText('vor 40 Min');
  expect(fehler.relevant).toEqual([]);
});

test('zwei Geräte desselben Menschen sind eine Zeile', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await zeigePresence(page, [
    zeile('Doppelt', 0, { device_id: 'a', device: 'iPhone' }),
    zeile('Doppelt', 1, { device_id: 'b', device: 'Mac' }),
  ]);

  const karte = page.locator('#adm-presence-body');
  await expect(karte).toContainText('1 Mitglied gerade da');
  await expect(karte).toContainText('iPhone · Mac');
});

test('auf Englisch ist auch die Anwesenheitsliste englisch', async ({ page }) => {
  await isolateDb(page);
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page);
  await zeigePresence(page, [zeile('Frisch', 0), zeile('Langeweg', 40)]);

  const karte = page.locator('#adm-presence-body');
  await expect(karte).toContainText('1 member here right now');
  await expect(karte).toContainText('Last seen');
  await expect(karte).toContainText('40 min ago');
});

test('ohne Anwesende steht es da statt einer leeren Karte', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await zeigePresence(page, [zeile('Gestern', 60 * 26)]);

  const karte = page.locator('#adm-presence-body');
  await expect(karte).toContainText('Gerade ist niemand angemeldet.');
  await expect(karte).toContainText('vor 1 Tag');
});
