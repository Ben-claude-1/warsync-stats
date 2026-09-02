import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Das Team-Schild ("Team A · 13:00 EU · 09:00 Server") steht in der Anzeige und im
// PNG. Im Export hing seine Größe an cw/18 statt am Anteil der Kartenbreite und
// fiel damit gut zweieinhalbmal so groß aus wie im Fenster — im geposteten Bild
// deckte es den halben Kartenkopf zu.
//
// Gemessen wird auf dem Desktop. Am Handy zeigt die Anzeige das Schild bewusst
// größer als der Maßstab hergibt (Untergrenze 11px, sonst unlesbar); ein Vergleich
// dort prüfte die Ausnahme statt der Regel.
test('Das Team-Schild ist im PNG so groß wie in der Anzeige', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'am Handy gilt die Lesbarkeits-Untergrenze');
  const errors = collectErrors(page);
  await isolateDb(page);
  // Mitschreiben, mit welcher Schrift die Canvas das Schild zeichnet. Über die
  // Pixel des fertigen PNG ginge es nicht: der Kasten ist halbdurchsichtig und das
  // Kartenbild darunter hat selbst dunkle Stellen.
  await page.addInitScript(() => {
    window.__gemalt = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) {
      window.__gemalt.push({ text: String(t), font: this.font, cw: this.canvas.width });
      return orig.call(this, t, ...rest);
    };
  });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await page.evaluate(() => {
    const e = {};
    for (let i = 1; i <= 20; i++) e[`Testspieler ${String(i).padStart(2, '0')}`] = 'A';
    window.APP.teamAssign = e;
    window.APP.team = 'A';
    window.showWSAufstellungKarte('A');
  });
  await expect.poll(() => page.evaluate(() => {
    const i = document.querySelector('#karte-img-wrap img');
    return !!(i && i.complete && i.naturalWidth);
  })).toBe(true);

  const anzeige = await page.evaluate(() => {
    const l = document.getElementById('karte-team-label');
    const w = document.getElementById('karte-img-wrap');
    const img = w.querySelector('img');
    return {
      fs: parseFloat(getComputedStyle(l).fontSize),
      // Vom Fenster auf das PNG umgerechnet: das Kartenbild ist im Original breiter,
      // als es angezeigt wird.
      faktor: img.naturalWidth / w.getBoundingClientRect().width,
    };
  });

  await page.locator('#btn-karte-copy').click();
  await expect.poll(() => page.evaluate(() =>
    window.__gemalt.some((g) => g.text.startsWith('Team ')))).toBe(true);
  const schild = await page.evaluate(() => window.__gemalt.filter((g) => g.text.startsWith('Team ')).pop());
  const imBild = parseFloat(schild.font.match(/(\d+(?:\.\d+)?)px/)[1]);

  expect(imBild).toBeCloseTo(anzeige.fs * anzeige.faktor, -0.3);
  // Und der Kasten passt aufs Bild: mehr als ein Drittel der Breite hat er nie
  // gebraucht, der Fehler lag bei knapp 90 %.
  expect(imBild).toBeLessThan(schild.cw * 0.03);
  expect(errors.relevant).toEqual([]);
});
