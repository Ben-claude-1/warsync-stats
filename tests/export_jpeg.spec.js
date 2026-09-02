import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// „📷 In Fotos speichern" liefert JPEG, „📋 Bild kopieren" weiterhin PNG.
//
// Beides hängt an einem Weg, den man nicht sieht: die Bilder werden in Last War
// gepostet, und dort ist die Größe der Engpass — als PNG wog die Aufstellungs-
// Karte 2,3 MB, als JPEG 227 KB. Fällt der Export unbemerkt auf PNG zurück,
// merkt das niemand am Bild, sondern erst beim Posten.
//
// Der zweite Punkt ist der wichtigere: **JPEG kennt kein Alpha.** Ohne das
// Abflachen auf Weiß in `saveJpgToPhotos` wäre ein durchsichtiger Bereich
// schwarz statt weiß. Deshalb wird hier ein Eckpixel geprüft und nicht nur die
// Dateigröße — ein schwarzes Bild ist genauso klein wie ein richtiges.

const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
function einteilung({ a = 0, ae = 0 } = {}) {
  const out = {}; let i = 1;
  for (let k = 0; k < a; k++) out[nm(i++)] = 'A';
  for (let k = 0; k < ae; k++) out[nm(i++)] = 'AE';
  return out;
}

test('Fotos-Export liefert ein deckendes JPEG', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.addInitScript(() => {
    // Der Fotos-Knopf nimmt zwei verschiedene Wege: am Handy das Share-Sheet
    // (`navigator.share`), am Rechner den Download über eine Blob-URL. Beide
    // werden abgefangen — sonst ist der Test nur auf einem der beiden Projekte
    // eine Aussage und auf dem anderen ein Fehlschlag.
    window.__blobs = [];
    const echt = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return echt(b); };
    Object.defineProperty(navigator, 'canShare', {
      configurable: true, value: () => true,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }) => { window.__blobs.push(files[0]); },
    });
    window.__png = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: async (items) => {
        window.__png.push(await items[0].getType('image/png'));
      } },
    });
    // Klick auf den erzeugten <a> darf keinen echten Download starten.
    document.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'A' && e.target.download) e.preventDefault();
    }, true);
  });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await page.evaluate((e) => {
    window.APP.teamAssign = e; window.APP.team = 'A';
    window.showWSAufstellungKarte('A');
  }, einteilung({ a: 20, ae: 5 }));
  await expect.poll(() => page.evaluate(() => {
    const i = document.querySelector('#karte-img-wrap img');
    return !!(i && i.complete && i.naturalWidth);
  })).toBe(true);

  await page.locator('#btn-karte-copy').click();
  await expect.poll(() => page.evaluate(() => window.__png.length)).toBe(1);
  await page.locator('#btn-karte-photos').click();
  await expect.poll(() => page.evaluate(() => window.__blobs.length)).toBe(1);

  const mass = await page.evaluate(async () => {
    const jpg = window.__blobs[0], png = window.__png[0];
    const bmp = await createImageBitmap(jpg);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const ecke = c.getContext('2d').getImageData(bmp.width - 2, bmp.height - 2, 1, 1).data;
    return { typ: jpg.type, name: jpg.name || '', w: bmp.width, h: bmp.height,
             jpg: jpg.size, png: png.size, ecke: [...ecke] };
  });
  console.log('MASS ' + JSON.stringify(mass));
  expect(mass.typ).toBe('image/jpeg');
  expect(mass.name).toMatch(/\.jpg$/);
  expect(mass.jpg).toBeLessThan(mass.png / 3);
  // Deckend: die untere rechte Ecke muss Bildinhalt sein, nicht Schwarz.
  expect(mass.ecke.slice(0, 3)).not.toEqual([0, 0, 0]);
  expect(errors.relevant).toEqual([]);
});
