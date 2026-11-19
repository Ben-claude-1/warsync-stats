import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Strategie „Gemeinsam sind wir stark" (Stand 19.11.2026): die LINKE
// Ölraffinerie (`oelraf1`) bleibt leer, die rechte hält 2 Spieler, alle anderen
// stehen an den übrigen Gebäuden. 1:00 vor Ende sammeln sich alle rechts,
// 0:45 vor Ende greifen alle links an. Geprüft wird an den drei Stellen, die
// zählen: Verteilung, Bild, Mail.

const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;

async function aufstellen(page, strategie) {
  page.on('dialog', (d) => d.accept());
  await page.evaluate((strategie) => {
    const ta = {};
    for (let i = 1; i <= 20; i++) ta[`Testspieler ${String(i).padStart(2, '0')}`] = 'A';
    window.APP.teamAssign = ta;
    window.APP.team = 'A';
    window.APP.wsStrategie = { A: strategie, B: null };
    window.autoAssign();
  }, strategie);
}

// Wer an welcher Raffinerie steht — aus dem Zustand, den Bild und Mail lesen.
const anRaffinerie = (page) => page.evaluate(() => {
  const L = window.APP.lineupA, ba = window.APP.bldAssign || {};
  const alle = Object.values(L).flat();
  return {
    r1: alle.filter((n) => ba[n] === 'oelraf1').length,
    r2: alle.filter((n) => ba[n] === 'oelraf2').length,
    slots1: window.APP.bldSlotsA.oelraf1, slots2: window.APP.bldSlotsA.oelraf2,
  };
});

test('„Gemeinsam": links niemand, rechts genau 2, alle anderen an den übrigen Gebäuden', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  await aufstellen(page, null);
  const standard = await anRaffinerie(page);
  expect(standard.r1).toBeGreaterThan(0);
  expect(standard.r2).toBeGreaterThan(0);
  const ohneGebaeude = () => page.evaluate(() => {
    const L = window.APP.lineupA, ba = window.APP.bldAssign || {};
    const ass = new Set(L.ass || []);
    return Object.values(L).flat().filter((n) => !ass.has(n) && !ba[n]).length
      + (20 - Object.values(L).flat().length);
  });
  const vorher = await ohneGebaeude();

  await aufstellen(page, 'gemeinsam');
  const gemeinsam = await anRaffinerie(page);
  expect(gemeinsam.r1).toBe(0);
  expect(gemeinsam.r2).toBe(2);
  // Die frei gewordenen Raffinerie-Plätze gehen an die übrigen Gebäude —
  // niemand fällt aus der Aufstellung.
  expect(await ohneGebaeude()).toBe(vorher);
  // Die eingestellten Slots bleiben unangetastet — zurück auf „Standard" gilt
  // wieder genau das, was eingestellt war.
  expect(gemeinsam.slots1).toBe(standard.slots1);
  expect(gemeinsam.slots2).toBe(standard.slots2);
  expect(errors.relevant).toEqual([]);
});

test('Im Bild steht links groß „leer" und der Angriff, rechts der Sammelpunkt über den Namen', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, 'gemeinsam');
  const rechts = await page.evaluate(() => {
    const L = window.APP.lineupA, ba = window.APP.bldAssign;
    return Object.values(L).flat().filter((n) => ba[n] === 'oelraf2');
  });
  expect(rechts).toHaveLength(2);

  await page.evaluate(() => window.showWSAufstellungKarte('A'));
  const schilder = await page.evaluate(() =>
    [...document.querySelectorAll('#karte-img-wrap .ktag')].map((e) => ({ t: e.textContent, left: parseFloat(e.style.left), fs: parseFloat(e.style.fontSize) })));
  const leer = schilder.filter((s) => s.t === '⛔ EMPTY — DO NOT TAKE');
  expect(leer).toHaveLength(1);
  const sammeln = schilder.find((s) => s.t === '👥 1:00 ALL GATHER HERE');
  const angriff = schilder.find((s) => s.t === '⚔️ 0:45 ALL ATTACK HERE');
  // Leer + Angriff links, Sammelpunkt rechts.
  expect(leer[0].left).toBeLessThan(50);
  expect(angriff.left).toBeLessThan(50);
  expect(sammeln.left).toBeGreaterThan(50);
  // Das Leer-Schild ist größer als ein Namensschild.
  const name = schilder.find((s) => s.t.startsWith(rechts[0] + '▶'));
  expect(name).toBeTruthy();
  expect(leer[0].fs).toBeGreaterThan(name.fs);
  for (const n of rechts) expect(schilder.some((s) => s.t.startsWith(n + '▶') && s.left > 50)).toBe(true);

  const kasten = page.locator('#karte-ersatz');
  await expect(kasten.locator('[data-zeitleiste]')).toContainText('1:00');
  await expect(kasten.locator('[data-zeitleiste]')).toContainText('0:45');
  expect(errors.relevant).toEqual([]);
});

// Das Bild wird in einer Allianz mit fünf Sprachen gepostet (Vorgabe Ben,
// 29.10.2026): es soll ohne Sprache lesbar sein, höchstens knappes Englisch.
// Mitgeschnitten wird jeder Text, den die Canvas zeichnet — einmal mit deutscher,
// einmal mit englischer Oberfläche. Beide müssen gleich sein, und kein Satz
// aus der deutschen Oberfläche darf darin stehen.
async function pngTexte(page, lang) {
  await isolateDb(page);
  await page.addInitScript((l) => localStorage.setItem('wsLang', l), lang);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => {
    const ta = {};
    for (let i = 1; i <= 23; i++) ta[`Testspieler ${String(i).padStart(2, '0')}`] = i > 20 ? 'AE' : 'A';
    for (let i = 24; i <= 25; i++) ta[`Testspieler ${String(i).padStart(2, '0')}`] = 'AC';
    window.APP.teamAssign = ta;
    window.APP.team = 'A';
    window.APP.wsStrategie = { A: 'gemeinsam', B: null };
    window.autoAssign();
    window._texte = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { window._texte.push(String(t)); return orig.call(this, t, ...r); };
    HTMLAnchorElement.prototype.click = function () { window._href = this.href; };
    window.showWSAufstellungKarte('A');
  });
  await page.locator('#karte-img-wrap img').evaluate((img) => img.complete || new Promise((r) => { img.onload = r; }));
  await page.locator('#btn-karte-save').click();
  await page.waitForFunction(() => window._href);
  return page.evaluate(() => window._texte.filter((t) => !t.startsWith('Testspieler')));
}

test('Im PNG steht kein deutscher Text, und es hängt nicht an der Oberflächensprache', async ({ browser }) => {
  const ctxDe = await browser.newContext(), ctxEn = await browser.newContext();
  const de = await pngTexte(await ctxDe.newPage(), 'de');
  expect(de).toContain('⛔ EMPTY — DO NOT TAKE');
  expect(de).toContain('👥 1:00 ALL GATHER HERE');
  expect(de).toContain('🪑 (3)');
  expect(de).toContain('👁 (2)');
  expect(de).toContain('⏱ 1:00');
  expect(de).toContain('⏱ 0:45');
  const DEUTSCH = /Ersatz|Angemeldet|Platz|unserem|Sonst|Gemeinsam|Sekunden|Kisten|leer|niemand/i;
  for (const t of de) expect(t).not.toMatch(DEUTSCH);
  expect(await pngTexte(await ctxEn.newPage(), 'en')).toEqual(de);
  await ctxDe.close(); await ctxEn.close();
});

test('Die Strategie gilt je Team: Team B bleibt beim Standard', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, 'gemeinsam');
  await page.evaluate(() => window.showWSAufstellungKarte('A'));
  await page.locator('#karte-tab-B').click();
  const schilder = await page.evaluate(() =>
    [...document.querySelectorAll('#karte-img-wrap .ktag')].map((e) => e.textContent));
  expect(schilder).not.toContain('⛔ EMPTY — DO NOT TAKE');
  await expect(page.locator('#karte-ersatz [data-zeitleiste]')).toHaveCount(0);
});

test('Die Mail nennt die Strategie: links leer, rechts mit Team, 1:00 und 0:45', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, 'gemeinsam');
  await page.evaluate(() => { window.nav('ws'); window.setWSView('mail'); });
  const mail = page.locator('.card', { hasText: 'Aufstellung Team A' }).first();
  await expect(mail).toContainText('GEMEINSAM SIND WIR STARK');
  await expect(mail).toContainText('Die LINKE Ölraffinerie bleibt LEER.');
  await expect(mail).toContainText('1:00 vor Ende: ALLE zur RECHTEN Ölraffinerie.');
  await expect(mail).toContainText('0:45 vor Ende: ALLE greifen gemeinsam die LINKE Ölraffinerie an');
  await expect(mail).toContainText('Ölraf RECHTS ·');
  await expect(mail).not.toContainText('Ölraf LINKS ·');
  await expect(mail).not.toContainText('Ölraf I ');
});

test('Der Schalter im Reiter Aufstellung schaltet und warnt bei veralteter Verteilung', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, null);
  await page.evaluate(() => { window.nav('ws'); window.setWSView('aufstellung'); });
  await page.getByRole('button', { name: '🤝 Gemeinsam sind wir stark' }).click();
  expect(await page.evaluate(() => window.APP.wsStrategie.A)).toBe('gemeinsam');
  await expect(page.getByText('Die Aufstellung passt nicht zur gewählten Strategie.')).toBeVisible();
  await page.getByRole('button', { name: /Auto-Aufstellen Team A/ }).click();
  await expect(page.getByText('Die Aufstellung passt nicht zur gewählten Strategie.')).toHaveCount(0);
});
