import { test, expect } from '@playwright/test';
import { isolateDb, fakeLogin, collectErrors, fixturePlayers } from './helpers.js';

// Einstellungsvarianten im Schluchtsturm: bespielte Kartenhälfte, Gebäude an den
// Spawnzonen, und das Speichern/Laden ganzer Einstellungen.
//
// Hintergrund: Morgenbringer sind zwei Allianzen und teilen sich die Karte —
// eine Aufstellung über alle zwölf Gebäude plant dann die Hälfte für jemand
// anderen mit. Ordnungshüter stehen allein und decken alles ab.

const LINKS = ['dc_w', 'serum_nw', 'def_sw', 'lager1', 'lager2'];
const RECHTS = ['dc_o', 'serum_so', 'def_no', 'lager3', 'lager4'];
const MITTE = ['kraftturm', 'viruslab'];

function namen(n) {
  return Array.from({ length: n }, (_, i) => `Testspieler ${String(i + 1).padStart(2, '0')}`);
}

// 20 Spieler in Team A, Fraktion setzen, Ansicht auf die Aufstellung.
async function aufbau(page, faction = 'morgen') {
  await page.evaluate(({ faction, alle }) => {
    alle.forEach((n) => { window.APP.csTeamAssign[n] = 'A'; });
    window.APP.csTeam = 'A';
    window.APP.csFaction = { A: faction, B: faction === 'morgen' ? 'ordnung' : 'morgen' };
    window.APP.csView = 'aufstellung';
    window.APP.csAdvOpen = true;
    window.nav('cs');
  }, { faction, alle: namen(20) });
}

// Alle Gebäude, die im Plan von Team A vorkommen — Start wie Ziel.
async function benutzteGebaeude(page) {
  return page.evaluate(() => {
    const raus = new Set();
    Object.values(window.APP.csPlanA || {}).forEach((p) => {
      if (p.s) raus.add(p.s);
      if (p.d) raus.add(p.d);
    });
    return [...raus].sort();
  });
}

test('„Nur linke Hälfte" plant kein Gebäude der rechten Seite ein', async ({ page }) => {
  const errors = collectErrors(page);
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  await page.evaluate(() => { window.setCsSeite('links'); window.csAutoAssign(); });
  const benutzt = await benutzteGebaeude(page);

  for (const b of RECHTS) expect(benutzt, `${b} liegt rechts und darf nicht vorkommen`).not.toContain(b);
  // Energieturm und Labor stehen auf der Mittelachse und bleiben immer dabei —
  // ihr 'side' in CS_ANCHOR ist nur ein Layout-Tiebreak fürs SVG.
  for (const b of MITTE) expect(benutzt, `${b} liegt mittig und muss dabei bleiben`).toContain(b);
  expect(benutzt.some((b) => LINKS.includes(b))).toBe(true);

  // Und niemand bleibt ohne Gebäude liegen: die Plätze der gesperrten Gebäude
  // sind auf die übrigen Startgebäude verteilt worden.
  const ohne = await page.evaluate(() =>
    Object.values(window.APP.csPlanA).filter((p) => !p.s && !p.d).length);
  expect(ohne).toBe(0);

  expect(errors.relevant).toEqual([]);
});

test('„Eigenen Spawn aussparen" räumt bei Morgenbringer die Probenlager', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  await page.evaluate(() => { window.setCsSpawn('eigen'); window.csAutoAssign(); });
  const benutzt = await benutzteGebaeude(page);

  // Die vier Probenlager liegen an den Süd-Spawns der Morgenbringer.
  for (const b of ['lager1', 'lager2', 'lager3', 'lager4']) expect(benutzt).not.toContain(b);
  expect(benutzt).toContain('kraftturm');
  const ohne = await page.evaluate(() =>
    Object.values(window.APP.csPlanA).filter((p) => !p.s && !p.d).length);
  expect(ohne).toBe(0);
});

test('Bei Ordnungshütern trifft dieselbe Regel die Datenzentren', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'ordnung');

  await page.evaluate(() => { window.setCsSpawn('eigen'); window.csAutoAssign(); });
  const benutzt = await benutzteGebaeude(page);

  // Die Datenzentren liegen vor dem Nord-Spawn der Ordnungshüter.
  for (const b of ['dc_w', 'dc_o']) expect(benutzt).not.toContain(b);
  // Gegenprobe: die Regel richtet sich nach der Fraktion, nicht nach dem Team.
  expect(benutzt).toContain('lager1');
});

test('Zu enge Kombination warnt, statt Spieler still ohne Gebäude zu lassen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  // Links + eigener Spawn lässt nur Energieturm und Datenzentrum I übrig:
  // 10 Plätze plus 5 Assassinen für 20 Spieler.
  await page.evaluate(() => { window.setCsSeite('links'); window.setCsSpawn('eigen'); });
  await expect(page.getByText(/Zu eng: die freigegebenen Gebäude fassen/)).toBeVisible();

  // Und die Warnung verschwindet wieder, sobald es passt.
  await page.evaluate(() => window.setCsSpawn('aus'));
  await expect(page.getByText(/Zu eng: die freigegebenen Gebäude fassen/)).toHaveCount(0);
});

test('Eine Variante speichert die Einstellungen und stellt sie wieder her', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  // Einstellung bauen und als Variante sichern.
  const id = await page.evaluate(() => {
    window.prompt = () => 'Linke Hälfte';
    window.setCsSeite('links');
    window.setCsSpawn('gegner');
    window.csChangeSlot('serum_nw', 2); // Vorgabe 1 → 3
    window.csPresetSave();
    return { id: window.APP.csPresets.at(-1).id, serum: window.APP.csSlotsA.serum_nw };
  });
  expect(id.id).toBeTruthy();
  expect(id.serum).toBe(3);

  // Alles verstellen …
  await page.evaluate(() => {
    window.setCsSeite('ganz');
    window.setCsSpawn('aus');
    window.csChangeSlot('serum_nw', -2);
  });

  // … und über die Variante zurückholen.
  const nachher = await page.evaluate((pid) => {
    window.csPresetLoad(pid);
    return {
      seite: window.APP.csSeite.A,
      spawn: window.APP.csSpawn.A,
      serum: window.APP.csSlotsA.serum_nw,
      // Der Stempel muss auf die Fraktion des Zielteams zeigen, sonst rechnet
      // csGetSlots die geladenen Zahlen beim nächsten Zugriff wieder weg.
      f: window.APP.csSlotsA.f,
    };
  }, id.id);

  expect(nachher.seite).toBe('links');
  expect(nachher.spawn).toBe('gegner');
  expect(nachher.serum).toBe(id.serum);
  expect(nachher.f).toBe('morgen');
});

test('Derselbe Name darf je Fraktion einmal vorkommen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  const r = await page.evaluate(() => {
    window.prompt = () => 'XP33-Aufstellung alt';
    // Nie bestätigen: käme die Überschreiben-Frage, bliebe es bei einer Variante.
    window.confirm = () => false;

    window.setCsSeite('links');
    window.csPresetSave();                       // Morgenbringer

    window.APP.csFaction.A = 'ordnung';          // Team A spielt jetzt die andere Fraktion
    window.setCsSeite('ganz');
    window.csPresetSave();                       // Ordnungshüter, gleicher Name

    return window.APP.csPresets.map((p) => ({ name: p.name, f: p.faction, seite: p.seite }));
  });

  expect(r).toHaveLength(2);
  expect(r.map((p) => p.f).sort()).toEqual(['morgen', 'ordnung']);
  // Und jede trägt ihren eigenen Zuschnitt, keine hat die andere überschrieben.
  expect(r.find((p) => p.f === 'morgen').seite).toBe('links');
  expect(r.find((p) => p.f === 'ordnung').seite).toBe('ganz');
});

test('Ein zweites Speichern trifft die Variante der eigenen Fraktion', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  const r = await page.evaluate(() => {
    window.prompt = () => 'Gleicher Name';
    window.confirm = () => true;

    window.setCsSeite('links');
    window.csPresetSave();
    window.APP.csFaction.A = 'ordnung';
    window.setCsSeite('rechts');
    window.csPresetSave();

    // Jetzt die Ordnungshüter-Variante überschreiben — die Morgenbringer-Variante
    // muss unangetastet bleiben.
    window.setCsSpawn('gegner');
    window.csPresetSave();

    return window.APP.csPresets.map((p) => ({ f: p.faction, seite: p.seite, spawn: p.spawn }));
  });

  expect(r).toHaveLength(2);
  expect(r.find((p) => p.f === 'morgen')).toMatchObject({ seite: 'links', spawn: 'aus' });
  expect(r.find((p) => p.f === 'ordnung')).toMatchObject({ seite: 'rechts', spawn: 'gegner' });
});

test('Eine Variante der fremden Fraktion wird nur nach Rückfrage geladen', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  const r = await page.evaluate(() => {
    window.prompt = () => 'Fremde';
    window.confirm = () => true;
    window.APP.csFaction.A = 'ordnung';
    window.setCsSeite('rechts');
    window.csPresetSave();
    const id = window.APP.csPresets[0].id;

    // Team A spielt wieder Morgenbringer, die Variante ist für Ordnungshüter.
    window.APP.csFaction.A = 'morgen';
    window.setCsSeite('ganz');

    let gefragt = 0;
    window.confirm = () => { gefragt++; return false; };
    window.csPresetLoad(id);
    const abgelehnt = window.APP.csSeite.A;

    window.confirm = () => { gefragt++; return true; };
    window.csPresetLoad(id);
    return { gefragt, abgelehnt, angenommen: window.APP.csSeite.A };
  });

  expect(r.gefragt).toBe(2);
  expect(r.abgelehnt).toBe('ganz');   // Ablehnen ändert nichts
  expect(r.angenommen).toBe('rechts'); // Bestätigen lädt
});

test('Die eigene Fraktion steht in der Auswahlliste oben', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  await page.evaluate(() => {
    window.prompt = () => 'Ordnung-Variante';
    window.confirm = () => true;
    window.APP.csFaction.A = 'ordnung';
    window.csPresetSave();
    window.APP.csFaction.A = 'morgen';
    window.prompt = () => 'Morgen-Variante';
    window.csPresetSave();
  });

  // Team A spielt Morgenbringer — deren Gruppe steht oben, die andere darunter.
  // Sichtbar bleiben beide: verstecken hieße, jemand sucht eine Variante, die da ist.
  const gruppen = await page.locator('optgroup').evaluateAll((els) => els.map((e) => e.label));
  expect(gruppen).toEqual(['Morgenbringer', 'Ordnungshüter']);
});

test('Varianten und Einstellungen landen im gespeicherten Stand', async ({ page }) => {
  await isolateDb(page);
  await page.goto('/index.html');
  await fakeLogin(page, { players: fixturePlayers(25) });
  await aufbau(page, 'morgen');

  // Der Schlüssel trägt die Allianz — hier die synthetische Testallianz, nicht
  // die echte. Ein Testlauf darf den lokalen Puffer der App nicht anfassen.
  const gespeichert = await page.evaluate(() => {
    window.prompt = () => 'Test-Variante';
    window.setCsSeite('rechts');
    window.setCsSpawn('gegner');
    window.csPresetSave();
    const key = Object.keys(localStorage).find((k) => k.startsWith('warsync_cs_state@'));
    return JSON.parse(localStorage.getItem(key));
  });

  expect(gespeichert.csPresets).toHaveLength(1);
  expect(gespeichert.csPresets[0].name).toBe('Test-Variante');
  expect(gespeichert.csPresets[0].seite).toBe('rechts');
  expect(gespeichert.csPresets[0].spawn).toBe('gegner');
  expect(gespeichert.csSeite.A).toBe('rechts');
  expect(gespeichert.csSpawn.A).toBe('gegner');
});
