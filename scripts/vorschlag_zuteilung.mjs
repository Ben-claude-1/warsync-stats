// Vorschlag fuer die Wuestensturm-Aufstellung, ohne im Browser zu klicken.
//
//     node scripts/vorschlag_zuteilung.mjs [XP33]
//
// Gerechnet wird mit **der Logik des Werkzeugs selbst**: das Skript laedt die
// gebaute App, setzt den echten Stand (Kader, Einteilung, Gebaeude-Slots) hinein
// und ruft `autoAssign()` auf. Die Regeln in `autoAssign`/`computeRoster`/
// `typenMischen` nachzubauen waere eine zweite Fassung derselben Entscheidung —
// genau das, wovor CLAUDE.md an mehreren Stellen warnt; sie liefe frueher oder
// spaeter auseinander, und dann waere der Vorschlag hier ein anderer als der
// Knopf in der Aufstellung.
//
// **Geschrieben wird nichts.** Jede Anfrage an PostgREST wird auf Netzwerkebene
// abgefangen (wie `tests/helpers.js` es tut): GET liefert `[]`, alles andere 403.
// `autoAssign` ruft am Ende `saveWSState()` — ohne die Sperre landete der
// Vorschlag ungefragt als neue Aufstellung der ganzen Allianz im Planungsstand.
// Am Ende steht, was tatsaechlich abgewiesen wurde.
//
// Den Stand holt das Skript direkt aus Postgres (`docker exec`), nicht ueber die
// App: die haengt am Tailscale-Funnel, und der ist fuer einen Vorschlag auf
// demselben Rechner ein Umweg.
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const TAG = process.argv[2] || 'XP33';
const PORT = 8799;            // derselbe Port wie die Playwright-Tests, siehe ~/.claude/PORTS.md
const SEITE = `http://127.0.0.1:${PORT}/index.html`;

function sql(text) {
  return execFileSync('docker', ['exec', '-i', 'supabase-db', 'psql', '-U', 'postgres',
    '-d', 'postgres', '-t', '-A', '-c', text], { encoding: 'utf8' }).trim();
}

function standHolen(tag) {
  const allianz = JSON.parse(sql(
    `SELECT COALESCE(row_to_json(a),'null') FROM alliances a WHERE tag='${tag}';`));
  if (!allianz) throw new Error(`Allianz ${tag} gibt es nicht.`);
  const players = JSON.parse(sql(
    `SELECT COALESCE(json_agg(row_to_json(p)),'[]') FROM ws_players p
      WHERE alliance_id='${allianz.id}' AND active;`));
  const ws = JSON.parse(sql(
    `SELECT COALESCE(data,'null') FROM ws_planner_state
      WHERE alliance_id='${allianz.id}' AND key='ws';`)) || {};
  return { allianz, players, ws };
}

async function serverBereit() {
  try {
    await fetch(SEITE);
    return null;                       // laeuft schon (Playwright-Tests, npm run watch)
  } catch {
    const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
      { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { await fetch(SEITE); return p; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    p.kill();
    throw new Error(`Kein Server auf ${PORT}`);
  }
}

const BLD = {
  infozentrum: 'Infozentrum', oelraf1: 'Ölraffinerie I', oelraf2: 'Ölraffinerie II',
  sciencehub: 'Science Hub', laz1: 'Lazarett I', laz2: 'Lazarett II',
  laz3: 'Lazarett III', laz4: 'Lazarett IV',
};
const TYP = { T: 'Tank', A: 'Air', M: 'Missile' };

function ausgeben(team, e, players) {
  const p = Object.fromEntries(players.map(x => [x.name, x]));
  const kurz = n => {
    const s = p[n] || {};
    const hp = s.hero_power ? (s.hero_power / 1e6).toFixed(0) + 'M' : '—';
    return `${n} (${hp}${s.t1_type ? ', ' + TYP[s.t1_type] : ''})`;
  };
  console.log(`\n══ Team ${team} · ${e.zeit || '?'} EU · verteilt nach ${e.nach} ══════════`);
  const proGebaeude = {};
  for (const [name, bk] of Object.entries(e.bldAssign)) {
    if (!e.pool.includes(name)) continue;
    (proGebaeude[bk] ||= []).push(name);
  }
  for (const bk of e.reihenfolge) {
    if (!proGebaeude[bk]) continue;
    console.log(`  ${(BLD[bk] || bk).padEnd(16)} ${proGebaeude[bk].map(kurz).join(' · ')}`);
  }
  const rollen = [['ass', 'Assassinen (kein Gebäude, ab Min 10 Silo)'],
                  ['ars', 'Arsenal (ab Min 10 Z5)'], ['sold', 'Söldner (ab Min 10 Z5)'],
                  ['sup', 'Springer / Ölquellen']];
  for (const [k, titel] of rollen) {
    if (e.lineup[k]?.length) console.log(`  ${titel}: ${e.lineup[k].map(kurz).join(' · ')}`);
  }
  const shift = Object.entries(e.bldAssignPh2)
    .filter(([n, bk]) => e.pool.includes(n) && bk !== e.bldAssign[n]);
  if (shift.length) {
    console.log('  Phase 2 (ab Min 10) rücken nach:');
    for (const [n, bk] of shift) console.log(`     ${n}: ${BLD[e.bldAssign[n]]} → ${BLD[bk]}`);
  }
  if (e.ersatz.length) console.log(`  Ersatzbank: ${e.ersatz.join(' · ')}`);
  if (e.ohnePlatz.length) console.log(`  OHNE Gebäude: ${e.ohnePlatz.map(kurz).join(' · ')}`);
}

const { allianz, players, ws } = standHolen(TAG);
const server = await serverBereit();
const browser = await chromium.launch();
const page = await browser.newPage();
const writes = [];
await page.route('**/rest/v1/**', route => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
  return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
});
page.on('dialog', d => d.dismiss());    // autoAssign meldet per alert(), wenn Slots fehlen

await page.goto(SEITE);
await page.waitForFunction(() => window.APP && window.autoAssign);

const erg = await page.evaluate(({ allianz, players, ws }) => {
  const APP = window.APP;
  APP.user = { playerName: 'Vorschlag', role: 'superadmin', allianceId: allianz.id, superAdmin: true };
  APP.alliances = [allianz];
  APP.allianceId = allianz.id;
  APP.data.players = players;
  APP.data.events = [];            // kein fixierter Kader → Live-Vorschau aus der Einteilung
  APP.data.participation = [];
  APP.teamAssign = ws.teamAssign || {};
  APP.buildingOrder = ws.buildingOrder;
  APP.bldSlotsA = ws.bldSlotsA;
  APP.bldSlotsB = ws.bldSlotsB;
  APP.wsStrength = ws.wsStrength;
  APP.wsTime = ws.wsTime;
  APP.accepted = Object.keys(APP.teamAssign);
  APP.synced = true;

  const out = {};
  for (const t of ['A', 'B']) {
    APP.team = t;
    APP.bldAssign = {}; APP.bldAssignPh2 = {};
    window.autoAssign();
    const lineup = JSON.parse(JSON.stringify(t === 'B' ? APP.lineupB : APP.lineupA));
    const pool = Object.values(lineup).flat();
    out[t] = {
      zeit: (ws.wsTime || {})[t],
      lineup,
      pool,
      bldAssign: { ...APP.bldAssign },
      bldAssignPh2: { ...APP.bldAssignPh2 },
      reihenfolge: APP.buildingOrder || Object.keys(APP.bldAssign),
      nach: APP.wsStrength === 't1' ? 'T1' : 'Heldenkraft',
      ohnePlatz: pool.filter(n => !APP.bldAssign[n] && !lineup.ass.includes(n)
        && !lineup.ars.includes(n) && !lineup.sold.includes(n) && !lineup.sup.includes(n)),
    };
  }
  return out;
}, { allianz, players, ws });

// `plannerPush` ist um 900 ms entprellt. Ohne das Warten schloesse der Browser,
// bevor der Schreibversuch ueberhaupt losgeht — die Zeile „abgewiesen: keine"
// waere dann keine Auskunft ueber die Sperre, sondern ueber das Timing.
await page.waitForTimeout(1500);

for (const t of ['A', 'B']) {
  erg[t].ersatz = Object.entries(ws.teamAssign || {})
    .filter(([, v]) => v === t + 'E').map(([n]) => n).sort();
  ausgeben(t, erg[t], players);
}
console.log(`\nAbgewiesene Schreibzugriffe: ${writes.length ? writes.join(', ') : 'keine'}`);
console.log('Nichts gespeichert — der Vorschlag steht nur hier.');

await browser.close();
server?.kill();
