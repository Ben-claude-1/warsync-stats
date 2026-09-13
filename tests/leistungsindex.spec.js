import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, fixturePlayers } from './helpers.js';

// Der Leistungsindex in der Anmeldeliste.
//
// Drei Dinge stehen hier auf dem Spiel, und alle drei sind still, wenn sie
// brechen:
//
// * **Je Event normiert.** Die Einzelpunkte hängen am Gegner und an der Woche —
//   am 11.09.2026 holte dieselbe Stammbesetzung 1,99 statt 2,25 Mio. Ungerechnet
//   stünde nach einem schweren Event die ganze Mannschaft schlechter da, ohne
//   dass sich an ihr etwas geändert hätte.
// * **Median, nicht Mittelwert.** In jedem Event steht einer weit oben (9,08 Mio
//   gegen einen Median von 0,91); gegen den Mittelwert gerechnet fiele die halbe
//   Mannschaft künstlich unter 1,0.
// * **Der Eroberer darf nicht durchfallen.** Die Gesamtpunktzahl ist zu 99,8 %
//   die Killpunktzahl — wer Gebäude nimmt, statt zu farmen, steht im Index
//   zwangsläufig unten. GeneralBlücher stand mit 0,74 im unteren Drittel und war
//   trotzdem zweimal bester Eroberer. Die Marke daneben ist das einzige
//   Gegengewicht, das die Mail hergibt.

const SPIELER = fixturePlayers(4);
const [A, B, C, D] = SPIELER.map((p) => p.name);

// Punkte 400/250/150/100 → Median 200, Mittelwert 225. A steht damit bei 2,00
// (gegen den Mittelwert wären es 1,78), D bei 0,50.
const EVENTS = [
  { id: 'ev1', event_date: '2026-09-04', team: 'A', mode: 'ws', time_slot: '13:00',
    our_pts: 300000, opp_pts: 200000, result: 'win',
    mvp_overall: A, mvp_kills: A, mvp_conquest: D, mvp_collect: C },
  // Zweites Event, alle Werte zehnmal so groß: am Index darf sich nichts ändern.
  { id: 'ev2', event_date: '2026-09-11', team: 'A', mode: 'ws', time_slot: '13:00',
    our_pts: 250000, opp_pts: 300000, result: 'loss',
    mvp_overall: A, mvp_kills: A, mvp_conquest: D, mvp_collect: null },
];
const TEILNAHME = [
  ['ev1', A, 400], ['ev1', B, 250], ['ev1', C, 150], ['ev1', D, 100],
  ['ev2', A, 4000], ['ev2', B, 2500], ['ev2', C, 1500], ['ev2', D, 1000],
].map(([ev, name, pts], i) => ({
  id: `p${i}`, event_id: ev, player_name: name, played: true, registered: true,
  individual_pts: pts,
}));

async function anmeldungMitDaten(page) {
  await page.evaluate(({ events, teilnahme }) => {
    window.APP.data.events = events;
    window.APP.data.participation = teilnahme;
    window.nav('ws');
    window.setWSView('anmeldung');
  }, { events: EVENTS, teilnahme: TEILNAHME });
}

// Die Zeile eines Spielers ist das innerste div, das seinen Namen **und** die
// Index-Marke enthält — der Name allein steht auch in einem tieferen div ohne
// die Marken daneben, und ein äußeres enthält die Marken aller Spieler.
function zeile(page, name) {
  return page.locator('#pc div').filter({ hasText: name }).filter({ hasText: '📈' }).last();
}
function marke(page, name, titelTeil) {
  return zeile(page, name).locator(`span[title*="${titelTeil}"]`);
}

test('der Index misst gegen den Median des Events, nicht gegen den Mittelwert', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await anmeldungMitDaten(page);

  await expect(marke(page, A, 'Leistungsindex')).toHaveText('📈 2,00');
  await expect(marke(page, D, 'Leistungsindex')).toHaveText('📈 0,50');
});

test('beide Events zählen, obwohl das zweite zehnmal so große Zahlen trägt', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await anmeldungMitDaten(page);

  await expect(marke(page, A, 'Leistungsindex')).toHaveAttribute('title', /über 2 Events/);
});

test('der beste Eroberer bekommt seine Marke, obwohl er im Index unten steht', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await anmeldungMitDaten(page);

  // D hat die wenigsten Punkte von allen und ist trotzdem zweimal bester Eroberer.
  await expect(marke(page, D, 'Leistungsindex')).toHaveText('📈 0,50');
  await expect(marke(page, D, 'Eroberer')).toHaveText('🏰 2×');
  // Wer nie erobert hat, trägt die Marke nicht — sonst sagte sie nichts aus.
  await expect(marke(page, B, 'Eroberer')).toHaveCount(0);
});

test('auf Englisch stehen Index und Marke englisch da', async ({ page }) => {
  await isolateDb(page);
  await page.addInitScript(() => localStorage.setItem('wsLang', 'en'));
  await page.goto('/index.html');
  await fakeLogin(page, { players: SPIELER });
  await anmeldungMitDaten(page);

  // Der Punkt als Trennzeichen, nicht das Komma — die Zahl folgt der Sprache.
  await expect(marke(page, A, 'erformance index')).toHaveText('📈 2.00');
  await page.evaluate(() => localStorage.removeItem('wsLang'));
});
