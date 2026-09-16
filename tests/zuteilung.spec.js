import { expect, test } from '@playwright/test';
import { fakeLogin, isolateDb } from './helpers.js';

// Der Reiter „🧮 Verteilung" schlägt vor, wer diesmal zuschaut. Geprüft wird
// nicht die Optik, sondern die vier Aussagen, an denen der Vorschlag hängt:
// dass die Plätze aufgehen, dass die Regeln in der richtigen Reihenfolge
// greifen, dass ein Ersatz-Wunsch die Rangfolge schlägt — und dass die
// Schrittliste im Spiel überhaupt bedienbar ist, also nie einen vollen Topf
// überläuft.

// 41 Spieler: genug, dass beide Listen überlaufen und ausgeschlossen werden
// muss. Die Werte sind gestaffelt, damit jede Regel eine sichtbare Wirkung hat.
function kader() {
  const out = [];
  for (let i = 0; i < 41; i++) {
    out.push({
      name: `P${String(i + 1).padStart(2, '0')}`,
      role: 'R3', active: true, level: 30, t1: 40,
      hero_power: (200 - i * 2) * 1e6,
      stern: false, ersatz_wunsch: false,
    });
  }
  return out;
}

// Alle in eine Zeit: 41 Kandidaten auf 30 Plätze → 11 müssen aussetzen.
function anmeldung(namen) {
  const ta = {};
  namen.forEach((n, i) => { ta[n] = i < 20 ? 'A' : i < 30 ? 'AE' : 'AC'; });
  return ta;
}

async function stand(page, { players, teamAssign, priority = [], aussetzen = [], participation = [], events = [] }) {
  await page.evaluate((x) => {
    window.APP.data.players = x.players;
    window.APP.data.priority = x.priority;
    window.APP.data.aussetzen = x.aussetzen;
    window.APP.data.participation = x.participation;
    window.APP.data.events = x.events;
    window.APP.teamAssign = x.teamAssign;
    window.APP.wsStrength = 'hero';
    window.nav('ws');
    window.setWSView('verteilung');
    window.zuteilungBerechnen();
  }, { players, teamAssign, priority, aussetzen, participation, events });
}

function textVon(page) { return page.locator('#pc').innerText(); }

// Nur der Kasten „Setzt diesmal aus" — ohne die Grenze nach unten stünde die
// ganze Schrittliste mit im Ausschnitt, und dort kommt **jeder** Name vor. Ein
// Test, der darauf prüft, ist immer grün (gemessen am 16.09.2026).
function ausschnitt(t, von, bis) {
  const a = t.indexOf(von);
  if (a < 0) return '';
  const b = bis ? t.indexOf(bis, a) : -1;
  return t.slice(a, b < 0 ? undefined : b);
}

test.describe('Verteilungs-Vorschlag', () => {
  test.beforeEach(async ({ page }) => {
    await isolateDb(page);
    await page.goto('/index.html');
    await fakeLogin(page);
  });

  test('die Plätze gehen auf und der Überhang setzt aus', async ({ page }) => {
    const players = kader();
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)) });

    const soll = await page.evaluate(() => window.APP.__zutProbe);
    const t = await textVon(page);
    expect(t).toContain('🧮 Verteilung');
    // 20 gesetzt + 10 Ersatz, der Rest schaut zu — 41 Angemeldete, 30 Plätze.
    expect(t).toContain('20/20 gesetzt · 10/10 Ersatz');
    expect(t).toMatch(/Setzt diesmal aus\s*\n?\s*11 Spieler/);
    expect(soll).toBeUndefined();   // nichts am APP-Zustand hinterlassen
  });

  test('ein Ersatz-Wunsch schlägt die Stärke', async ({ page }) => {
    const players = kader();
    players[0].ersatz_wunsch = true;              // der Stärkste will auf die Bank
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)) });

    const t = await textVon(page);
    const gesetzt = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'ERSATZ (spielt mit');
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', 'Setzt diesmal aus');
    expect(gesetzt).not.toContain('P01');
    expect(ersatz).toContain('P01');
  });

  test('wer gefehlt hat, setzt aus — auch wenn er stark ist', async ({ page }) => {
    const players = kader();
    const freitag = await page.evaluate(() => {
      const d = new Date(); const add = d.getDay() <= 5 ? 5 - d.getDay() : 6;
      const f = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
      return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    });
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      aussetzen: [{ player_name: 'P02', mode: 'ws', event_date: freitag }],
    });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P02');
    expect(raus).toContain('hat beim letzten Mal gefehlt');
  });

  test('die Schrittliste läuft keinen Topf über', async ({ page }) => {
    // Umgekehrt angemeldet: die Schwächsten stehen gesetzt, die Stärksten
    // schauen zu. So muss der Plan wirklich umbauen — mit der geordneten
    // Anmeldung wäre der Vorschlag deckungsgleich und die Liste leer.
    const players = kader();
    await stand(page, { players, teamAssign: anmeldung([...players.map(p => p.name)].reverse()) });
    const t = await textVon(page);
    const schritte = ausschnitt(t, 'In Last War einstellen');
    // Hinter jedem Schritt stehen die vier Zähler. Keiner darf über seine
    // Grenze gehen — sonst nimmt das Spiel den Schritt gar nicht erst an.
    const zahlen = [...schritte.matchAll(/A (\d+)\/20 · AE (\d+)\/10 · B (\d+)\/20 · BE (\d+)\/10/g)];
    expect(zahlen.length).toBeGreaterThan(0);
    for (const m of zahlen) {
      expect(Number(m[1])).toBeLessThanOrEqual(20);
      expect(Number(m[2])).toBeLessThanOrEqual(10);
      expect(Number(m[3])).toBeLessThanOrEqual(20);
      expect(Number(m[4])).toBeLessThanOrEqual(10);
    }
    // Und am Ende steht die Zielbesetzung vollständig da.
    const letzte = zahlen[zahlen.length - 1];
    expect(Number(letzte[1])).toBe(20);
    expect(Number(letzte[2])).toBe(10);
    // Kein Zug darf liegenbleiben. Genau das passierte am 16.09.2026: die
    // Abbruchbremse rechnete mit der **schrumpfenden** Restliste, und bei 39
    // Zügen blieben drei übrig — Team B stand danach auf 19/20.
    expect(schritte).not.toContain('lassen sich nicht einsortieren');
  });

  test('eine Prio-Marke schützt an der Grenze, nicht darunter', async ({ page }) => {
    // Gegenprobe zum Fehler vom 16.09.2026: als die Prio absolut schützte,
    // flog ein 133-Mio-Spieler heraus und ein 101-Mio-Spieler blieb.
    const players = kader();
    const namen = players.map(p => p.name);
    const events = [{ id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws' }];
    // Der Schwächste hat eine Prio-Marke **und** den schlechtesten Index —
    // der halbe Bonus darf ihn nicht über einen doppelt so guten heben.
    const participation = [
      { event_id: 'e1', player_name: 'P41', individual_pts: 10, played: true },
      { event_id: 'e1', player_name: 'P40', individual_pts: 100, played: true },
      { event_id: 'e1', player_name: 'P39', individual_pts: 100, played: true },
    ];
    await stand(page, {
      players, teamAssign: anmeldung(namen), events, participation,
      priority: [{ player_name: 'P41', counter: 1, c_total: 1 }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P41');
  });

  test('die Schnittkante zeigt beide Seiten und keine ⛔-Marke', async ({ page }) => {
    const players = kader();
    const freitag = await page.evaluate(() => {
      const d = new Date(); const add = d.getDay() <= 5 ? 5 - d.getDay() : 6;
      const f = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
      return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    });
    // P05 fehlt und setzt deshalb nach der Regel aus — er darf **nicht** als
    // Wackelkandidat auftauchen: eine Regel steht nicht zur Abwägung.
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      aussetzen: [{ player_name: 'P05', mode: 'ws', event_date: freitag }],
    });
    const t = await textVon(page);
    const karte = ausschnitt(t, 'An der Schnittkante', 'Team A · ');
    // Links die Schwächsten, die spielen — rechts die Stärksten, die zuschauen.
    expect(karte).toContain('Schwächste, die spielen');
    expect(karte).toContain('Stärkste, die zuschauen');
    expect(karte).not.toContain('P05');
    // Die Grenze läuft zwischen den beiden Spalten: der schwächste Spielende
    // steht unter den Namen, der stärkste Zuschauende ebenfalls — und beide
    // stammen aus der Mitte des Feldes, nicht von den Rändern.
    expect(karte).toContain('P30');   // letzter Platz vor dem Schnitt
    expect(karte).toContain('P31');   // erster dahinter
  });

  test('ohne ws-Recht gibt es den Reiter nicht', async ({ page }) => {
    await fakeLogin(page, { role: 'R3' });
    await page.evaluate(() => { window.nav('ws'); });
    await expect(page.locator('.stab', { hasText: 'Verteilung' })).toHaveCount(0);
  });
});
