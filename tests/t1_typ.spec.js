import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// T1-Typ — welche Truppengattung der T1-Trupp ist (Tank/Air/Missile).
//
// Die Stärke allein reicht für die Aufstellung nicht: 48 Mio Tank und 48 Mio Air
// gehören an verschiedene Gebäude. Gespeichert als Kurzcode in ws_players.t1_type.

const SPIELER = { name: 'Testlauf', role: 'R5', t1: 48, t1_type: 'T', hero_power: 171_000_000, active: true };

test('Profil zeigt den Typ neben der T1-Stärke und stellt ihn zur Auswahl', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  // Geprüft wird die Beschriftung der T1-Kachel, nicht die ganze Seite: die drei
  // Gattungen stehen ohnehin als Optionen im Auswahlfeld.
  await expect(page.locator('#pc .kk-l').first()).toHaveText('T1 · 🛡 Tank');
  // Vorbelegt mit dem gespeicherten Wert — sonst löschte jedes Speichern den Typ.
  await expect(page.locator('#manT1Type')).toHaveValue('T');
  expect(errors.relevant).toEqual([]);
});

test('ohne Typ steht nichts da — geraten wird nicht', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [{ ...SPIELER, t1_type: null }] });
  await page.evaluate(() => window.nav('profil'));

  await expect(page.locator('#pc .kk-l').first()).toHaveText('T1');
  await expect(page.locator('#manT1Type')).toHaveValue('');
});

test('ein reiner Typwechsel lässt sich speichern', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  // Ohne die Sonderbehandlung bricht saveStrength hier mit „Bitte mindestens
  // einen Wert eingeben" ab: die vier Zahlenfelder sind unverändert.
  const meldungen = [];
  page.on('dialog', (d) => { meldungen.push(d.message()); d.dismiss(); });
  await page.selectOption('#manT1Type', 'A');
  await page.evaluate(() => window.saveStrength());
  // Dass der Schreibversuch danach an isolateDb scheitert, ist der Testaufbau.
  // Es geht allein darum, dass die Eingangsprüfung ihn überhaupt durchlässt.
  await expect.poll(() => meldungen.filter((m) => m.includes('mindestens einen Wert'))).toEqual([]);
  await expect.poll(() => meldungen.length).toBeGreaterThan(0);
});

test('„– unbekannt" löscht einen gesetzten Typ, statt ihn stehenzulassen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await page.evaluate(() => window.nav('profil'));

  // Das Feld ist vorbelegt; eine Auswahl von '' ist deshalb eine Entscheidung
  // und keine leergelassene Eingabe. Geprüft wird der Aufruf, nicht die DB —
  // isolateDb weist jeden Schreibversuch ab.
  await page.selectOption('#manT1Type', '');
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
  expect(JSON.parse(gesendet || '{}')).toHaveProperty('t1_type', null);
});

test('die Allianz-Liste zeigt den Typ neben T1', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, {
    players: [
      { name: 'Panzerfahrer', role: 'R4', t1: 48, t1_type: 'T', active: true },
      { name: 'Fliegerin', role: 'R4', t1: 44, t1_type: 'A', active: true },
      { name: 'Ohne Angabe', role: 'R3', t1: 30, active: true },
    ],
  });
  await page.evaluate(() => window.nav('allianz'));

  await expect(page.locator('#pc')).toContainText('🛡 Tank');
  await expect(page.locator('#pc')).toContainText('✈ Air');
  await expect(page.locator('#pc')).toContainText('T1 30M');
  expect(errors.relevant).toEqual([]);
});
