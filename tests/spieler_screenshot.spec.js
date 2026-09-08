import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Screenshot der Truppen-Verteidigung im Allianz-Detail.
//
// Der Knopf war bis zum 08.09.2026 eine Attrappe: er warf „OCR-Analyse folgt in
// V2" und ließ die Felder leer, obwohl /analyze-strength längst lief und im
// Profil dieselbe Aufgabe erledigte. Geprüft wird deshalb beides — dass die
// erkannten Werte ankommen und dass keine Meldung mehr dazwischenfährt.

const SPIELER = { name: 'Testlauf', role: 'R5', t1: 10, active: true };

// Ein 1×1-Pixel-PNG genügt: die Erkennung selbst ist abgefangen, es geht um den
// Weg vom Dateifeld über resizeImageForOcr bis in die Eingabefelder.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Die Zahlen des Spiels, wie sie der Vision-Server liefert: absolute Werte, die
// die App auf Millionen herunterrechnet.
const ERKANNT = { t1: 40328788, t2: 29883989, t3: 28601421 };

async function detailBearbeiten(page) {
  await page.evaluate(() => {
    window.nav('allianz');
    window.APP.allianzPlayer = 'Testlauf';
    window.APP.allianzPlayerEdit = true;
    window.renderPage();
  });
  await expect(page.locator('#apd-ss')).toHaveCount(1);
}

test('der hochgeladene Screenshot füllt T1–T4 aus', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  // Nach isolateDb registriert, damit diese Regel zuerst greift.
  await page.route('**/analyze-strength', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ERKANNT),
  }));
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await detailBearbeiten(page);

  await page.setInputFiles('#apd-ss', { name: 'truppen.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.locator('#apd-t1')).toHaveValue('40.33');
  await expect(page.locator('#apd-t2')).toHaveValue('29.88');
  await expect(page.locator('#apd-t3')).toHaveValue('28.6');
  // T4 stand nicht im Bild — ein nicht gelesener Wert bleibt, wie er war.
  await expect(page.locator('#apd-t4')).toHaveValue('');
  await expect(page.locator('#apdImgResult')).toContainText('3 Werte erkannt');
  expect(errors.relevant).toEqual([]);
});

test('keine Meldung fährt mehr dazwischen', async ({ page }) => {
  await isolateDb(page);
  await page.route('**/analyze-strength', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ERKANNT),
  }));
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await detailBearbeiten(page);

  const meldungen = [];
  page.on('dialog', (d) => { meldungen.push(d.message()); d.dismiss(); });
  await page.setInputFiles('#apd-ss', { name: 'truppen.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.locator('#apd-t1')).toHaveValue('40.33');
  expect(meldungen).toEqual([]);
});

test('ein nicht erreichbarer Vision-Server sagt das, statt still zu bleiben', async ({ page }) => {
  await isolateDb(page);
  await page.route('**/analyze-strength', (route) => route.fulfill({ status: 502, body: 'kaputt' }));
  await page.goto('/index.html');
  await fakeLogin(page, { players: [SPIELER] });
  await detailBearbeiten(page);

  await page.setInputFiles('#apd-ss', { name: 'truppen.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.locator('#apdImgResult')).toContainText('502');
  // Die Beschriftung fällt auf ihren Ausgangstext zurück, nicht auf den des
  // Profils — sie wird gemerkt statt fest gesetzt.
  await expect(page.locator('#apdImgLabel')).toHaveText('Screenshot Truppen-Verteidigung');
  await expect(page.locator('#apd-t1')).toHaveValue('10');
});
