import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Ersatzspieler bekommen im Wüstensturm kein Gebäude und stehen deshalb auf keinem
// Namensschild der Karte. Ohne eine eigene Zeile unter dem Bild fehlten sie in dem
// PNG, das in der Allianz gepostet wird — genau wie im Schluchtsturm stehen sie
// darum unter der Karte statt darauf.

const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;

// Einteilung direkt in den Zustand schreiben (wie in ersatz_zeiten.spec.js): über
// die Knöpfe wären das dreißig Klicks mit je einem Rendern und Speichern.
async function karteOeffnen(page, einteilung) {
  await page.evaluate((einteilung) => {
    window.APP.teamAssign = einteilung;
    window.APP.team = 'A';
    window.showWSAufstellungKarte('A');
  }, einteilung);
  // Das Bild muss geladen sein, sonst wirft buildKarteCanvas.
  await expect.poll(() => page.evaluate(() => {
    const i = document.querySelector('#karte-img-wrap img');
    return !!(i && i.complete && i.naturalWidth);
  })).toBe(true);
}

function einteilung({ a = 0, ae = 0, b = 0, be = 0 } = {}) {
  const out = {};
  let i = 1;
  for (let k = 0; k < a; k++) out[nm(i++)] = 'A';
  for (let k = 0; k < ae; k++) out[nm(i++)] = 'AE';
  for (let k = 0; k < b; k++) out[nm(i++)] = 'B';
  for (let k = 0; k < be; k++) out[nm(i++)] = 'BE';
  return out;
}

test('Ersatzspieler stehen unter der Karte, nicht darauf', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await karteOeffnen(page, einteilung({ a: 20, ae: 3 }));

  const kasten = page.locator('#karte-ersatz');
  await expect(kasten).toContainText('Ersatz (3) — Einsatz nicht gesichert');
  for (const i of [21, 22, 23]) await expect(kasten).toContainText(nm(i));

  // Auf der Karte selbst hat der Ersatz nichts verloren — dort steht nur, wer ein
  // Gebäude hält.
  const schilder = await page.evaluate(() =>
    [...document.querySelectorAll('#karte-img-wrap .ktag')].map((e) => e.textContent));
  expect(schilder).not.toContain(nm(21));
  expect(errors.relevant).toEqual([]);
});

test('Ohne Ersatz bleibt der Kasten weg', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await karteOeffnen(page, einteilung({ a: 20 }));
  await expect(page.locator('#karte-ersatz')).toBeEmpty();
});

test('Der Teamwechsel in der Karte tauscht auch die Ersatzliste', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  // Team A: zwei Ersatzleute (21, 22) · Team B: einer (24)
  await karteOeffnen(page, einteilung({ a: 20, ae: 2, b: 1, be: 1 }));

  const kasten = page.locator('#karte-ersatz');
  await expect(kasten).toContainText('Ersatz (2)');
  await expect(kasten).toContainText(nm(21));

  await page.locator('#karte-tab-B').click();
  await expect(kasten).toContainText('Ersatz (1)');
  await expect(kasten).toContainText(nm(24));
  await expect(kasten).not.toContainText(nm(21));
});

// Das PNG ist das, was gepostet wird — die Anzeige allein genügt nicht. Geprüft
// wird über die Zwischenablage, wie beim Schluchtsturm-Übersichtsbild: das Bild
// muss um den Ersatz-Streifen höher sein als die Karte selbst.
test('Der Ersatz-Streifen hängt auch im PNG unter der Karte', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.addInitScript(() => {
    window.__kopiert = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: async (items) => {
        const blob = await items[0].getType('image/png');
        const bmp = await createImageBitmap(blob);
        window.__kopiert.push({ w: bmp.width, h: bmp.height });
      } },
    });
  });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await karteOeffnen(page, einteilung({ a: 20, ae: 3, b: 1 }));

  const kartenHoehe = await page.evaluate(() => document.querySelector('#karte-img-wrap img').naturalHeight);

  await page.locator('#btn-karte-copy').click();
  await expect.poll(() => page.evaluate(() => window.__kopiert.length)).toBe(1);
  const mitErsatz = (await page.evaluate(() => window.__kopiert))[0];
  expect(mitErsatz.h).toBeGreaterThan(kartenHoehe);

  // Team B hat keinen Ersatz — dort bleibt das Bild so hoch wie die Karte.
  await page.locator('#karte-tab-B').click();
  await page.locator('#btn-karte-copy').click();
  await expect.poll(() => page.evaluate(() => window.__kopiert.length)).toBe(2);
  const ohneErsatz = (await page.evaluate(() => window.__kopiert))[1];
  expect(ohneErsatz.h).toBe(kartenHoehe);
  expect(errors.relevant).toEqual([]);
});

test('Auf Englisch steht der Streifen englisch da', async ({ page }) => {
  await isolateDb(page);
  // Sprache vor dem Laden setzen: der Knopf lädt die Seite neu, das käme dem
  // fakeLogin dazwischen.
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await karteOeffnen(page, einteilung({ a: 20, ae: 3 }));
  // Die Anzeigeschicht übersetzt den ganzen Satz, nicht nur das erste Wort.
  await expect(page.locator('#karte-ersatz')).toContainText('Substitute (3) — deployment not guaranteed');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});
