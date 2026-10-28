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
  expect(schilder.filter((t) => t === '⛔ An unserem Spawn: LEER')).toHaveLength(2);
  expect(schilder.filter((t) => t === '⛽ Sonst: Raffinerie-Team ↓')).toHaveLength(2);
  // Kein Raffinerie-Spieler steht als Schild auf der Karte — eine Ortsangabe
  // dort wäre bei jedem zweiten Spawn falsch.
  for (const n of raf) expect(schilder.some((t) => t.startsWith(n + ' '))).toBe(false);

  const kasten = page.locator('#karte-ersatz');
  await expect(kasten).toContainText(`Ölraffinerie GEGENÜBER unserem Spawn (${raf.length})`);
  for (const n of raf) await expect(kasten).toContainText(n);
  await expect(kasten).toContainText('0:40 vor Ende greifen ALLE sie gemeinsam an — nicht früher.');
  expect(errors.relevant).toEqual([]);
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
  expect(schilder).not.toContain('⛔ An unserem Spawn: LEER');
  await expect(page.locator('#karte-ersatz')).not.toContainText('Gemeinsam sind wir stark');
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
