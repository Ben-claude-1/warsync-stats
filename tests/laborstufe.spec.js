import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Laborstufe — die Stufe des Saison-Gebäudes (Optoelektronisches Labor).
//
// Sie steht **neben** der T1-Kraft, nicht in ihr: an der Stufe hängt die Güte der
// Truppen, 45 Mio auf Stufe 26 sind etwas anderes als 45 Mio auf Stufe 20.
// Gespeichert in ws_players.lab_level, siehe db/2026-09-28_ws_players_labor.sql.
//
// Erhoben wird sie wie der T1-Typ von der Allianz selbst (Allianzankündigung
// „XP33 Census", 28.09.2026) — eine Selbstauskunft, keine Messung.

const SPIELER = { name: 'Testlauf', role: 'R5', t1: 45, t1_type: 'T', lab_level: 26, hero_power: 171_000_000, active: true };

test('Profil zeigt die Laborstufe als eigene Kachel und stellt sie zur Eingabe', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  await expect(page.locator('#pc')).toContainText('🔬 Labor');
  await expect(page.locator('#pc')).toContainText('Stufe 26');
  // Vorbelegt mit dem gespeicherten Wert — sonst löschte jedes Speichern die Stufe.
  await expect(page.locator('#manLab')).toHaveValue('26');
  expect(errors.relevant).toEqual([]);
});

// Der Kernpunkt der Spalte: NULL heißt „nicht bekannt", nicht „Stufe 0". Eine
// gezeigte 0 wäre die Behauptung, jemand habe das Gebäude nicht — genau die
// Verwechslung, die an mehreren Stellen dieses Projekts als Falle steht.
test('ohne Stufe steht nichts da — eine 0 wäre eine Behauptung', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ ...SPIELER, lab_level: null }] });
  await page.evaluate(() => window.nav('profil'));

  // Gemessen an den Kacheln der Kraft-Karte, nicht an der ganzen Seite: das
  // Eingabefeld darunter trägt seine Beschriftung „🔬 Laborstufe" immer.
  const kacheln = await page.locator('#pc .kk-l').allInnerTexts();
  expect(kacheln.filter((t) => t.includes('Labor'))).toEqual([]);
  await expect(page.locator('#manLab')).toHaveValue('');
});

test('eine reine Stufenänderung lässt sich speichern', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  // Ohne die Sonderbehandlung bricht saveStrength hier mit „Bitte mindestens
  // einen Wert eingeben" ab: die vier Zahlenfelder sind unverändert.
  const meldungen = [];
  page.on('dialog', (d) => { meldungen.push(d.message()); d.dismiss(); });
  await page.fill('#manLab', '27');
  await page.evaluate(() => window.saveStrength());
  await expect.poll(() => meldungen.filter((m) => m.includes('mindestens einen Wert'))).toEqual([]);
  await expect.poll(() => meldungen.length).toBeGreaterThan(0);
});

test('ein geleertes Feld löscht die Stufe, statt sie stehenzulassen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  // Das Feld ist vorbelegt; ein geleertes Feld ist deshalb eine Entscheidung und
  // keine ausgelassene Eingabe — dieselbe Regel wie beim T1-Typ.
  await page.fill('#manLab', '');
  const gesendet = await page.evaluate(async () => {
    const echt = window.fetch;
    let body = null;
    window.fetch = (url, opt) => {
      if (opt?.method === 'PATCH' && String(url).includes('ws_players')) body = opt.body;
      return echt(url, opt);
    };
    await window.saveStrength();
    window.fetch = echt;
    return body;
  });
  expect(JSON.parse(gesendet || '{}')).toHaveProperty('lab_level', null);
});

// Die Stufe ist eine Eigenschaft des Spielers, keine Messreihe — sie gehört
// deshalb nicht in ws_player_history. Sonst stünde sie im Verlaufsdiagramm ohne
// eigene Achse, und ein reiner Stufenwechsel legte einen Truppen-Eintrag an.
test('die Stufe landet nicht im Stärke-Verlauf', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  await page.fill('#manLab', '27');
  const verlauf = await page.evaluate(async () => {
    const echt = window.fetch;
    const koerper = [];
    window.fetch = (url, opt) => {
      if (opt?.method === 'POST' && String(url).includes('ws_player_history')) koerper.push(opt.body);
      return echt(url, opt);
    };
    await window.saveStrength();
    window.fetch = echt;
    return koerper;
  });
  expect(verlauf.join('')).not.toContain('lab_level');
});

test('die Allianz-Liste zeigt die Stufe neben T1', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, {
    players: [
      { name: 'Weit vorn', role: 'R4', t1: 45, t1_type: 'T', lab_level: 26, active: true },
      { name: 'Ohne Angabe', role: 'R3', t1: 30, active: true },
    ],
  });
  await page.evaluate(() => window.nav('allianz'));

  await expect(page.locator('#pc')).toContainText('🔬 26');
  // Der Spieler ohne Angabe bekommt keine Marke — und auch keine 0.
  await expect(page.locator('#pc')).toContainText('T1 30M');
  expect(await page.locator('#pc').innerText()).not.toContain('🔬 0');
  expect(errors.relevant).toEqual([]);
});

// Die Stufe steht in der Anmeldeliste bewusst auf der T1-Zeile und **nicht** als
// siebte Marke im Raster: dessen Spaltenbreiten sind gemessen (342 px gegen
// 339 px am Handy, siehe MARKEN_SLOTS), eine weitere Spalte liefe rechts aus der
// Zeile. Geprüft wird beides — dass sie dasteht, und dass das Raster sechs
// Spalten behält.
test('die Anmeldeliste zeigt die Stufe an der T1-Zahl, nicht im Markenraster', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, {
    players: [
      { name: 'Weit vorn', role: 'R4', t1: 45, t1_type: 'T', lab_level: 26, hero_power: 171_000_000, active: true },
    ],
  });
  await page.evaluate(() => window.nav('ws'));

  await expect(page.locator('#pc')).toContainText('🔬26');
  // Gezählt werden die Kinder des Rasters, nicht die Tokens von
  // gridTemplateColumns: der Browser normalisiert `minmax(0,60px)` zu
  // `minmax(0, 60px)` und ein Zerlegen am Leerzeichen zählte eine Spalte zu viel.
  const zellen = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#pc div')].find(
      (d) => d.style.display === 'grid' && d.style.gridTemplateColumns.includes('minmax'),
    );
    return r ? r.children.length : 0;
  });
  expect(zellen).toBe(6);
  expect(errors.relevant).toEqual([]);
});
