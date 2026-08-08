import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin } from './helpers.js';

// Die Leiste war am iPhone abgeschnitten: neun Punkte in einer Flex-Reihe passten
// bei 393px nicht nebeneinander, „Rangliste" fiel ganz aus dem Bild.

async function leiste(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.bnav');
    const btns = [...bar.querySelectorAll('.bni')];
    return {
      knoepfe: btns.length,
      reihen: [...new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)))].length,
      hoehe: Math.round(bar.getBoundingClientRect().height),
      abstandUnten: parseFloat(document.body.style.paddingBottom) || 0,
      ueberRand: btns
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.right > window.innerWidth + 0.5 || r.left < -0.5;
        })
        .map((b) => b.textContent.trim()),
      textUeberlaeuft: btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
    };
  });
}

test('am Handy sind alle Punkte sichtbar', async ({ page }) => {
  await isolateDb(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/index.html');
  await fakeLogin(page);

  const l = await leiste(page);
  expect(l.knoepfe).toBe(9);
  expect(l.ueberRand, 'Punkte ragen aus dem Bild').toEqual([]);
  expect(l.textUeberlaeuft, 'Beschriftung wird abgeschnitten').toEqual([]);
  expect(l.reihen).toBe(2);
  // Der Inhalt darunter braucht mindestens die Höhe der Leiste, sonst verdeckt sie das Seitenende.
  expect(l.abstandUnten).toBeGreaterThanOrEqual(l.hoehe);
});

test('mit weniger Rechten bleibt die Leiste heil', async ({ page }) => {
  await isolateDb(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/index.html');
  await fakeLogin(page, { role: 'r3' });

  const l = await leiste(page);
  expect(l.knoepfe).toBe(7); // ohne Schluchtsturm und Umfragen
  expect(l.ueberRand).toEqual([]);
  expect(l.abstandUnten).toBeGreaterThanOrEqual(l.hoehe);
});

test('am breiten Fenster wieder eine Reihe', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  // navHeightSync hängt am resize-Ereignis
  await expect.poll(async () => (await leiste(page)).reihen).toBe(1);

  const l = await leiste(page);
  expect(l.ueberRand).toEqual([]);
  expect(l.abstandUnten).toBeGreaterThanOrEqual(l.hoehe);
});
