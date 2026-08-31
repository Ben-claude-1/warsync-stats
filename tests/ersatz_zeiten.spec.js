import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Automatische Fest/Rotation/Ersatz-Vergabe im Schluchtsturm (Anmeldung unbegrenzt,
// höchstens 20 Hauptplätze kommen ins Auto-Verteilen, Ersatz bleibt außen vor)
// und die wählbaren Startzeiten beider Events.

// Einteilung direkt in den Zustand schreiben. Über die Knöpfe wären das 30 Klicks
// pro Team, und jeder davon löst ein Rendern samt Speichern aus.
async function einteilen(page, { ws = {}, cs = {} } = {}) {
  await page.evaluate(({ ws, cs }) => {
    window.APP.teamAssign = ws;
    window.APP.csTeamAssign = cs;
  }, { ws, cs });
}

function namen(n, von = 0) {
  return Array.from({ length: n }, (_, i) => `Testspieler ${String(von + i + 1).padStart(2, '0')}`);
}

// Gleiche Rechnung wie getNextFriday() in der App — der Test darf nicht davon
// abhängen, an welchem Wochentag er läuft.
function naechsterFreitag() {
  const now = new Date();
  const add = now.getDay() <= 5 ? 5 - now.getDay() : 6;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Anmeldung ist unbegrenzt, aber höchstens 20 Spieler kommen ins Auto-Verteilen', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(60) });

  const result = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    // 35 Anmeldungen — mehr als die 30 Plätze (20 Haupt + 10 Ersatz). Anmelden
    // selbst kennt kein Limit mehr, das übernimmt erst die Rotation.
    for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const plan = window.APP.csPlanA || {};
    return {
      angemeldet: Object.values(window.APP.csTeamAssign).filter((v) => v === 'A').length,
      imPlan: Object.keys(plan).length,
    };
  });
  expect(result.angemeldet).toBe(35);
  expect(result.imPlan).toBe(20); // nur fest + Rotation-Haupt bekommen eine Gebäudezuweisung
  expect(errors.relevant).toEqual([]);
});

test('Nur die 20 stärksten Angemeldeten kommen ins Auto-Verteilen, der Rest bleibt außen vor', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  // fixturePlayers() ist nach Heldenkraft absteigend sortiert (Testspieler 01 am
  // stärksten) — die Aufstellung sortiert standardmäßig aber nach T1, das im
  // Testfixture aufsteigend läuft. Explizit auf Heldenkraft stellen, sonst
  // würde die Rotation genau umgekehrt sortieren.
  // Ohne Teilnahme-Historie fällt die Rotation für frische Anmeldungen auf
  // dieselbe Reihenfolge zurück, die 20 Stärksten (fest + Rotation-Haupt)
  // landen im Plan.
  const result = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const plan = window.APP.csPlanA || {};
    return {
      staerkster: !!plan[nm(1)],
      schwaechsterImTop20: !!plan[nm(20)],
      ersterErsatz: !!plan[nm(21)],
      warteliste: !!plan[nm(31)],
    };
  });
  expect(result.staerkster).toBe(true);
  expect(result.schwaechsterImTop20).toBe(true);
  expect(result.ersterErsatz).toBe(false); // Ersatz bekommt keine Gebäudezuweisung mehr
  expect(result.warteliste).toBe(false);
});

// ── Von Hand gesetzte Ersatzspieler ──────────────────────────────────────────
// Die Markierung ist eine Entscheidung, keine Empfehlung: sie darf weder von der
// Stärke noch von der Rotation überstimmt werden. Genau das ist der Kern.

test('Von Hand als Ersatz markierte Spieler bleiben Ersatz — auch die stärksten', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const ergebnis = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    // 12 Anmeldungen, weit unter den 20 Hauptplätzen — es gibt also keinen Grund,
    // irgendjemanden auf die Bank zu setzen. Außer der Ansage von Hand.
    for (let i = 1; i <= 12; i++) window.csSetTeamAssign(nm(i), 'A');
    window.csToggleErsatz(nm(1));   // der stärkste
    window.csToggleErsatz(nm(2));
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    return { plan: Object.keys(window.APP.csPlanA || {}), marken: [window.APP.csTeamAssign[nm(1)], window.APP.csTeamAssign[nm(2)]] };
  });
  // Kodierung im gespeicherten Stand: Team plus Ersatz-Kennzeichen.
  expect(ergebnis.marken).toEqual(['AE', 'AE']);
  // Kein Gebäude für die beiden — die übrigen zehn sind vollständig eingeplant.
  expect(ergebnis.plan).not.toContain('Testspieler 01');
  expect(ergebnis.plan).not.toContain('Testspieler 02');
  expect(ergebnis.plan.length).toBe(10);

  // Sichtbar sind sie trotzdem: als Ersatz unter der Aufstellung.
  await page.evaluate(() => { window.nav('cs'); window.csSetView('aufstellung'); });
  const karte = page.locator('.card', { hasText: 'Ersatz & Warteliste' });
  await expect(karte).toContainText('Ersatz (2/10)');
  await expect(karte).toContainText('Testspieler 01');
  expect(errors.relevant).toEqual([]);
});

test('Mehr als 20 Gesetzte: die Rotation bestimmt, wer zusätzlich auf die Bank kommt', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const ergebnis = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    for (let i = 1; i <= 25; i++) window.csSetTeamAssign(nm(i), 'A');
    window.csToggleErsatz(nm(1));   // 2 von Hand → 23 bleiben gesetzt
    window.csToggleErsatz(nm(2));
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    return { plan: Object.keys(window.APP.csPlanA || {}) };
  });
  // 20 Hauptplätze bleiben 20 — die drei überzähligen Gesetzten rutschen auf die Bank.
  expect(ergebnis.plan.length).toBe(20);
  expect(ergebnis.plan).not.toContain('Testspieler 01');
  expect(ergebnis.plan).not.toContain('Testspieler 02');

  await page.evaluate(() => { window.nav('cs'); window.csSetView('aufstellung'); });
  const karte = page.locator('.card', { hasText: 'Ersatz & Warteliste' });
  // 2 von Hand + 3 aus der Rotation.
  await expect(karte).toContainText('Ersatz (5/10)');
  await expect(karte).toContainText('Testspieler 01');
});

test('Der E-Knopf in der Anmeldung markiert und der Stand merkt es sich', async ({ page }) => {
  const writes = await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(6) });
  await page.evaluate(() => { window.nav('cs'); window.csSetView('anmeldung'); });

  // Liste ist nach Rang und Heldenkraft sortiert — der dritte Knopf gehört zu
  // Testspieler 03. Geklickt wird der echte Knopf, nicht die Funktion dahinter.
  await page.locator('button[title^="Als Ersatzspieler einplanen"]').nth(2).click();
  expect(await page.evaluate(() => window.APP.csTeamAssign['Testspieler 03'])).toBe('AE');

  // Der gespeicherte Stand führt das Kennzeichen mit. Ginge es hier verloren,
  // stünde der Spieler nach dem nächsten Laden wieder in der Aufstellung.
  const gespeichert = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('warsync_cs_state'));
    return JSON.parse(localStorage.getItem(k)).csTeamAssign['Testspieler 03'];
  });
  expect(gespeichert).toBe('AE');

  // Zweiter Klick nimmt die Markierung zurück, die Anmeldung bleibt bestehen.
  await page.locator('button[title^="Wieder als gesetzt einplanen"]').first().click();
  expect(await page.evaluate(() => window.APP.csTeamAssign['Testspieler 03'])).toBe('A');
  expect(writes.filter((w) => !w.startsWith('POST /rest/v1/ws_planner_state'))).toEqual([]);
});

test('Wüstensturm-Zeit ist wählbar und steht mit Serverzeit in der Aufstellung', async ({ page }) => {
  const writes = await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await einteilen(page, { ws: Object.fromEntries(namen(6).map((n) => [n, 'A'])) });
  // Das Event des kommenden Freitags liegt sonst nicht vor — ohne es gäbe es
  // nichts, woran die geänderte Zeit geschrieben werden könnte.
  await page.evaluate((friday) => {
    window.APP.data.events = [
      { id: 'ev-a', event_date: friday, team: 'A', time_slot: '13:00', result: 'pending' },
      { id: 'ev-b', event_date: friday, team: 'B', time_slot: '22:00', result: 'pending' },
    ];
  }, naechsterFreitag());

  await page.evaluate(() => { window.APP.team = 'A'; window.nav('ws'); window.setWSView('aufstellung'); });
  // Vorgabe: Team A 13:00 EU = 09:00 Serverzeit.
  await expect(page.locator('#pc')).toContainText('Team A · 13:00 EU · 09:00 Server');

  await page.evaluate(() => window.setWsZeit('A', '03:00'));
  await expect(page.locator('#pc')).toContainText('Team A · 03:00 EU · 23:00 Server');
  // Team B bleibt unberührt — die Zeiten hängen am Team, nicht am Event.
  await expect(page.locator('#pc')).toContainText('⚔ Team B · 22:00');

  // Die neue Zeit gehört ans Event in der Datenbank, nicht nur in die Anzeige.
  await expect
    .poll(() => writes.filter((w) => w.startsWith('PATCH /rest/v1/ws_events')).length)
    .toBeGreaterThan(0);

  // Auch die Mail, die im Spiel gepostet wird, führt beide Zeiten.
  await page.evaluate(() => window.setWSView('mail'));
  await expect(page.locator('#pc')).toContainText('03:00 EU · 23:00 Server');
});

test('Schluchtsturm: Team A und B lassen sich getrennt auf 16:00 oder 03:00 legen', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page);
  await einteilen(page, { cs: Object.fromEntries(namen(6).map((n) => [n, 'A'])) });

  await page.evaluate(() => { window.APP.csTeam = 'A'; window.nav('cs'); window.csSetView('aufstellung'); });
  await expect(page.locator('#pc')).toContainText('Team A · 16:00 EU · 12:00 Server');

  await page.evaluate(() => window.csSetZeit('B', '03:00'));
  await page.evaluate(() => window.csSetView('anmeldung'));
  await expect(page.locator('#pc')).toContainText('Team A · 16:00 EU · 12:00 Server');
  await expect(page.locator('#pc')).toContainText('Team B · 03:00 EU · 23:00 Server');

  // Das Übersichtsbild ist das, was in der Allianz landet — dort muss beides stehen.
  const svg = await page.evaluate(() => window.APP.csTeam && document.body && (() => {
    window.showCSMap();
    const s = document.querySelector('#csmap-body svg').outerHTML;
    document.getElementById('csmap').remove();
    return s;
  })());
  expect(svg).toContain('16:00 EU · 12:00 Server');
  expect(errors.relevant).toEqual([]);
});

test('Ersatzspieler stehen im Übersichtsbild unter der Karte, nicht auf den Gebäuden', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const bild = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    // Heldenkraft statt T1 — siehe Kommentar im vorherigen Test.
    window.APP.csStrength = 'hero';
    // 25 Anmeldungen — die 5 schwächsten (21-25) sind Ersatz und bekommen keine
    // Gebäudezuweisung. Im Bild stehen sie deshalb nur im Fahrplan darunter.
    for (let i = 1; i <= 25; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    window.showCSMap();
    const svg = document.querySelector('#csmap-body svg');
    // Namen auf den Gebäudekarten: font-weight 700 und zentriert. Die Zeilen des
    // Fahrplans darunter stehen linksbündig, sind also nicht mitgezählt.
    const auf = [...svg.querySelectorAll('text[text-anchor="middle"][font-weight="700"]')].map((e) => e.textContent);
    // Der Fahrplan darunter ist linksbündig — inklusive der Fortsetzungszeilen
    // einer langen Ersatzliste, die keine eigene Kapsel mehr bekommen.
    const unter = [...svg.querySelectorAll('text:not([text-anchor])')].map((e) => e.textContent).join(' ');
    document.getElementById('csmap').remove();
    return { auf, unter };
  });
  expect(bild.auf).toContain('Testspieler 01');
  expect(bild.auf).not.toContain('Testspieler 21');
  expect(bild.auf).not.toContain('Testspieler 25');
  expect(bild.unter).toContain('Substitute (5) — deployment not guaranteed');
  expect(bild.unter).toContain('Testspieler 21');
  expect(bild.unter).toContain('Testspieler 25');
  // Kein hängendes Trennzeichen am Zeilenende einer umgebrochenen Liste.
  expect(bild.unter).not.toMatch(/,\s{2,}/);
});

test('Anmeldung und Zeitwahl laufen am Handy nicht über', async ({ page }) => {
  await isolateDb(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(30) });
  await einteilen(page, { cs: { 'Testspieler 01': 'A', 'Testspieler 02': 'B' } });

  for (const [seite, ansicht] of [['cs', 'anmeldung'], ['cs', 'aufstellung']]) {
    await page.evaluate(([s, v]) => { window.nav(s); window.APP.csView = v; window.renderPage(); }, [seite, ansicht]);
    const ueber = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ueber, `${seite}/${ansicht} läuft ${ueber}px über`).toBeLessThanOrEqual(0);
  }
  await page.evaluate(() => { window.nav('ws'); window.setWSView('aufstellung'); });
  const ueberWs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ueberWs).toBeLessThanOrEqual(0);
});

test('Einteilung aus dem Wüstensturm wird unverändert in den Schluchtsturm übernommen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });
  await einteilen(page, { ws: { 'Testspieler 01': 'A', 'Testspieler 02': 'B', 'Testspieler 03': 'B' } });

  const cs = await page.evaluate(() => {
    window.confirm = () => true;
    window.csImportFromWS('kopieren');
    return window.APP.csTeamAssign;
  });
  expect(cs).toEqual({ 'Testspieler 01': 'A', 'Testspieler 02': 'B', 'Testspieler 03': 'B' });
});

// Die Öffnungszeit eines Gebäudes steht in dessen Kopfzeile. Am einzelnen Namen
// gehört sie nur dorthin, wo er VORHER steht — dort sagt sie ihm, wann er losmuss.
// Im Zielgebäude wiederholte sie bloß die Kopfzeile.
test('Zielgebäude wiederholen die Uhrzeit nicht an jedem Namen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const karten = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    for (let i = 1; i <= 20; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    window.showCSMap();
    const svg = document.querySelector('#csmap-body svg');
    // Je Karte alle Textzeilen einsammeln, damit Kopfzeile und Namensmarken
    // getrennt prüfbar sind.
    const out = [...svg.querySelectorAll('g')].map((g) => [...g.querySelectorAll('text')].map((t) => t.textContent));
    document.getElementById('csmap').remove();
    return out;
  });

  const labor = karten.find((k) => k[0] === 'High-Security Lab');
  expect(labor, 'Laborkarte im Bild').toBeTruthy();
  expect(labor[1]).toContain('from 12:00');            // Kopfzeile nennt die Zeit
  expect(labor.slice(3).filter((z) => /^from \d/.test(z))).toEqual([]);

  // Im Startgebäude bleibt die Zeit am Namen stehen — sonst weiß niemand, wann
  // er losgehen soll.
  const start = karten.find((k) => k[0] === 'Data Center I');
  expect(start.some((z) => /^→ .+ \d+:00$/.test(z))).toBe(true);
});

// Jedes Gebäude, für das Plätze vorgesehen sind, braucht mindestens einen
// Spieler — auch dann, wenn der Kader knapp ist. Vorher lief die Verteilung
// Gebäude für Gebäude durch: das erste wurde voll, für das letzte blieb niemand
// übrig (AR1S, Fraktion Ordnungshüter: Energieturm 5, Datenzentrum II leer).
test('Knapper Kader lässt kein Startgebäude leer', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(20) });

  const verteilung = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    window.APP.csFaction = { A: 'ordnung', B: 'morgen' };
    // 11 Angemeldete: 5 Assassinen, 6 für drei Startgebäude mit je 5 Plätzen.
    for (let i = 1; i <= 11; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const P = window.APP.csPlanA, slots = window.APP.csSlotsA;
    const start = {}, bleibt = {};
    Object.values(P).forEach((p) => {
      if (!p.s) return;
      start[p.s] = (start[p.s] || 0) + 1;
      if (!p.d) bleibt[p.s] = (bleibt[p.s] || 0) + 1;
    });
    return { start, bleibt, slots };
  });

  // Die Probenlager sind bei den Ordnungshütern bewusst auf 0 gesetzt — sie
  // liegen im gegnerischen Rücken. Alles andere muss besetzt sein.
  const vorgesehen = ['kraftturm', 'dc_w', 'dc_o'];
  for (const b of vorgesehen) {
    expect(verteilung.slots[b], `${b} hat Plätze`).toBeGreaterThan(0);
    expect(verteilung.start[b] || 0, `${b} ab 0:00 besetzt`).toBeGreaterThan(0);
    expect(verteilung.bleibt[b] || 0, `${b} bleibt bis zum Ende besetzt`).toBeGreaterThan(0);
  }
  expect(verteilung.start.lager1 || 0).toBe(0);
});

// Ein Gebäude, aus dem alle wegwechseln, steht ab dem letzten Wechsel ohne
// Besatzung da. In der Namensliste fällt das nicht auf — im Bild und in der
// Aufstellung muss es deshalb ausdrücklich stehen.
test('Leerlaufendes Gebäude wird im Bild und in der Aufstellung gemeldet', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(20) });

  const bild = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    for (let i = 1; i <= 3; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    // Beide Besatzer des Datenzentrums wechseln weg — einer um 5:00, einer um
    // 8:00. Ab 8:00 steht es leer.
    window.APP.csPlanA = {
      [nm(1)]: { s: 'dc_w', d: 'serum_nw' },
      [nm(2)]: { s: 'dc_w', d: 'def_sw' },
      [nm(3)]: { s: 'kraftturm', d: null },
    };
    window.showCSMap();
    const svg = document.querySelector('#csmap-body svg').outerHTML;
    document.getElementById('csmap').remove();
    return svg;
  });
  expect(bild).toContain('empty from 8:00');

  await page.evaluate(() => { window.nav('cs'); window.csSetView('aufstellung'); });
  // Die Gebäude-Kästen stecken im eingeklappten Bereich „Erweitert".
  await page.locator('#pc .ch', { hasText: 'Erweitert' }).click();
  await expect(page.locator('#pc')).toContainText('ab 8:00 unbesetzt');
});

// Jeder Wechsler wird aus einem Startgebäude gezogen, und abgeben können nur die
// Datenzentren: der Energieturm ist ausgenommen, die Probenlager haben nur einen
// Mann. Bei zwei Plätzen je Verteidigungssystem waren das sechs Wechsler — beide
// Datenzentren fielen von vier auf einen. Mit je einem Platz sind es vier.
test('Datenzentren behalten bei vollem Kader mehr als einen Spieler', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(40) });

  const res = await page.evaluate(() => {
    const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
    window.APP.csStrength = 'hero';
    window.APP.csFaction = { A: 'morgen', B: 'ordnung' };
    for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
    window.APP.csTeam = 'A';
    window.csAutoAssign();
    const P = window.APP.csPlanA;
    const bleibt = {}, ziel = {};
    Object.values(P).forEach((p) => {
      if (p.s && !p.d) bleibt[p.s] = (bleibt[p.s] || 0) + 1;
      if (p.d) ziel[p.d] = (ziel[p.d] || 0) + 1;
    });
    return { bleibt, ziel, slots: window.APP.csSlotsA };
  });

  expect(res.slots.def_no).toBe(1);
  expect(res.slots.def_sw).toBe(1);
  expect(res.bleibt.dc_w).toBeGreaterThan(1);
  expect(res.bleibt.dc_o).toBeGreaterThan(1);
  // Der Energieturm gibt weiterhin niemanden ab, die Probenlager bleiben besetzt.
  expect(res.bleibt.kraftturm).toBe(3);
  for (const l of ['lager1', 'lager2', 'lager3', 'lager4']) expect(res.bleibt[l]).toBe(1);
  // Alle vier späten Gebäude bekommen jemanden.
  for (const z of ['serum_nw', 'serum_so', 'def_no', 'def_sw']) expect(res.ziel[z]).toBe(1);
});

// Woher die Wechsler kommen, ist eine spielerische Entscheidung — deshalb
// umstellbar. Vorgabe ist 'schonend'. Jeder Modus wird hier auf sein
// dokumentiertes Ergebnis festgenagelt, damit ein Umbau an der Quellenwahl
// nicht still einen anderen Modus verbiegt.
const VERTEILUNG = [
  { modus: 'schonend', defSlots: 1, bleibt: { kraftturm: 3, dc_w: 2, dc_o: 2, lager1: 1 } },
  { modus: 'turm', defSlots: 2, bleibt: { kraftturm: 1, dc_w: 2, dc_o: 2, lager1: 1 } },
  { modus: 'gleich', defSlots: 2, bleibt: { kraftturm: 2, dc_w: 2, dc_o: 1, lager1: 1 } },
  // Einziger Modus, in dem ein Gebäude bewusst leerläuft — genau dafür ist er da.
  { modus: 'lager', defSlots: 2, bleibt: { kraftturm: 3, dc_w: 3, dc_o: 3, lager1: undefined } },
];

for (const fall of VERTEILUNG) {
  test(`Verteilungsmodus „${fall.modus}" zieht die Wechsler wie beschrieben`, async ({ page }) => {
    await isolateDb(page);
    await page.goto('/index.html');
    await fakeLogin(page, { players: fixturePlayers(40) });

    const res = await page.evaluate((m) => {
      const nm = (i) => `Testspieler ${String(i).padStart(2, '0')}`;
      window.APP.csStrength = 'hero';
      window.APP.csFaction = { A: 'morgen', B: 'ordnung' };
      window.setCsVerteilung(m);
      for (let i = 1; i <= 35; i++) window.csSetTeamAssign(nm(i), 'A');
      window.APP.csTeam = 'A';
      window.csAutoAssign();
      const bleibt = {}, ziel = {};
      Object.values(window.APP.csPlanA).forEach((p) => {
        if (p.s && !p.d) bleibt[p.s] = (bleibt[p.s] || 0) + 1;
        if (p.d) ziel[p.d] = (ziel[p.d] || 0) + 1;
      });
      return { bleibt, ziel, defSlots: window.APP.csSlotsA.def_no, gewaehlt: window.APP.csVerteilung };
    }, fall.modus);

    expect(res.gewaehlt).toBe(fall.modus);
    expect(res.defSlots, 'Plätze je Verteidigungssystem').toBe(fall.defSlots);
    for (const [b, n] of Object.entries(fall.bleibt)) {
      expect(res.bleibt[b], `${b} ab 8:00`).toBe(n);
    }
    // Unabhängig vom Modus bekommt jedes späte Gebäude jemanden.
    for (const z of ['serum_nw', 'serum_so', 'def_no', 'def_sw']) {
      expect(res.ziel[z], `${z} besetzt`).toBeGreaterThan(0);
    }
  });
}

test('Vorgabe ist „Datenzentren schonen", und die Wahl überlebt das Speichern', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(20) });

  expect(await page.evaluate(() => window.APP.csVerteilung)).toBe('schonend');

  // Umstellen muss im gespeicherten Stand landen — sonst fällt die Wahl beim
  // nächsten Seitenaufruf auf die Vorgabe zurück. Geprüft wird der Datensatz
  // selbst, den localStorage und Datenbank gemeinsam bekommen.
  const gespeichert = await page.evaluate(() => {
    window.setCsVerteilung('turm');
    const key = Object.keys(localStorage).find((k) => k.startsWith('warsync_cs_state'));
    return { key, payload: JSON.parse(localStorage.getItem(key) || '{}') };
  });
  expect(gespeichert.key, 'Schluchtsturm-Stand im localStorage').toBeTruthy();
  expect(gespeichert.payload.csVerteilung).toBe('turm');
});
