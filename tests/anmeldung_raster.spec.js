import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Die sechs Marken standen als Flex-Kette nebeneinander: fehlte eine, rückte
// jede folgende nach links. Dieselbe Angabe stand damit in keinen zwei Zeilen
// an derselben Stelle — die Liste war nur lesbar, indem man jede Zeile einzeln
// entzifferte, statt eine Spalte hinunterzusehen.
//
// Geprüft wird deshalb genau das, was der Nutzer sieht: **steht jede Marke in
// jeder Zeile an derselben x-Position** — und zwar auch dann, wenn die Zeile
// darüber eine Marke mehr oder weniger trägt.
//
// Der Test ist gegengeprüft: mit der alten Flex-Kette wird er rot (gemessen am
// 16.09.2026 — `📈` stand dort je nach Nachbarn bei x=25, x=72 oder x=104).

// Vier Spieler, die sich in den Marken absichtlich unterscheiden: einer trägt
// alle, einer nur die Leistung, einer nur die Prio, einer fast nichts. Nur so
// fällt auf, wenn eine fehlende Marke die folgenden verschiebt.
const SPIELER = [
  { name: 'Alle Marken', role: 'R4', hero_power: 187_600_000, active: true, t1: 48, level: 30, stern: true },
  { name: 'Nur Leistung', role: 'R3', hero_power: 170_000_000, active: true, t1: 44, level: 30 },
  { name: 'Nur Prio', role: 'R3', hero_power: 160_000_000, active: true, t1: 40, level: 30 },
  { name: 'Fast nichts', role: 'R3', hero_power: 150_000_000, active: true, t1: 38, level: 30 },
];

// Der kommende Freitag, wie ihn getNextFriday() rechnet — ein festes Datum
// hätte die Marken je nach Testtag stumm verschwinden lassen, und der Test
// hätte dann ein Raster ohne sie gemessen.
async function naechsterFreitag(page) {
  return page.evaluate(() => {
    const d = new Date(); const add = d.getDay() <= 5 ? 5 - d.getDay() : 6;
    const f = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  });
}

async function listeAufbauen(page) {
  const FREITAG = await naechsterFreitag(page);
  await page.evaluate((freitag) => {
    window.APP.data.events = [
      { id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws', mvp_conquest: 'Alle Marken' },
    ];
    window.APP.data.participation = [
      { event_id: 'e1', player_name: 'Alle Marken', individual_pts: 4_000_000, played: true },
      { event_id: 'e1', player_name: 'Nur Leistung', individual_pts: 2_000_000, played: true },
      { event_id: 'e1', player_name: 'Fast nichts', individual_pts: 2_000_000, played: true },
    ];
    window.APP.data.priority = [
      { player_name: 'Alle Marken', counter: 12, c_total: 12 },
      { player_name: 'Nur Prio', counter: 3, c_total: 3 },
    ];
    window.APP.data.aussetzen = [
      { player_name: 'Alle Marken', mode: 'ws', event_date: freitag, grund: 'Gefehlt' },
    ];
    // Die Vorab-Abmeldung teilt sich den Rasterplatz mit dem Aussetzen. Beide
    // stehen deshalb in derselben Liste, an verschiedenen Spielern: nur so
    // misst der Test beide Badges gegen dasselbe Spaltenbudget.
    window.APP.data.abmeldung = [
      { player_name: 'Nur Prio', mode: 'ws', event_date: freitag },
    ];
    window.APP.teamAssign = { 'Alle Marken': 'A', 'Nur Leistung': 'A', 'Nur Prio': 'AE' };
    window.nav('ws');
    window.setWSView('anmeldung');
  }, FREITAG);
  await expect(page.locator('#pc [onclick^="openPlayer"]').first()).toBeVisible();
  // Gegenprobe zum Testaufbau selbst: stünden die Marken gar nicht da, prüfte
  // der Test darunter ein Raster aus leeren Zellen und wäre immer grün.
  await expect(page.locator('#pc', { hasText: '⛔ Aussetzen' })).toHaveCount(1);
  await expect(page.locator('#pc', { hasText: '🚫 Abwesend' })).toHaveCount(1);
}

// Die Raster sind die einzigen Grid-Container mit px-Spalten in der Liste.
const raster = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#pc div')]
    .filter((d) => d.style.display === 'grid' && d.style.gridTemplateColumns.includes('px'))
    .map((r) => {
      const rb = r.getBoundingClientRect();
      return {
        name: r.parentElement.querySelector('[onclick^="openPlayer"]')?.textContent.trim(),
        breite: Math.round(rb.width),
        zeile: Math.round(r.parentElement.getBoundingClientRect().width),
        // Auf ganze Pixel gerundet: die Positionen dürfen sich nicht um
        // Marken-Breiten unterscheiden, Subpixel des Layouts sind egal.
        x: [...r.children].map((c) => Math.round(c.getBoundingClientRect().left - rb.left)),
        // Läuft ein Badge über seine Spalte hinaus in die nächste?
        ueber: [...r.children].map((c) => c.scrollWidth - Math.ceil(c.getBoundingClientRect().width)),
      };
    }));

test('jede Marke steht in jeder Zeile an derselben Stelle', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await listeAufbauen(page);

  const zeilen = await raster(page);
  expect(zeilen.length).toBeGreaterThanOrEqual(SPIELER.length);

  // Der eigentliche Punkt: identische Spaltenpositionen über alle Zeilen — auch
  // über die, denen die vorderen Marken fehlen.
  const ersteZeile = zeilen[0].x;
  expect(ersteZeile).toHaveLength(6);
  for (const z of zeilen) {
    expect(z.x, `Marken-Positionen der Zeile „${z.name}"`).toEqual(ersteZeile);
  }

  // Die Positionen müssen echte Abstände haben. Ohne das wäre ein Raster aus
  // sechs Nullspalten ebenfalls „überall gleich" und der Test wertlos.
  for (let i = 1; i < ersteZeile.length; i++) {
    expect(ersteZeile[i]).toBeGreaterThan(ersteZeile[i - 1]);
  }
  expect(errors.relevant).toEqual([]);
});

test('das Raster passt in die Zeile, auch am Handy', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await listeAufbauen(page);

  for (const z of await raster(page)) {
    // Am Handy stehen dem Raster nur 339 px zur Verfügung; ein erster Anlauf
    // mit großzügigen Slots kam auf 358 px und lief rechts aus der Zeile.
    expect(z.breite, `Rasterbreite in „${z.name}"`).toBeLessThanOrEqual(z.zeile);
    // Und kein Badge darf in die Nachbarspalte hineinlaufen — sonst stimmt die
    // Position zwar, die Anzeige aber nicht.
    for (const u of z.ueber) expect(u).toBeLessThanOrEqual(0);
  }
});
