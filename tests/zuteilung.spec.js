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

  test('wer auf die Bank will, belegt keinen festen Platz — der Nächste rückt nach', async ({ page }) => {
    // Vorgabe Ben, 05.11.2026, am Fall Longrow/Mika Pika: der Viertstärkste in
    // Team B wollte auf die Bank und belegte trotzdem einen der zehn Fixplätze.
    // Hier will der Stärkste (P01) auf die Bank; bei zehn Fixplätzen muss damit
    // P11 fest sein und P01 nicht. Gegengeprüft: mit der alten Zählung wird
    // der Test rot.
    const players = kader();
    players[0].ersatz_wunsch = true;
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)), fixedCount: 10 });
    const t = await textVon(page);
    const marken = n => (t.match(new RegExp(`\\n${n}\\n([^\\n]*)`)) || [])[1] || '';
    expect(marken('P11')).toContain('🔒');
    expect(marken('P01')).not.toContain('🔒');
    expect(marken('P12')).not.toContain('🔒');
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

  test('die ⛔-Marke greift nur, wenn die Plätze nicht reichen', async ({ page }) => {
    // Vorgabe Ben, 02.11.2026: wer gefehlt hat, setzt nur aus, wenn sonst
    // jemand anderes zuschauen müsste. Bei 25 Anmeldungen auf 30 Plätze spielt
    // er — vorher flog er vorab heraus und ein Platz blieb leer.
    const players = kader().slice(0, 25);
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 0,
      aussetzen: [{ player_name: 'P20', mode: 'ws', event_date: fr }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).not.toContain('P20');
    const drin = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'Setzt diesmal aus');
    expect(drin).toContain('P20');
  });

  test('im Überhang trifft die ⛔-Marke zuerst, nicht der Schwächste', async ({ page }) => {
    // 41 auf 30: elf müssen raus. P05 ist stark und hätte ohne Marke einen
    // sicheren Platz — mit Marke geht er vor dem Schwächsten.
    const players = kader();
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)),
      fixedCount: 0,
      aussetzen: [{ player_name: 'P05', mode: 'ws', event_date: fr }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P05');
    expect(raus).toMatch(/11 Spieler/);
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

  test('ein Zweitaccount hält kein Gebäude, solange sein Hauptaccount spielt', async ({ page }) => {
    // Zwei Zeilen im Werkzeug, ein Mensch im Spiel (Vorgabe Ben, 30.09.2026).
    // P01 und P02 sind die beiden Stärksten und stünden beide gesetzt — und
    // beide auf einem der wertvollen Gebäude, denn die gehen nach Stärke. Ein
    // Mensch kann in der Schlacht aber nur einen Account führen; das zweite
    // Gebäude stünde leer.
    //
    // Geprüft wird ausdrücklich die **Richtung**: auf die Bank geht der
    // Zweitaccount, nicht der Hauptaccount. Ein Test, der nur „nicht beide
    // gesetzt" verlangt, wäre auch grün, wenn es den Falschen trifft.
    const players = kader();
    players[1].zweitaccount_von = 'P01';
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)), fixedCount: 15 });

    const t = await textVon(page);
    const gesetzt = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'ERSATZ (spielt mit');
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', 'Setzt diesmal aus');
    expect(gesetzt).toContain('P01');
    expect(gesetzt).not.toContain('P02');
    expect(ersatz).toContain('P02');
    // Er ist **kein** Ausschluss — im Wüstensturm spielen alle 30 mit.
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).not.toContain('P02');
  });

  test('beide spielen oder keiner — die Einheit trägt den besseren Schutz', async ({ page }) => {
    // Vorgabe Ben, 30.09.2026: „es sollen immer beide spielen oder keiner von
    // beiden." P41 ist der schwächste des Feldes und flöge als erster; als
    // Zweitaccount des **stärksten** (P01) bleibt er drin, denn der Mensch
    // dahinter spielt. Stattdessen geht der nächste Einzelne.
    //
    // Die Richtung ist die eigentliche Aussage: trüge die Einheit den
    // *schwächeren* Schutz, kippte ein schwacher Zweitaccount den festen Platz
    // seines Hauptaccounts — die Regel schlüge dann ins Gegenteil um.
    const players = kader();
    players[40].zweitaccount_von = 'P01';
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)), fixedCount: 15 });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).not.toContain('P41');
    expect(raus).toContain('P30');          // rückt an seine Stelle
    // Er spielt mit, aber ohne Gebäude — sein Hauptaccount hält schon eines.
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', 'Setzt diesmal aus');
    expect(ersatz).toContain('P41');
  });

  test('eine Einheit macht zwei Plätze frei — einer rückt nach', async ({ page }) => {
    // Der Sonderfall, den die Kopplung erzeugt: fällt ein Paar an der
    // Schnittkante, sind auf einen Schlag zwei Plätze weg statt einem. Ohne das
    // Nachrücken bliebe einer leer, während jemand zuschaut, der ihn haben
    // könnte — 29 statt 30, und das fiele erst im Spiel auf.
    const players = kader();
    players[30].zweitaccount_von = 'P30';   // P31 hängt an P30, beide an der Kante
    await stand(page, { players, teamAssign: anmeldung(players.map(p => p.name)), fixedCount: 15 });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P30');
    expect(raus).toContain('P31');
    // P32 wäre sonst draußen — er rückt in den frei gewordenen zweiten Platz.
    expect(raus).not.toContain('P32');
  });

  test('eine Abmeldung gilt dem Menschen, nicht dem Account', async ({ page }) => {
    // Sie darf an dem Account stehen, an dem sie jemandem einfällt — deshalb
    // wirkt sie in **beide** Richtungen. Geprüft wird hier die schwierigere:
    // die Marke steht am Zweitaccount, ausfallen muss auch der Hauptaccount.
    // Stünde nur die eine Richtung im Code, rückte der andere Account nach und
    // die Aufstellung vergäbe ein Gebäude an jemanden, der nicht da ist.
    const players = kader();
    players[1].zweitaccount_von = 'P01';
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(players.map(p => p.name)), fixedCount: 15,
      abmeldung: [{ player_name: 'P02', mode: 'ws', event_date: fr }],
    });

    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P01');
    expect(raus).toContain('P02');
    const gesetzt = ausschnitt(t, 'GESETZT (bekommt ein Gebäude)', 'ERSATZ (spielt mit');
    expect(gesetzt).not.toContain('P01');
    expect(gesetzt).not.toContain('P02');
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

  // Die zweite Hälfte desselben Kniffs, nötig seit dem 16.10.2026: der
  // Rotationsstand ist **Anmeldungen + Ausschlüsse**, und die Anmeldungen
  // kommen aus `ws_participation`. Ohne gleiche Einsatzzahl im Kreis prüft ein
  // Rotations-Test die Aktivität statt die Regel, die er meint — wer gar keine
  // Teilnahme-Zeile hat, steht bei 0 und fliegt vor jedem mit einer.
  //
  // Ein Einsatz je Spieler, alle mit derselben Punktzahl: damit ist auch der
  // Leistungsindex für alle 1,0 und bleibt aus dem Spiel. `punkte` setzt
  // einzelne davon ab, wo ein Test den Index braucht.
  function gleichAktiv(punkte = {}) {
    const events = [{ id: 'g1', event_date: '2026-09-11', team: 'A', mode: 'ws' }];
    const participation = [];
    for (let i = 16; i <= 41; i++) {
      const n = `P${String(i).padStart(2, '0')}`;
      participation.push({
        event_id: 'g1', player_name: n, played: true,
        individual_pts: punkte[n] ?? 100,
      });
    }
    return { events, participation };
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
    //
    // `gleichAktiv` hält die Anmeldungen im Kreis gleich (seit 16.10.2026, sonst
    // entschiede die Aktivität); P41 bekommt dabei die 10 Punkte, die ihm den
    // schlechtesten Index geben.
    const players = kader();
    const namen = players.map(p => p.name);
    await stand(page, {
      players, teamAssign: anmeldung(namen), ...gleichAktiv({ P41: 10 }),
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
    await stand(page, {
      players, teamAssign: anmeldung(namen), ...gleichAktiv(),
      priority: [{ player_name: 'P40', counter: 0, c_total: 3 }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P39');
    expect(raus).not.toContain('P40');
  });

  test('die ⛔-Marke steht über der Rotation — auch bei bestem Rotationsstand', async ({ page }) => {
    // Die Rotation vom 30.09.2026 hat die Rangfolge umgedreht, und genau
    // dabei ist die ⛔-Marke keine Stufe darin, sondern ein **Tor davor**:
    // sie ist eine Regel der Allianz („wer unentschuldigt fehlt, setzt aus"),
    // keine Abwägung, die ein guter Rotationsstand aufwiegen könnte. Sonst
    // träte genau der Fall ein, den die Marke verhindern soll — wer oft
    // zuschaut, sammelt `c_total` und wäre danach gegen die Folgen eines
    // Fehlens immun.
    //
    // P20 hat den **höchsten** Rotationsstand des ganzen Kreises (5 gegen 1)
    // und wäre damit der Letzte, den es trifft. Er trägt die Marke und geht
    // trotzdem. Die beiden bestehenden ⛔-Tests prüfen das nicht: dort steht
    // die Marke gegen den festen Platz, und alle haben denselben Stand.
    const players = kader();
    const namen = players.map(p => p.name);
    const fr = await freitag(page);
    await stand(page, {
      players, teamAssign: anmeldung(namen), fixedCount: 15,
      priority: alleGleich(1, { P20: 5 }),
      aussetzen: [{ player_name: 'P20', mode: 'ws', event_date: fr }],
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P20');
    // Und zwar **mit der Marke als Grund**. Stünde dort der Rotationsgrund,
    // hätte ihn der Reihum-Schlüssel getroffen und die Marke wäre nur
    // zufällig wirkungsgleich — geprüft wird deshalb seine eigene Zeile.
    // Gegriffen wird die Zeile über das DOM, nicht über den Text: Name und
    // Grund stehen als eigene Spans nebeneinander, und `innerText` trennt sie
    // mit einem Zeilenumbruch — ein Zeilenvergleich fände den Grund nie.
    const zeile = await page.evaluate(() => {
      const karte = [...document.querySelectorAll('#pc .card')]
        .find(c => c.innerText.includes('Setzt diesmal aus'));
      const row = [...karte.querySelectorAll('div')]
        .find(d => d.firstElementChild && d.firstElementChild.textContent === 'P20');
      return row ? row.innerText.replace(/\s+/g, ' ') : null;
    });
    expect(zeile).toContain('hat beim letzten Mal gefehlt');
  });

  test('ein Stern überspringt keinen ganzen Schritt', async ({ page }) => {
    // Die Hälfte der Vorgabe vom 30.09.2026: „auch die mit einem Stern sollen
    // ein klein wenig öfter aufgestellt werden" — **ein klein wenig**, nicht
    // ausgenommen.
    //
    // **Der Schritt ist seit dem 16.10.2026 eine Anmeldung**, nicht eine
    // C-Runde: der Rotationsstand ist Anmeldungen + Ausschlüsse, ein Zuschauen
    // zählt darin zwei Punkte, eine Anmeldung einen. Der halbe Schritt des
    // Sterns bleibt damit das Kleinste, was es gibt — er zieht an allen vorbei,
    // die gleich weit sind, und an niemandem, der einen Punkt weiter ist.
    //
    // Aufbau: alle im Kreis haben zwei Einsätze, nur P20 einen. Er trägt den
    // Stern und den besten Index des Feldes (4,0) und geht trotzdem.
    const players = kader();
    players.find(p => p.name === 'P20').stern = true;
    const namen = players.map(p => p.name);
    const events = [
      { id: 'e1', event_date: '2026-09-11', team: 'A', mode: 'ws' },
      { id: 'e2', event_date: '2026-09-18', team: 'A', mode: 'ws' },
    ];
    const participation = [];
    for (let i = 16; i <= 41; i++) {
      const n = `P${String(i).padStart(2, '0')}`;
      participation.push({ event_id: 'e1', player_name: n, played: true,
        individual_pts: n === 'P20' ? 400 : 100 });
      if (n !== 'P20') participation.push({ event_id: 'e2', player_name: n, played: true, individual_pts: 100 });
    }
    await stand(page, { players, teamAssign: anmeldung(namen), events, participation });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    // Wäre ZUT_STERN_ROT ≥ 1, stünde P20 mit Rotationsstand 2,0 gleichauf mit
    // dem Feld und sein Index 4,0 hielte ihn drin. Der Test wird dann rot — so
    // ist er die Gegenprobe zur Größe der Zahl, nicht nur zu ihrer Existenz.
    expect(raus).toContain('P20');
  });

  test('wer sich öfter gemeldet hat, bleibt drin — auch mit weniger Ausschlüssen', async ({ page }) => {
    // **Die Vorgabe vom 16.10.2026**, im Wortlaut: „Es sollte sichergestellt
    // werden, dass Spieler, die 30× sich angemeldet haben und 3× ausgesetzt
    // haben, den Vorzug haben vor Spielern, die 10× gespielt haben, 2×
    // ausgesetzt haben. Die aktiveren Spieler sollten nicht mehr benachteiligt
    // werden als Spieler, die sich seltener anmelden."
    //
    // Gemessen war der Fall an `LittleAnt` (6 von 6 Wochen gemeldet, einmal
    // zugeschaut), der am 16.10.2026 auf der Raus-Liste stand, während
    // `Sturzhelm`, `ThAnos`, `Skirata33` und `Maggo1979` drinblieben — je 5
    // Anmeldungen, zweimal zugeschaut. Die absolute Strichliste hat den
    // Aktiveren bestraft.
    //
    // Aufbau im Maßstab des Kaders: der Kreis steht einheitlich bei zwei
    // Einsätzen und zwei Ausschlüssen (Stand 6).
    //   P20 „der Aktive"   — 5 Einsätze, 1× zugeschaut → 6 Anmeldungen, Stand 7
    //   P21 „der Seltene"  — 1 Einsatz,  2× zugeschaut → 3 Anmeldungen, Stand 5
    //
    // **Die Gegenprobe steckt in P21s Kraft:** er steht mit 160 Mio unter den
    // stärksten sechs des Kreises und wäre nach Stärke nie ein Kandidat.
    // Mit der alten Regel (allein `c_total`) steht P20 bei 1 gegen P21 bei 2 —
    // dann fliegt P20 und P21 bleibt, und beide Zusicherungen werden rot.
    const players = kader();
    const namen = players.map(p => p.name);
    const kreis = [];
    for (let i = 16; i <= 41; i++) kreis.push(`P${String(i).padStart(2, '0')}`);
    const events = [], participation = [];
    [0, 1, 2, 3, 4].forEach(r => {
      events.push({ id: 'r' + r, event_date: `2026-08-1${r}`, team: 'A', mode: 'ws' });
      kreis.forEach(n => {
        // Runde 0+1: der ganze Kreis. Runde 1 ohne P21 (er hat nur einen
        // Einsatz). Runde 2…4 nur P20, der damit auf fünf kommt.
        const dabei = r <= 1 ? (r === 1 ? n !== 'P21' : true) : n === 'P20';
        if (dabei) participation.push({ event_id: 'r' + r, player_name: n, played: true, individual_pts: 100 });
      });
    });
    await stand(page, {
      players, teamAssign: anmeldung(namen), events, participation,
      priority: alleGleich(2, { P20: 1 }),
    });
    const t = await textVon(page);
    const raus = ausschnitt(t, 'Setzt diesmal aus', 'In Last War einstellen');
    expect(raus).toContain('P21');
    expect(raus).not.toContain('P20');
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
    //
    // **Der Rotationsstand des Kreises bleibt dabei gleich** (seit 16.10.2026
    // zählt er die Anmeldungen mit): P16 und P30 haben beide drei, sonst
    // entschiede der Ausschluss vor der Bank und der Test prüfte die falsche
    // Regel.
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

  test('wer oft zugeschaut hat, kommt vor anderen ins Startteam — Zuschauen zählt wie Bank', async ({ page }) => {
    // Vorgabe Ben, 05.11.2026, am Fall Desnodus: 4× zugeschaut, 1× Bank, nie
    // gesetzt — und trotzdem als Erster auf der Bank, weil dort nur die Bank
    // zählte. P16 bildet ihn nach: einmal Bank, viermal zugeschaut. Alle übrigen
    // Freien saßen zweimal auf der Bank und haben nie zugeschaut.
    //
    // Mit der alten Regel (Bank allein) hat P16 mit 1 den kleinsten Stand und
    // landet auf der Bank; mit „Runden ohne Gebäude" steht er bei 5 gegen 2 und
    // spielt. Gegengeprüft: mit dem alten Schlüssel wird der Test rot.
    const players = kader();
    const namen = players.map(p => p.name);
    const andere = namen.filter(n => /^P(1[7-9]|2\d|30)$/.test(n));
    const bank = (...wer) => Object.fromEntries(wer.map(n => [n, 'bank']));
    const h = histo([bank('P16'), bank(...andere), bank(...andere)]);
    await stand(page, {
      players, teamAssign: anmeldung(namen), ...h,
      priority: [{ player_name: 'P16', counter: 0, c_total: 4 }],
    });
    const t = await textVon(page);
    const ersatz = ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus');
    const aufstellung = ausschnitt(t, 'GESETZT (bekommt', 'ERSATZ (spielt mit');
    expect(aufstellung).toContain('P16');
    expect(ersatz).not.toContain('P16');
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

  test('der Stern zählt auf der Bank anderthalb Runden — nicht zwei', async ({ page }) => {
    // Vorgabe Ben, 05.11.2026 (ZUT_STERN_BANK = 1,5): Anlass war Mika Pika, der
    // trotz Stern auf der Bank saß. Ersetzt den Test „der Stern zählt auf der
    // Bank erst bei gleicher Historie" — der hielt die Regel vom 30.09. fest,
    // die damit bewusst geändert ist.
    //
    // Frei sind P16–P30, zehn davon gehen auf die Bank. P20 trägt den Stern und
    // hatte zweimal ein Gebäude, also null Runden ohne Gebäude. Die zweimal
    // gesetzten Runden halten seinen Rotationsstand über den Nicht-Gemeldeten,
    // sonst entschiede das Zuschauen statt der Bank.
    //
    // 1. Die übrigen zehn hatten **eine** Runde ohne Gebäude: der Stern (1,5)
    //    zieht an ihnen vorbei, P20 spielt. Mit der alten Regel stünde er bei 0
    //    und ginge als Erster auf die Bank — gegengeprüft, dann wird es rot.
    // 2. Die übrigen hatten **zwei**: 1,5 reicht nicht, P20 geht auf die Bank.
    //    Das ist die Grenze nach oben — ein Stern ist kein Freifahrtschein.
    const players = kader();
    players.find(p => p.name === 'P20').stern = true;
    const namen = players.map(p => p.name);
    const andere = namen.filter(n => /^P(1[6-9]|2[1-9]|30)$/.test(n));
    const zehn = andere.slice(0, 10), vier = andere.slice(10);
    const als = (rolle, ...wer) => Object.fromEntries(wer.map(n => [n, rolle]));

    let h = histo([
      { P20: 'ges', ...als('bank', ...andere) },
      { P20: 'ges', ...als('bank', ...vier) },
    ]);
    await stand(page, { players, teamAssign: anmeldung(namen), ...h });
    let t = await textVon(page);
    expect(ausschnitt(t, 'GESETZT (bekommt', 'ERSATZ (spielt mit')).toContain('P20');
    expect(ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus')).not.toContain('P20');

    h = histo([
      { P20: 'ges', ...als('bank', ...andere) },
      { P20: 'ges', ...als('bank', ...andere) },
      als('bank', ...vier),
    ]);
    await stand(page, { players, teamAssign: anmeldung(namen), ...h });
    t = await textVon(page);
    expect(ausschnitt(t, 'ERSATZ (spielt mit', '⛔ Setzt diesmal aus')).toContain('P20');
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

  // Ben, 28.10.2026: „Die Anmeldung hat sich geändert, aber ich kann es nicht
  // übernehmen." Nach dem ersten Übernehmen stand dort nur noch „✍ Übernommen"
  // ohne Knopf, bis zum Neuladen — und die Schritte rechneten weiter gegen den
  // Stand von vor dem ersten Mal, obwohl ein Scan längst einen neuen gebracht
  // hatte.
  test('nach einer geänderten Anmeldung lässt sich erneut übernehmen', async ({ page }) => {
    page.on('dialog', d => d.accept());
    const players = kader();
    const namen = players.map(p => p.name);
    await stand(page, { players, teamAssign: anmeldung([...namen].reverse()) });
    await page.locator('button', { hasText: 'Vorschlag in die Anmeldung übernehmen' }).click();
    // Der Knopf bleibt da — ohne Änderung nur ausgegraut.
    await expect(page.locator('button', { hasText: 'Erneut in die Anmeldung übernehmen' })).toBeDisabled();

    // Die Anmeldung ändert sich von außen (ein Scan): alle wieder neu gemeldet,
    // in anderer Reihenfolge.
    await page.evaluate((n) => {
      const ta = {};
      n.forEach((x, i) => { ta[x] = i % 2 ? 'AC' : 'BC'; });
      window.APP.teamAssign = ta;
      window.zuteilungBerechnen();
    }, namen);
    // Der alte Schnappschuss ist verworfen: wieder die normale Karte, mit Knopf,
    // und die Schritte rechnen gegen die neue Anmeldung.
    const knopf = page.locator('button', { hasText: 'Vorschlag in die Anmeldung übernehmen' });
    await expect(knopf).toBeEnabled();
    const schrittStand = await page.evaluate(() =>
      JSON.stringify(window.APP.zutVorschlag.schritte.plan[0] || null));
    expect(schrittStand).not.toBe('null');
    await knopf.click();
    const abweichend = await page.evaluate(() => {
      const ta = window.APP.teamAssign, soll = window.APP.zutVorschlag.soll;
      return Object.entries(soll).filter(([n, w]) => ta[n] !== w && !/C$/.test(w)).length;
    });
    expect(abweichend).toBe(0);
    expect(await textVon(page)).toContain('✍ Übernommen');
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
