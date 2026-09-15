import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Der Name ist das, wonach man in der Anmeldeliste sucht — und er war das
// Einzige, was schrumpfen konnte: alles rechts von ihm trug `flex-shrink:0`.
// Am Handy blieben ihm dadurch 22 px von 339 px Zeilenbreite, also zwei
// Zeichen. Sichtbar wurde das erst, als die Zeile voll wurde: sechs Knöpfe
// (seit 'AC'/'BC') plus Stern, Eroberer-, Leistungs-, Aussetzen- und
// Prio-Marke.
//
// Geprüft wird deshalb an dem, was der Nutzer sieht — passt der Name in den
// Platz, den er bekommt —, und ausdrücklich in **beiden** Fenstergrößen: auf
// dem Desktop war er nie abgeschnitten, ein Test nur dort wäre blind gewesen.

// Lang genug, um den Platz zu sprengen, und synthetisch: das Repo ist
// öffentlich, echte Namen der Allianz gehören nicht in den Git-Verlauf.
const SPIELER = [
  { name: 'Ein ziemlich langer Spielername', role: 'R4', hero_power: 187_600_000, active: true, t1: 48, level: 30, stern: true },
  { name: 'Testspieler 1234567889', role: 'R3', hero_power: 149_700_000, active: true, t1: 44, level: 30 },
  { name: 'Kurz', role: 'R3', hero_power: 116_200_000, active: true, t1: 38, level: 30 },
];

// scrollWidth > Breite heißt: der Browser hat gekürzt und ein „…" gesetzt.
const gekuerzt = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#pc [onclick^="openPlayer"]')]
    .filter((el) => el.scrollWidth > Math.ceil(el.getBoundingClientRect().width) + 1)
    .map((el) => el.textContent.trim()));

const namensbreite = (page) => page.evaluate(() =>
  Math.min(...[...document.querySelectorAll('#pc [onclick^="openPlayer"]')]
    .map((el) => el.getBoundingClientRect().width)));

for (const [event, oeffnen] of [
  ['Wüstensturm', () => { window.nav('ws'); window.setWSView('anmeldung'); }],
  ['Schluchtsturm', () => { window.nav('cs'); window.csSetView('anmeldung'); }],
]) {
  test(`${event}: der Name wird von den Knöpfen nicht zusammengedrückt`, async ({ page }) => {
    const errors = collectErrors(page);
    await isolateDb(page);
    await page.goto('/index.html');
    await fakeLogin(page, { players: SPIELER });
    await page.evaluate(oeffnen);

    await expect.poll(() => gekuerzt(page)).toEqual([]);
    // Die Untergrenze fängt den Fall, in dem nichts gekürzt aussieht, weil die
    // Namen der Stichprobe zufällig kurz sind: Platz für rund zwanzig Zeichen
    // muss die Zeile hergeben, sonst stimmt der Zuschnitt nicht mehr.
    expect(await namensbreite(page)).toBeGreaterThan(150);
    expect(errors.relevant).toEqual([]);
  });
}
