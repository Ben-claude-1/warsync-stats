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

  // Alle Spieler des Ausschluss-Kreises (P16…P41, denn P01…P15 sind fest) auf
  // denselben Rotationsstand setzen. Nur so lässt sich eine einzelne Regel
  // isolieren: steht einer allein auf einer anderen Stufe, entscheidet sie ihn.
  function alleGleich(cTotal, ausnahmen = {}) {
    const out = [];
    for (let i = 16; i <= 41; i++) {
      const n = `P${String(i).padStart(2, '0')}`;
      out.push({ player_name: n, counter: 0, c_total: ausnahmen[n] ?? cTotal });
    }
    return out;
  }

  test('die Rotation schlägt den Index — auch wenn sie die Mannschaft schwächt', async ({ page }) => {
    // **Umkehrung der Regel vom 16.09.2026.** Damals stand hier das Gegenteil:
    // ein Fairness-Bonus durfte die Rangfolge nicht drehen, weil er sonst die
    // Mannschaft schwächt. Am 30.09.2026 hat Ben das umgestellt — nachdem
    // Carmen0804, Stalker24601 und KiLLuminaTi zum dritten Mal in Folge
    // zugeschaut hätten, während 39 von 73 Angemeldeten noch nie dran waren.
    //
    // P41 ist der Schwächste **und** hat den schlechtesten Index. Er hat aber
    // einmal zugeschaut und alle anderen nie — also bleibt er drin.
    const players = kader();
    const namen = players.map(p => p.name);
    const events = [{ id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws' }];
    const participation = [
      { event_id: 'e1', player_name: 'P41', individual_pts: 10, played: true },
      { event_id: 'e1', player_name: 'P40', individual_pts: 100, played: true },
      { event_id: 'e1', player_name: 'P39', individual_pts: 100, played: true },
    ];
    await stand(page, {
      players, teamAssign: anmeldung(namen), events, participation,
      priority: [{ player_name: 'P41', counter: 0, c_total: 1 }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    // Mit der alten Regel (Index vorn, C-Runde als +0,2-Bonus) stand P41 hier
    // drin: 0,10 + 0,2 gegen 1,00 der Übrigen. Genau das ist die Gegenprobe.
    expect(raus).not.toContain('P41');
    expect(raus).toContain('P40');
  });

  test('wer öfter zugeschaut hat, bleibt drin — egal wie stark der andere ist', async ({ page }) => {
    // Wer abwechselnd spielt und zuschaut, steht bei `counter` dauernd auf 0 —
    // deshalb hängt die Rotation an `c_total`. Beide haben denselben Index;
    // nur P40 hat schon zugeschaut, also muss P39 gehen.
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
    expect(raus).toContain('P39');
    expect(raus).not.toContain('P40');
  });

  test('ein Stern überspringt keine ganze Runde', async ({ page }) => {
    // Die Hälfte der Vorgabe vom 30.09.2026: „auch die mit einem Stern sollen
    // ein klein wenig öfter aufgestellt werden" — **ein klein wenig**, nicht
    // ausgenommen. Alle im Kreis haben einmal zugeschaut, nur P20 nie. Er
    // trägt den Stern und den besten Index des Feldes und geht trotzdem: ein
    // halber Schritt holt keine ganze Runde auf.
    const players = kader();
    players.find(p => p.name === 'P20').stern = true;
    const namen = players.map(p => p.name);
    const events = [{ id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws' }];
    const participation = [
      { event_id: 'e1', player_name: 'P20', individual_pts: 400, played: true },
      { event_id: 'e1', player_name: 'P21', individual_pts: 100, played: true },
      { event_id: 'e1', player_name: 'P22', individual_pts: 100, played: true },
    ];
    await stand(page, {
      players, teamAssign: anmeldung(namen), events, participation,
      priority: alleGleich(1, { P20: 0 }),
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    // Wäre ZUT_STERN_ROT ≥ 1, stünde P20 mit Rotationsstand 1,0 gleichauf und
    // sein Index 4,0 hielte ihn drin. Der Test wird dann rot — so ist er die
    // Gegenprobe zur Größe der Zahl, nicht nur zu ihrer Existenz.
    expect(raus).toContain('P20');
  });

  test('ein Stern geht innerhalb seiner Stufe als Letzter', async ({ page }) => {
    // Die andere Hälfte: bei **gleichem** Rotationsstand zieht der Stern vor.
    // P41 ist der Schwächste des Feldes und hätte ohne Stern sicher zugeschaut.
    const players = kader();
    players.find(p => p.name === 'P41').stern = true;
    const namen = players.map(p => p.name);
    await stand(page, {
      players, teamAssign: anmeldung(namen), priority: alleGleich(1),
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).not.toContain('P41');
    expect(raus).toContain('P40');
  });

  // Historie für die Bank-Rotation. Je Runde ein WS-Event, und **alle**
  // Beteiligten bekommen dieselbe Punktzahl: damit ist ihr Leistungsindex
  // gleich 1,0 wie der der Unbeteiligten, und der Test prüft die Bank-Regel
  // allein. Mit verschiedenen Punkten prüfte er zwei Regeln auf einmal, und bei
  // Rot wüsste man nicht, welche.
  //   histo([{ P16:'ges', P30:'bank' }, …])
  function histo(runden) {
    const events = [], participation = [];
    runden.forEach((r, i) => {
      const id = 'h' + i;
      events.push({ id, event_date: `2026-08-1${i}`, team: 'A', mode: 'ws' });
      Object.entries(r).forEach(([name, rolle]) => {
        participation.push({
          event_id: id, player_name: name, individual_pts: 100, played: true,
          substitute: rolle === 'bank',
        });
      });
    });
    return { events, participation };
  }

  test('die Bank rotiert über die Historie, nicht über die Stärke', async ({ page }) => {
    // Vorgabe Ben, 30.09.2026: „jeder Spieler gleichermaßen in der
    // Startaufstellung und Ersatzbank". Vorher besetzte die Kraft die Bank, und
    // über vier echte WS-Tage hieß das: 42 von 89 Spielern nie auf der Bank,
    // 20 ausschließlich dort.
    //
    // P16 ist der stärkste **ohne** festen Platz und hatte dreimal die
    // Aufstellung; P30 ist schwächer und saß dreimal auf der Bank. Nach Kraft
    // wäre P16 gesetzt und P30 Ersatz — nach der Historie umgekehrt.
    const players = kader();
    const namen = players.map(p => p.name);
    const h = histo([
      { P16: 'ges', P30: 'bank' },
      { P16: 'ges', P30: 'bank' },
      { P16: 'ges', P30: 'bank' },
    ]);
    await stand(page, { players, teamAssign: anmeldung(namen), ...h });
    const t = await textVon(page);
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus');
    const aufstellung = ausschnitt(t, 'GESETZT (bekommt', 'ERSATZ (spielt mit');
    expect(ersatz).toContain('P16');
    expect(ersatz).not.toContain('P30');
    expect(aufstellung).toContain('P30');
  });

  test('ein fester Platz rotiert nicht auf die Bank', async ({ page }) => {
    // Entscheidung Ben, 30.09.2026: „fest gesetzt" heißt fest **in der
    // Aufstellung**. P01 ist der Stärkste und hatte viermal die Aufstellung —
    // nach der Bank-Rotation allein wäre er als erster dran.
    const players = kader();
    const namen = players.map(p => p.name);
    const h = histo([{ P01: 'ges' }, { P01: 'ges' }, { P01: 'ges' }, { P01: 'ges' }]);
    await stand(page, { players, teamAssign: anmeldung(namen), ...h });
    let t = await textVon(page);
    expect(ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus')).not.toContain('P01');

    // Gegenprobe am Regler: ohne feste Plätze greift die Rotation auch bei ihm.
    // Ohne diese Hälfte wäre nicht belegt, dass es am Fixplatz hängt und nicht
    // etwa an der Kraft.
    await stand(page, { players, teamAssign: anmeldung(namen), ...h, fixedCount: 0 });
    t = await textVon(page);
    expect(ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus')).toContain('P01');
  });

  test('der Stern zählt auf der Bank erst bei gleicher Historie — nicht vor ihr', async ({ page }) => {
    // Beide Hälften von „ein klein wenig öfter aufgestellt" in einem Bild —
    // und so gebaut, dass er die **Stelle** des Sterns festnagelt, nicht nur
    // seine Existenz.
    //
    // Aufbau: acht Spieler mit vier Einsätzen gehen vor allen anderen; danach
    // P19 und P20 mit *derselben* Historie (dreimal Aufstellung, nie Bank), von
    // denen nur P20 den Stern trägt; zuletzt fünf, die noch nie gespielt haben.
    // Zehn der fünfzehn Freien gehen auf die Bank — die Kante liegt damit genau
    // hinter P20.
    //
    // - **P19 vor P20**: bei gleicher Historie zieht der Stern vor, und der
    //   Vorzug ist genau einen Platz groß.
    // - **P20 trotzdem vor den Neuzugängen**: der Stern überspringt die Ordnung
    //   nach Einsätzen *nicht*. Wer dreimal ein Gebäude hatte, geht vor jemandem,
    //   der noch nie eines hatte — auch mit Stern.
    //
    // **Das ist die Gegenprobe zur Stelle des Sterns.** Im ersten Entwurf stand
    // er als halber Schritt im ersten Schlüssel; dann ist P20 mit 0,5 größer als
    // ein Neuzugang mit 0, rutscht hinter alle fünf und bleibt in der
    // Aufstellung — die letzten drei Zusicherungen werden rot. Ein Aufbau mit
    // *neun* Vorgängern hätte das **nicht** gemerkt: dort füllt P19 den letzten
    // Bankplatz, und beide Fassungen liefern dasselbe Bild. Genau so stand der
    // Test zuerst da, und die Gegenprobe lief ins Leere.
    const players = kader();
    players.find(p => p.name === 'P20').stern = true;
    const namen = players.map(p => p.name);
    const vorne = ['P16', 'P17', 'P18', 'P22', 'P23', 'P24', 'P25', 'P26'];
    const ges = (...wer) => Object.fromEntries(wer.map(n => [n, 'ges']));
    const h = histo([
      { ...ges(...vorne), ...ges('P19', 'P20') },
      { ...ges(...vorne), ...ges('P19', 'P20') },
      { ...ges(...vorne), ...ges('P19', 'P20') },
      ges(...vorne),
    ]);
    await stand(page, { players, teamAssign: anmeldung(namen), ...h });
    const t = await textVon(page);
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus');
    const aufstellung = ausschnitt(t, 'GESETZT (bekommt', 'ERSATZ (spielt mit');
    expect(ersatz).toContain('P19');          // gleiche Historie, kein Stern → zuerst
    expect(ersatz).toContain('P20');          // der Stern geht auch, nur später
    expect(aufstellung).toContain('P30');     // wer nie gespielt hat, bleibt drin
    expect(aufstellung).toContain('P21');
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

  // ── „In die Anmeldung übernehmen" (24.09.2026) ────────────────────────────
  // Geprüft wird nicht der Knopf, sondern die beiden Aussagen, die ihn von
  // einem stillen „übernehmen" unterscheiden: dass die Anmeldung danach den
  // Vorschlag trägt **und** dass die Schrittliste stehen bleibt. Fiele sie weg,
  // stünde im Werkzeug die Wunsch-Einteilung und niemand wüsste mehr, was im
  // Spiel noch zu tun ist — genau die Verwechslung, gegen die der Reiter gebaut
  // ist.
  test('der Knopf schreibt den Vorschlag in die Anmeldung — und die Schritte bleiben stehen', async ({ page }) => {
    page.on('dialog', d => d.accept());
    const players = kader();
    // Umgekehrt angemeldet: so muss wirklich umgebaut werden.
    await stand(page, { players, teamAssign: anmeldung([...players.map(p => p.name)].reverse()) });

    const vorher = await textVon(page);
    const schritteVorher = ausschnitt(vorher, 'In Last War einstellen');
    expect(schritteVorher).toContain('/20 · AE');

    // Geklickt statt aufgerufen: so ist auch geprüft, dass der Knopf da ist und
    // im globalen Namensraum hängt — ein `onclick` auf einen Namen, den
    // app/globals.js nicht zurücklegt, fällt sonst erst im Betrieb auf.
    await page.locator('button', { hasText: 'Vorschlag in die Anmeldung übernehmen' }).click();

    // 1. Die Anmeldung trägt jetzt den Vorschlag, Topf für Topf.
    const stand2 = await page.evaluate(() => {
      const ta = window.APP.teamAssign, soll = window.APP.zutVorschlag.soll;
      const zahl = w => Object.values(ta).filter(v => v === w).length;
      return {
        A: zahl('A'), AE: zahl('AE'),
        abweichend: Object.entries(soll).filter(([n, w]) => ta[n] !== w).length,
      };
    });
    expect(stand2.A).toBe(20);
    expect(stand2.AE).toBe(10);
    expect(stand2.abweichend).toBe(0);

    // 2. Die Schrittliste bleibt — sie rechnet gegen den Stand von vor dem
    //    Übernehmen, nicht gegen die eben geschriebene Anmeldung.
    const nachher = await textVon(page);
    expect(nachher).toContain('✍ Übernommen');
    const schritteNachher = ausschnitt(nachher, 'In Last War einstellen');
    expect(schritteNachher).not.toContain('Nichts zu tun');
    expect(schritteNachher).toContain('/20 · AE');
  });

  test('ein Ausgeschlossener behält beide gemeldeten Uhrzeiten', async ({ page }) => {
    // `soll` kennt nur AC/BC — die Rechnung steckt jeden in genau eine
    // Zeitliste. Wer sich für beide gemeldet hat ('ABC'), verlöre beim
    // Übernehmen die Hälfte seiner Auskunft, und ausgerechnet die ist beim
    // Nachrücken die nützlichste.
    page.on('dialog', d => d.accept());
    const players = [];
    for (let i = 0; i < 63; i++) {
      players.push({
        name: `P${String(i + 1).padStart(2, '0')}`,
        role: 'R3', active: true, level: 30, t1: 40,
        hero_power: (200 - i * 2) * 1e6, stern: false, ersatz_wunsch: false,
      });
    }
    // Beide Zeiten voll belegt, dazu der Schwächste des Feldes für **beide**
    // gemeldet: er fliegt heraus und ist damit der Fall, um den es geht.
    const ta = {};
    players.slice(0, 31).forEach((p, i) => { ta[p.name] = i < 20 ? 'A' : i < 30 ? 'AE' : 'AC'; });
    players.slice(31, 62).forEach((p, i) => { ta[p.name] = i < 20 ? 'B' : i < 30 ? 'BE' : 'BC'; });
    ta['P63'] = 'ABC';
    await stand(page, { players, teamAssign: ta });

    // Der Vorschlag selbst schließt ihn aus — sonst prüfte der Test nichts.
    expect(await page.evaluate(() => window.APP.zutVorschlag.soll['P63'])).toMatch(/^[AB]C$/);

    await page.evaluate(() => window.zuteilungUebernehmen());
    expect(await page.evaluate(() => window.APP.teamAssign['P63'])).toBe('ABC');
  });

  test('ohne ws-Recht gibt es den Reiter nicht', async ({ page }) => {
    await fakeLogin(page, { role: 'R3' });
    await page.evaluate(() => { window.nav('ws'); });
    await expect(page.locator('.stab', { hasText: 'Verteilung' })).toHaveCount(0);
  });
});
