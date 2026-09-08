import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors } from './helpers.js';

// Das Schluchtsturm-Übersichtsbild: die Gebäude-Karten in den Seitenspalten dürfen
// nicht unter den Kartenrand rutschen.
//
// Darunter liegt der Kasten „WECHSEL-FAHRPLAN", und der wird nach den Karten
// gezeichnet — eine überstehende Karte wird also von ihm zugedeckt, nicht
// umgekehrt. Getroffen hat es immer die unterste Karte einer Spalte: Probenlager I
// und II stehen beide auf y=398, das zweite wird deshalb grundsätzlich unter das
// erste geschoben. Bei drei Namen darin war der letzte hinter dem Fahrplan.
//
// Gemessen wird an dem, was der Nutzer sieht: kein Text einer Karte darf unterhalb
// der Oberkante des Fahrplan-Kastens liegen.

function spieler(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Testspieler ${String(i + 1).padStart(2, '0')}`,
    role: 'R3', hero_power: (200 - i * 3) * 1_000_000, active: true, t1: 20, level: 30,
  }));
}
const N = (i) => `Testspieler ${String(i).padStart(2, '0')}`;

// Eine volle linke Hälfte, wie sie die Morgenbringer spielen: fünf Startgebäude
// dicht besetzt, dazu Wechsler in Serumfabrik und Verteidigungssystem. Genau diese
// Aufstellung schob das Probenlager II über den Kartenrand hinaus.
const PLAN = {
  [N(1)]: { s: 'dc_w', d: null },
  [N(2)]: { s: 'dc_w', d: 'def_sw' },
  [N(3)]: { s: 'dc_w', d: null },
  [N(4)]: { s: 'dc_w', d: 'def_sw' },
  [N(5)]: { s: 'dc_w', d: 'serum_nw' },
  [N(6)]: { s: 'kraftturm', d: null },
  [N(7)]: { s: 'kraftturm', d: null },
  [N(8)]: { s: 'kraftturm', d: null },
  [N(9)]: { s: 'kraftturm', d: 'serum_nw' },
  [N(10)]: { s: 'lager1', d: null },
  [N(11)]: { s: 'lager1', d: 'def_sw' },
  [N(12)]: { s: 'lager1', d: null },
  [N(13)]: { s: 'lager2', d: null },
  [N(14)]: { s: 'lager2', d: 'serum_nw' },
  [N(15)]: { s: 'lager2', d: null },
  [N(16)]: { s: null, d: 'viruslab' },
  [N(17)]: { s: null, d: 'viruslab' },
  [N(18)]: { s: null, d: 'viruslab' },
  [N(19)]: { s: null, d: 'viruslab' },
  [N(20)]: { s: null, d: 'viruslab' },
};

// Oberkante des Fahrplan-Kastens und alle Texte, die darunter liegen — jeweils mit
// der Karte, zu der sie gehören.
async function verdeckteNamen(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#csmap svg');
    // Der Fahrplan ist das einzige Rechteck, das direkt im SVG auf x=10 sitzt;
    // die Gebäude-Karten stecken jeweils in einer <g>.
    const kasten = [...svg.children].find((e) => e.tagName === 'rect' && +e.getAttribute('x') === 10);
    if (!kasten) return { fehlt: 'Fahrplan-Kasten nicht gefunden' };
    const oben = +kasten.getAttribute('y');
    const treffer = [];
    svg.querySelectorAll('g').forEach((g) => {
      if (!g.querySelector('rect')) return;
      const texte = [...g.querySelectorAll('text')];
      const karte = texte[0] ? texte[0].textContent : '?';
      texte.forEach((t) => {
        if (+t.getAttribute('y') > oben) treffer.push(`${karte}: ${t.textContent}`);
      });
    });
    return { oben, treffer };
  });
}

test('keine Gebäude-Karte rutscht unter den Wechsel-Fahrplan', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  await page.evaluate(({ plan }) => {
    Object.keys(plan).forEach((n) => { window.APP.csTeamAssign[n] = 'A'; });
    window.APP.csTeam = 'A';
    window.APP.csFaction = { A: 'morgen', B: 'morgen' };
    window.APP.csSeite = { A: 'links', B: 'links' };
    window.APP.csPlanA = plan;
    window.APP.csReadyA = true;
    window.APP.csView = 'aufstellung';
    window.nav('cs');
    window.showCSMap();
  }, { plan: PLAN });

  const { fehlt, treffer } = await verdeckteNamen(page);
  expect(fehlt).toBeUndefined();
  expect(treffer, 'diese Texte liegen hinter dem Fahrplan-Kasten').toEqual([]);
  expect(errors.relevant).toEqual([]);
});

// Die Gegenprobe zur Verschiebung: sie darf die Karten nicht übereinanderschieben
// und keine über den oberen Kartenrand hinausdrücken.
test('die Karten einer Spalte bleiben getrennt und im Bild', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: spieler(20) });

  await page.evaluate(({ plan }) => {
    Object.keys(plan).forEach((n) => { window.APP.csTeamAssign[n] = 'A'; });
    window.APP.csTeam = 'A';
    window.APP.csFaction = { A: 'morgen', B: 'morgen' };
    window.APP.csSeite = { A: 'links', B: 'links' };
    window.APP.csPlanA = plan;
    window.APP.csReadyA = true;
    window.APP.csView = 'aufstellung';
    window.nav('cs');
    window.showCSMap();
  }, { plan: PLAN });

  const spalten = await page.evaluate(() => {
    const svg = document.querySelector('#csmap svg');
    const nach = {};
    svg.querySelectorAll('g').forEach((g) => {
      const r = g.querySelector('rect');
      if (!r) return;
      const x = +r.getAttribute('x');
      (nach[x] = nach[x] || []).push({
        label: g.querySelector('text').textContent,
        y: +r.getAttribute('y'), bottom: +r.getAttribute('y') + +r.getAttribute('height'),
      });
    });
    return Object.values(nach).map((s) => s.sort((a, b) => a.y - b.y));
  });

  expect(spalten.length).toBe(2);
  for (const spalte of spalten) {
    expect(spalte[0].y, `${spalte[0].label} steht über dem Kartenrand`).toBeGreaterThanOrEqual(32);
    for (let i = 1; i < spalte.length; i++) {
      expect(spalte[i].y, `${spalte[i].label} überlappt ${spalte[i - 1].label}`)
        .toBeGreaterThanOrEqual(spalte[i - 1].bottom);
    }
  }
});
