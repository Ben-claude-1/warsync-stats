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

async function stand(page, { players, teamAssign, priority = [], aussetzen = [], abmeldung = [], participation = [], events = [], fixedCount = null }) {
  await page.evaluate((x) => {
    window.APP.data.players = x.players;
    window.APP.data.priority = x.priority;
    window.APP.data.aussetzen = x.aussetzen;
    window.APP.data.abmeldung = x.abmeldung;
    window.APP.data.participation = x.participation;
    window.APP.data.events = x.events;
    window.APP.teamAssign = x.teamAssign;
    window.APP.wsStrength = 'hero';
    // Die Zahl der festen Plätze gehört der Allianz. Sie hier zu setzen statt
    // den Stepper zu drücken ist Absicht: der Klick schriebe in die Datenbank,
    // und die ist im Test abgeriegelt.
    if (x.fixedCount !== null) {
      window.APP.alliances.find(a => a.id === window.APP.allianceId).ws_fixed_count = x.fixedCount;
    }
    window.nav('ws');
    window.setWSView('verteilung');
    window.zuteilungBerechnen();
  }, { players, teamAssign, priority, aussetzen, abmeldung, participation, events, fixedCount });
}

// Der kommende Freitag, wie ihn getNextFriday() in der App rechnet.
function freitag(page) {
  return page.evaluate(() => {
    const d = new Date(); const add = d.getDay() <= 5 ? 5 - d.getDay() : 6;
    const f = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  });
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

    const t = await textVon(page);
    expect(t).toContain('🧮 Verteilung');
    // 20 gesetzt + 10 Ersatz, der Rest schaut zu — 41 Angemeldete, 30 Plätze.
    expect(t).toContain('20/20 gesetzt · 10/10 Ersatz');
    expect(t).toMatch(/Setzt diesmal aus\s*\n?\s*11 Spieler/);
    // Der fertige Vorschlag hängt an APP.zutVorschlag — daran holt ihn der
    // Einstell-Dienst headless ab, statt die Rechnung nachzubauen.
    const uebergabe = await page.evaluate(() => {
      const v = window.APP.zutVorschlag;
      return v && { soll: Object.keys(v.soll).length, schritte: v.schritte.plan.length };
    });
    expect(uebergabe.soll).toBe(41);
    expect(uebergabe.schritte).toBeGreaterThanOrEqual(0);
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

  test('wer gefehlt hat, setzt aus — aber nicht von einem festen Platz aus', async ({ page }) => {
    // Seit dem 18.09.2026 schlägt der Fixplatz die ⛔-Marke. Geprüft wird
    // deshalb **beides**: dass die Regel unterhalb der festen Plätze weiter
    // greift, und dass sie oberhalb übergangen wird. Nur einer der beiden
    // Fälle wäre eine halbe Prüfung — die Umkehrung wurde ausdrücklich
    // entschieden, sie darf nicht zum Nebeneffekt verkommen.
    const players = kader();
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 15,
      aussetzen: [
        { player_name: 'P02', mode: 'ws', event_date: fr },   // Rang 2 → fester Platz
        { player_name: 'P20', mode: 'ws', event_date: fr },   // Rang 20 → kein fester Platz
      ],
    });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P20');
    expect(raus).toContain('hat beim letzten Mal gefehlt');
    expect(raus).not.toContain('P02');
    // Die übergangene Marke verschwindet nicht — sonst sähe P02 aus wie
    // jemand, der gar nicht gefehlt hat.
    const gesetzt = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'ERSATZ (spielt mit');
    expect(gesetzt).toContain('P02');
    expect(gesetzt).toContain('⛔');
  });

  test('der Regler zieht die Grenze — ohne feste Plätze fliegt derselbe Spieler', async ({ page }) => {
    // Gegenprobe zum Test darüber: mit `fixedCount: 0` gilt wieder die alte
    // Reihenfolge, und P02 setzt trotz seiner Stärke aus. Wäre der Regler
    // wirkungslos, bliebe er auch hier drin.
    const players = kader();
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 0,
      aussetzen: [{ player_name: 'P02', mode: 'ws', event_date: fr }],
    });

    const t = await textVon(page);
    expect(t).toContain('🔒 0 fest');
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P02');
  });

  test('wer sich vorher abgemeldet hat, wird nicht eingeplant — trotz festem Platz', async ({ page }) => {
    // Die Gegenseite zur Regel oben: ohne sie hieße „fest gesetzt" auch „darf
    // folgenlos fehlen". P01 ist der Stärkste des Feldes und hätte damit den
    // ersten festen Platz.
    const players = kader();
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 15,
      abmeldung: [{ player_name: 'P01', mode: 'ws', event_date: fr }],
    });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P01');
    expect(raus).toContain('abgemeldet');
    const gesetzt = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'ERSATZ (spielt mit');
    expect(gesetzt).not.toContain('P01');
    // Und sein Fixplatz verfällt nicht ungenutzt: es sind weiterhin 15.
    // Zählte ein Abwesender mit, bekäme der Nächststärkste keinen.
    expect(t).toContain('🔒 15 fest');
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

  test('frühere C-Runden zählen mit, auch ohne akute Prio-Marke', async ({ page }) => {
    // Wer abwechselnd spielt und zuschaut, steht bei `counter` dauernd auf 0 —
    // über `c_total` wird er trotzdem sichtbar. Beide haben denselben Index;
    // nur P40 hat schon zugeschaut, also muss P39 zuerst gehen.
    const players = kader();
    const namen = players.map(p => p.name);
    const events = [{ id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws' }];
    const participation = [
      { event_id: 'e1', player_name: 'P39', individual_pts: 50, played: true },
      { event_id: 'e1', player_name: 'P40', individual_pts: 50, played: true },
      { event_id: 'e1', player_name: 'P20', individual_pts: 100, played: true },
    ];
    await stand(page, {
      players, teamAssign: anmeldung(namen), events, participation,
      priority: [{ player_name: 'P40', counter: 0, c_total: 3 }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    // Ohne c_total entschiede die Stärke, und der Schwächere von beiden (P40)
    // flöge zuerst. Mit c_total ist er geschützt und P39 geht.
    expect(raus).toContain('P39');
    expect(raus).not.toContain('P40');
  });

  test('die Schnittkante zeigt beide Seiten und keine ⛔-Marke', async ({ page }) => {
    const players = kader();
    const fr = await freitag(page);
    // P20 fehlt und setzt deshalb nach der Regel aus — er hat keinen festen
    // Platz, die Marke wird also vollstreckt. Als Wackelkandidat darf er
    // trotzdem **nicht** auftauchen: eine Regel steht nicht zur Abwägung.
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 15,
      aussetzen: [{ player_name: 'P20', mode: 'ws', event_date: fr }],
    });
    const t = await textVon(page);
    const karte = ausschnitt(t, 'An der Schnittkante', 'Team A · ');
    // Links die Schwächsten, die spielen — rechts die Stärksten, die zuschauen.
    expect(karte).toContain('Schwächste, die spielen');
    expect(karte).toContain('Stärkste, die zuschauen');
    expect(karte).not.toContain('P20');
    // Die Grenze läuft zwischen den beiden Spalten: der schwächste Spielende
    // steht unter den Namen, der stärkste Zuschauende ebenfalls — und beide
    // stammen aus der Mitte des Feldes, nicht von den Rändern.
    expect(karte).toContain('P31');   // letzter Platz vor dem Schnitt (P20 fehlt)
    expect(karte).toContain('P32');   // erster dahinter
    // Ein fester Platz ist keine Wackelkandidatur: er ist eine Einstellung für
    // die ganze Woche, kein Name, den man gegen einen anderen tauscht.
    expect(karte).not.toContain('P01');
  });

  test('ohne ws-Recht gibt es den Reiter nicht', async ({ page }) => {
    await fakeLogin(page, { role: 'R3' });
    await page.evaluate(() => { window.nav('ws'); });
    await expect(page.locator('.stab', { hasText: 'Verteilung' })).toHaveCount(0);
  });
});
