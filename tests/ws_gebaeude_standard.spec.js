import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers, ALLIANZ_B } from './helpers.js';

// Die Gebäude-Reihenfolge und die Slots je Gebäude sind die Strategie der Allianz:
// welches Gebäude die stärksten Spieler bekommt und wie viele dort hineinpassen.
// Beides stand dreimal im Quelltext — einmal in core/state.js und zweimal in
// ui/buildings.js. Drei Kopien laufen auseinander, sobald jemand nur eine anfasst.
// Seit dem 03.09.2026 steht die Vorgabe an einer Stelle, und „↺ Standard" in der
// Karte „📋 Gebäude-Strategie" stellt genau sie wieder her.

const STANDARD = [
  'silo', 'oelraf1', 'oelraf2', 'laz1', 'laz3', 'laz2', 'laz4',
  'sciencehub', 'infozentrum', 'arsenal', 'soeldner', 'oelquellen',
];

// Die Strategie-Karte hängt unter „⚙ Erweitert" in der Aufstellung.
async function strategieOeffnen(page) {
  await page.evaluate(() => {
    window.APP.team = 'A';
    window.APP.wsAdvOpen = true;
    window.APP.stratCardOpen = true;
    window.nav('ws');
    window.setWSView('aufstellung');
  });
  await expect(page.getByRole('button', { name: '↺ Standard' })).toBeVisible();
}

// Die Reihenfolge, wie die Karte sie tatsächlich zeigt — über die Zeilennummern
// links, nicht über APP. Sonst prüfte der Test den Zustand gegen sich selbst und
// eine Karte, die aus einer zweiten Liste rendert, fiele nicht auf.
function angezeigteReihenfolge(page) {
  return page.evaluate(() => [...document.querySelectorAll('button[onclick^="moveBldPrio"]')]
    .filter((b) => b.getAttribute('onclick').includes(",-1)"))
    .map((b) => b.getAttribute('onclick').match(/moveBldPrio\('([^']+)'/)[1]));
}

test('Ohne gespeicherten Stand gilt die eingestellte Reihenfolge, nicht die alte Vorgabe', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await strategieOeffnen(page);

  expect(await page.evaluate(() => window.APP.buildingOrder)).toEqual(STANDARD);
  expect(await angezeigteReihenfolge(page)).toEqual(STANDARD);
  expect(errors.relevant).toEqual([]);
});

test('Das Silo steht vorn und bekommt Plätze — Arsenal und Söldnerfabrik keine', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const slots = await page.evaluate(() => ({ a: { ...window.APP.bldSlotsA }, b: { ...window.APP.bldSlotsB } }));
  expect(slots.a.silo).toBe(4);
  expect(slots.a.arsenal).toBe(0);
  expect(slots.a.soeldner).toBe(0);
  expect(slots.a.oelquellen).toBe(0);
  // Team B hält die Ölraffinerien mit vier statt zwei Plätzen — so ist es eingestellt.
  expect(slots.a.oelraf1).toBe(2);
  expect(slots.b.oelraf1).toBe(4);
  expect(slots.b.oelraf2).toBe(4);
});

test('„↺ Standard" stellt eine umsortierte Reihenfolge wieder her', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await strategieOeffnen(page);

  // Solange nichts verschoben wurde, gibt es nichts zurückzusetzen.
  await expect(page.getByRole('button', { name: '↺ Standard' })).toBeDisabled();

  // Das Silo von Platz 1 nach unten schieben.
  await page.evaluate(() => window.moveBldPrio('silo', 1));
  expect(await angezeigteReihenfolge(page)).not.toEqual(STANDARD);
  await expect(page.getByRole('button', { name: '↺ Standard' })).toBeEnabled();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '↺ Standard' }).click();

  expect(await page.evaluate(() => window.APP.buildingOrder)).toEqual(STANDARD);
  expect(await angezeigteReihenfolge(page)).toEqual(STANDARD);
});

test('Ein Abbruch der Rückfrage lässt die Sortierung stehen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await strategieOeffnen(page);

  await page.evaluate(() => window.moveBldPrio('silo', 1));
  const eigene = await page.evaluate(() => window.APP.buildingOrder);

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '↺ Standard' }).click();

  expect(await page.evaluate(() => window.APP.buildingOrder)).toEqual(eigene);
});

// Knopf, Tooltip und Rückfrage müssen auf Englisch ankommen. Die Rückfrage läuft
// nicht über den DOM-Beobachter, sondern über den trs()-Umweg um window.confirm —
// und die Anzeigeschicht faltet dabei jeden Zeilenumbruch zu einem Leerzeichen.
// Steht der Schlüssel mit „\n" in I18N_EN, greift er nie.
test('Auf Englisch stehen Knopf und Rückfrage englisch da', async ({ page }) => {
  await isolateDb(page);
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await page.evaluate(() => {
    window.APP.team = 'A';
    window.APP.wsAdvOpen = true;
    window.APP.stratCardOpen = true;
    window.nav('ws');
    window.setWSView('aufstellung');
    window.moveBldPrio('silo', 1);
  });

  const knopf = page.getByRole('button', { name: '↺ Default' });
  await expect(knopf).toBeVisible();
  await expect(knopf).toHaveAttribute('title', 'Reset the order to the default');

  const frage = await new Promise((fertig) => {
    page.once('dialog', (d) => { fertig(d.message()); d.dismiss(); });
    knopf.click();
  });
  expect(frage).toContain('Reset the building order to the default?');
  expect(frage).toContain('Building slots, lineup and team assignment are left untouched.');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});

// Der Kern der Sache: die Vorgabe wird kopiert, nicht durchgereicht. `changeBldSlot`
// schreibt mit `bs[key]=…` direkt in das Objekt, das `getBldSlots` liefert. Käme dort
// die Vorgabe selbst heraus, veränderte ein Klick auf „+" den Standard für alle Teams
// und alle Allianzen — und die nächste Allianz startete mit fremden Zahlen.
test('Ein Klick auf die Slots verändert die Vorgabe nicht', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  await page.evaluate(() => {
    window.APP.team = 'A';
    window.changeBldSlot('silo', 1);
    window.APP.buildingOrder.push('kaputt');
  });
  // Team B teilt sich die Vorgabe mit Team A und darf davon nichts mitbekommen.
  expect(await page.evaluate(() => window.APP.bldSlotsB.silo)).toBe(4);

  // Und die nächste Allianz startet auf dem Standard, nicht auf den Zahlen der vorigen.
  await page.evaluate((id) => window.switchAlliance(id), ALLIANZ_B.id);
  const nachher = await page.evaluate(() => ({
    silo: window.APP.bldSlotsA.silo,
    order: window.APP.buildingOrder,
  }));
  expect(nachher.silo).toBe(4);
  expect(nachher.order).toEqual(STANDARD);
});
