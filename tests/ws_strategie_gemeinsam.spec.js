import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Strategie „Gemeinsam sind wir stark" (Vorgabe Ben, 29.10.2026): die
// Ölraffinerie an UNSEREM Spawn bleibt leer, 0:40 vor Ende greifen alle sie
// gemeinsam an. Welche der beiden Raffinerien das ist, steht erst im Spiel fest.
// Deshalb wird nur eine Raffinerie-Gruppe aufgestellt („gegenüber unserem
// Spawn"), und das Bild nennt an **beiden** Raffinerien die Spawn-Regel statt
// Namen. Geprüft wird an den drei Stellen, die zählen: Verteilung, Bild, Mail.

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

test('Standard besetzt beide Raffinerien, „Gemeinsam" nur eine — mit beiden Gruppen darin', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  await aufstellen(page, null);
  const standard = await anRaffinerie(page);
  expect(standard.r1).toBeGreaterThan(0);
  expect(standard.r2).toBeGreaterThan(0);

  await aufstellen(page, 'gemeinsam');
  const gemeinsam = await anRaffinerie(page);
  expect(gemeinsam.r2).toBe(0);
  // Die freien Plätze gehen nicht verloren, sie landen in der einen Gruppe.
  expect(gemeinsam.r1).toBe(standard.r1 + standard.r2);
  // Die eingestellten Slots bleiben unangetastet — zurück auf „Standard" gilt
  // wieder genau das, was eingestellt war.
  expect(gemeinsam.slots1).toBe(standard.slots1);
  expect(gemeinsam.slots2).toBe(standard.slots2);
  expect(errors.relevant).toEqual([]);
});

test('Im Bild steht an beiden Raffinerien die Spawn-Regel, die Namen darunter', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, 'gemeinsam');
  const raf = await page.evaluate(() => {
    const L = window.APP.lineupA, ba = window.APP.bldAssign;
    return Object.values(L).flat().filter((n) => ba[n] === 'oelraf1');
  });
  expect(raf.length).toBeGreaterThan(0);

  await page.evaluate(() => window.showWSAufstellungKarte('A'));
  const schilder = await page.evaluate(() =>
    [...document.querySelectorAll('#karte-img-wrap .ktag')].map((e) => e.textContent));
  // Zweimal: je Raffinerie einmal — welche es ist, entscheidet erst der Spawn.
  expect(schilder.filter((t) => t === '⛔ OUR SPAWN: EMPTY')).toHaveLength(2);
  expect(schilder.filter((t) => t === '⛽ OTHER SIDE: TEAM ↓')).toHaveLength(2);
  // Kein Raffinerie-Spieler steht als Schild auf der Karte — eine Ortsangabe
  // dort wäre bei jedem zweiten Spawn falsch.
  for (const n of raf) expect(schilder.some((t) => t.startsWith(n + ' '))).toBe(false);

  const kasten = page.locator('#karte-ersatz');
  await expect(kasten).toContainText(`🤝 ⛽ TEAM (${raf.length})`);
  for (const n of raf) await expect(kasten).toContainText(n);
  await expect(kasten.locator('[data-zeitleiste]')).toContainText('0:40');
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
  expect(de).toContain('⛔ OUR SPAWN: EMPTY');
  expect(de).toContain('🪑 (3)');
  expect(de).toContain('👁 (2)');
  expect(de).toContain('⏱ 0:40');
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
  expect(schilder).not.toContain('⛔ OUR SPAWN: EMPTY');
  await expect(page.locator('#karte-ersatz [data-zeitleiste]')).toHaveCount(0);
});

test('Die Mail nennt die Strategie und führt die Raffinerie nicht als Ölraf I', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page, 'gemeinsam');
  await page.evaluate(() => { window.nav('ws'); window.setWSView('mail'); });
  const mail = page.locator('.card', { hasText: 'Aufstellung Team A' }).first();
  await expect(mail).toContainText('GEMEINSAM SIND WIR STARK');
  await expect(mail).toContainText('Die Ölraffinerie an UNSEREM Spawn bleibt LEER.');
  await expect(mail).toContainText('ÖLRAFFINERIE GEGENÜBER UNSEREM SPAWN:');
  await expect(mail).not.toContainText('Ölraf I ');
  await expect(mail).not.toContainText('Ölraf II');
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
