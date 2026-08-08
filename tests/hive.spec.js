import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, fixturePlayers } from './helpers.js';

// Hive: aus der Spielerliste wird ein geschlossenes Rechteck um das Allianzzentrum.

async function oeffneUeberKachel(page) {
  await page.locator('.qc', { hasText: 'Hive-Aufstellung' }).click();
  await expect(page.locator('[data-hive-modal]')).toBeVisible();
}

test('Kachel auf dem Dashboard öffnet den Dialog', async ({ page }) => {
  const writes = await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneUeberKachel(page);
  await expect(page.locator('[data-hive-modal] h3')).toContainText('Hive-Aufstellung');
  expect(writes).toEqual([]);
});

test('Zentrum-Modus füllt das Rechteck lückenlos', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  // 30 Spieler + Zentrum = 31 -> 6x6 = 36 Felder, also 5 frei
  await fakeLogin(page, { players: fixturePlayers(30) });
  await oeffneUeberKachel(page);

  await page.fill('#hive-x', '436');
  await page.fill('#hive-y', '507');
  await page.click('#hive-go');

  await expect(page.locator('[data-hive-modal] td')).toHaveCount(36);
  await expect(page.locator('#hive-out .note').last()).toContainText('30 Spieler platziert');
  // Das Zentrum liegt auf der eingegebenen Koordinate.
  await expect(page.locator('[data-hive-modal] td', { hasText: 'x:436 y:507' })).toContainText('MG');
});

test('R5 und R4 sitzen im Innenring', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await oeffneUeberKachel(page);
  await page.fill('#hive-x', '436');
  await page.fill('#hive-y', '507');
  await page.click('#hive-go');

  // Ring 1 sind die acht Felder um das Zentrum: x/y jeweils ±3. Die Fixtures haben
  // nur fünf Führungskräfte (1×R5, 4×R4), die übrigen drei Felder gehen an die
  // stärksten R3 — geprüft wird deshalb, dass die Führung *vollständig* drin sitzt.
  const ring1 = await page.evaluate(() => {
    const koords = [];
    for (const dx of [-3, 0, 3]) for (const dy of [-3, 0, 3]) {
      if (dx === 0 && dy === 0) continue;
      koords.push(`x:${436 + dx} y:${507 + dy}`);
    }
    return [...document.querySelectorAll('[data-hive-modal] td')]
      .filter((td) => koords.some((k) => td.textContent.includes(k)))
      .map((td) => td.querySelector('div')?.textContent.trim());
  });

  expect(ring1).toHaveLength(8);
  for (const chef of ['Testspieler 01', 'Testspieler 02', 'Testspieler 03', 'Testspieler 04', 'Testspieler 05']) {
    expect(ring1, `${chef} gehört in den Innenring`).toContain(chef);
  }
});

test('Bereich-Modus nimmt zwei Ecken, Reihenfolge egal', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await oeffneUeberKachel(page);
  await page.click('#hive-m-area');

  // 424..445 = 8 Spalten, 492..510 = 7 Reihen -> 56 Felder
  for (const [ecke1, ecke2] of [[['424', '492'], ['445', '510']], [['445', '510'], ['424', '492']]]) {
    await page.fill('#hive-x1', ecke1[0]);
    await page.fill('#hive-y1', ecke1[1]);
    await page.fill('#hive-x2', ecke2[0]);
    await page.fill('#hive-y2', ecke2[1]);
    await page.click('#hive-go');
    await expect(page.locator('[data-hive-modal] td')).toHaveCount(56);
    await expect(page.locator('#hive-out .note').last()).toContainText('x:424–445 y:492–510');
  }
});

test('zu kleiner Bereich warnt statt stillschweigend zu kürzen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await oeffneUeberKachel(page);
  await page.click('#hive-m-area');
  // 3x3 = 9 Felder, davon eins fürs Zentrum -> 8 Plätze für 30 Spieler
  await page.fill('#hive-x1', '400');
  await page.fill('#hive-y1', '400');
  await page.fill('#hive-x2', '406');
  await page.fill('#hive-y2', '406');
  await page.click('#hive-go');

  // Die Warnung steht bewusst vor der Zusammenfassung.
  const warnung = page.locator('#hive-out .note').first();
  await expect(warnung).toContainText('Der Bereich ist zu klein');
  await expect(warnung).toContainText('22 Spieler passen nicht hinein');
  // Übrig bleiben die Schwächsten, nie die Führung.
  await expect(warnung).not.toContainText('Testspieler 01');
});

test('ohne Koordinate passiert nichts', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await oeffneUeberKachel(page);
  page.on('dialog', (d) => d.accept());
  await page.click('#hive-go');
  await expect(page.locator('[data-hive-modal] td')).toHaveCount(0);
});
