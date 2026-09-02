import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Assassinen bewegen sich im Wüstensturm bis zur Öffnung des Silos frei — sie halten
// kein Gebäude. Vorher bekamen sie in Phase 1 denselben Gebäudeplatz wie alle anderen
// und standen als Gast in einer Zone; die Ansage behauptete damit eine Stellung, die
// im Spiel niemand hält.

const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;

// 20 Spieler in Team A. Die Einteilung direkt in den Zustand zu schreiben ist
// derselbe Weg wie in ws_karte_ersatz.spec.js — über die Knöpfe wären es 20 Klicks.
async function aufstellen(page, { silo = 3, arsenal = 1, soeldner = 1 } = {}) {
  return page.evaluate(({ silo, arsenal, soeldner }) => {
    const ta = {};
    for (let i = 1; i <= 20; i++) ta[`Testspieler ${String(i).padStart(2, '0')}`] = 'A';
    window.APP.teamAssign = ta;
    window.APP.team = 'A';
    Object.assign(window.APP.bldSlotsA, { silo, arsenal, soeldner });
    window.autoAssign();
    return {
      ass: window.APP.lineupA.ass,
      ars: window.APP.lineupA.ars,
      sold: window.APP.lineupA.sold,
      bldAssign: { ...window.APP.bldAssign },
      bldAssignPh2: { ...window.APP.bldAssignPh2 },
    };
  }, { silo, arsenal, soeldner });
}

test('Auto-Verteilen gibt Assassinen kein Gebäude', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const st = await aufstellen(page);
  expect(st.ass).toHaveLength(3);

  // Der Kern: kein Assassine steht in bldAssign — weder Phase 1 noch Phase 2.
  for (const n of st.ass) {
    expect(st.bldAssign[n]).toBeUndefined();
    expect(st.bldAssignPh2[n]).toBeUndefined();
  }
  // Gegenprobe: Arsenal und Söldner halten sehr wohl bis Min 10 ein Gebäude.
  // Ohne sie würde der Test auch dann bestehen, wenn niemand mehr eins bekommt.
  for (const n of [...st.ars, ...st.sold]) expect(st.bldAssign[n]).toBeTruthy();

  expect(errors.relevant).toEqual([]);
});

test('Assassinen stehen in keiner Zone, sondern nur in ihrer eigenen Karte', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  const st = await aufstellen(page);

  // Die Zonen-Karten hängen unter „⚙ Erweitert" und sind eingeklappt.
  await page.evaluate(() => { window.APP.wsAdvOpen = true; window.nav('ws'); window.setWSView('aufstellung'); });
  await expect(page.locator('#zone-ass')).toBeVisible();

  for (const n of st.ass) {
    await expect(page.locator('#zone-ass')).toContainText(n);
    for (const z of ['z1', 'z2', 'z3', 'z4']) {
      await expect(page.locator(`#zone-${z}`)).not.toContainText(n);
    }
  }
});

test('Wer in den Assassinen-Slot geschoben wird, gibt sein Gebäude ab', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page);

  const nachher = await page.evaluate(() => {
    const L = window.APP.lineupA;
    const zone = ['z1', 'z2', 'z3', 'z4'].find((z) => (L[z] || []).length);
    const name = L[zone][0];
    const vorher = window.APP.bldAssign[name];
    window.selectChip(name, zone);
    window.dropToZone('ass');
    return {
      name, vorher,
      gebaeude: window.APP.bldAssign[name],
      ph2: window.APP.bldAssignPh2[name],
      istAssassine: window.APP.lineupA.ass.includes(name),
    };
  });

  expect(nachher.vorher).toBeTruthy();       // vorher hielt er ein Gebäude
  expect(nachher.istAssassine).toBe(true);
  expect(nachher.gebaeude).toBeUndefined();
  expect(nachher.ph2).toBeUndefined();
});

test('Umgekehrt: ein Assassine auf einem Gebäude ist keiner mehr', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  const st = await aufstellen(page);

  const nachher = await page.evaluate((name) => {
    window.selectChip(name, 'ass');
    window.dropToBld('z1', 'infozentrum');
    return {
      gebaeude: window.APP.bldAssign[name],
      nochAssassine: window.APP.lineupA.ass.includes(name),
      inZ1: (window.APP.lineupA.z1 || []).includes(name),
    };
  }, st.ass[0]);

  // Ein Assassine mit Gebäude wäre genau der Zustand, den es nicht geben darf:
  // Er wechselt deshalb die Rolle, statt beides zugleich zu sein.
  expect(nachher.nochAssassine).toBe(false);
  expect(nachher.inZ1).toBe(true);
  expect(nachher.gebaeude).toBe('infozentrum');
});

test('Im Phase-1-Bild stehen die Assassinen unter der Karte', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  const st = await aufstellen(page);

  // Das Bild ist das, was in der Allianz gepostet wird — ohne eigenen Streifen
  // fehlten die stärksten Spieler dort in Phase 1 vollständig.
  await page.evaluate(() => window.showWSMap());
  // Auf der Karte selbst sind die Namen gekürzt; der Streifen darunter trägt sie.
  await expect(page.locator('#ws-map-A-p1')).toContainText('kein festes Gebäude');

  const kasten = await page.evaluate(() => {
    const kopf = '⚔ Assassinen — kein festes Gebäude';
    const treffer = [...document.querySelectorAll('#wsm-A div')]
      .map((d) => d.textContent)
      .filter((t) => t.startsWith(kopf) && t.length > kopf.length); // die Kopfzeile selbst raus
    return treffer.sort((a, b) => a.length - b.length)[0] || null;
  });
  expect(kasten).not.toBeNull();
  for (const n of st.ass) expect(kasten).toContain(n);
});

test('Auf Englisch steht der Kasten englisch da', async ({ page }) => {
  await isolateDb(page);
  // Sprache vor dem Laden setzen: der Knopf lädt die Seite neu, das käme dem
  // fakeLogin dazwischen.
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await aufstellen(page);

  await page.evaluate(() => window.showWSMap());
  await expect(page.locator('#wsm-A')).toContainText('⚔ Assassins — no fixed building');
  await expect(page.locator('#wsm-A')).toContainText('free · Silo from min 10');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});
