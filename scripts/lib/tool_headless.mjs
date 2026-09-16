// Die gebaute App headless oeffnen und mit dem echten Stand fuellen.
//
// Zwei Skripte brauchen dasselbe: `vorschlag_zuteilung.mjs` (Aufstellung) und
// `zuteilung_plan.mjs` (Verteilung, Grundlage fuer den Einstell-Dienst). Beide
// rechnen bewusst **mit der Logik des Werkzeugs selbst** statt sie nachzubauen —
// und beide brauchen dafuer denselben Vorbau: Stand aus Postgres holen, kleinen
// Webserver hochziehen, Browser oeffnen, **jeden** Schreibzugriff auf
// Netzwerkebene abfangen.
//
// Der Vorbau stand kurz in beiden Dateien. Zwei Kopien laufen auseinander,
// sobald jemand nur eine anfasst — dieselbe Falle wie bei der
// Gebaeude-Reihenfolge, die an drei Stellen stand.
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

export const PORT = 8799;   // derselbe Port wie die Playwright-Tests, siehe ~/.claude/PORTS.md
export const SEITE = `http://127.0.0.1:${PORT}/index.html`;

const WURZEL = new URL('../..', import.meta.url).pathname;

function sql(text) {
  return execFileSync('docker', ['exec', '-i', 'supabase-db', 'psql', '-U', 'postgres',
    '-d', 'postgres', '-t', '-A', '-c', text], { encoding: 'utf8' }).trim();
}

/** Alles, was die Rechnungen des Werkzeugs brauchen — direkt aus Postgres.
 *
 * Nicht ueber die App: die haengt am Tailscale-Funnel, und der ist fuer eine
 * Rechnung auf demselben Rechner ein Umweg.
 */
export function standHolen(tag) {
  const allianz = JSON.parse(sql(
    `SELECT COALESCE(row_to_json(a),'null') FROM alliances a WHERE tag='${tag}';`));
  if (!allianz) throw new Error(`Allianz ${tag} gibt es nicht.`);
  const aid = allianz.id;
  const j = (t, wo) => JSON.parse(sql(
    `SELECT COALESCE(json_agg(row_to_json(x)),'[]') FROM ${t} x WHERE ${wo};`));
  return {
    allianz,
    players: j('ws_players', `x.alliance_id='${aid}' AND x.active`),
    priority: j('ws_priority', `x.alliance_id='${aid}'`),
    aussetzen: j('ws_aussetzen', `x.alliance_id='${aid}'`),
    events: j('ws_events', `x.alliance_id='${aid}'`),
    // Teilnahmen haengen ueber das Event an der Allianz, nicht selbst.
    participation: j('ws_participation',
      `x.event_id IN (SELECT id FROM ws_events WHERE alliance_id='${aid}')`),
    ws: JSON.parse(sql(
      `SELECT COALESCE(data,'null') FROM ws_planner_state
        WHERE alliance_id='${aid}' AND key='ws';`)) || {},
  };
}

async function serverBereit() {
  try {
    await fetch(SEITE);
    return null;                       // laeuft schon (Playwright-Tests, npm run watch)
  } catch {
    const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
      { cwd: WURZEL, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { await fetch(SEITE); return p; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    p.kill();
    throw new Error(`Kein Server auf ${PORT}`);
  }
}

/** Browser auf die App, **alle** Schreibzugriffe gesperrt.
 *
 * GET liefert `[]`, alles andere 403 — wie `isolateDb` in `tests/helpers.js`.
 * Ohne die Sperre landete eine Rechnung ungefragt als neue Aufstellung der
 * ganzen Allianz im Planungsstand.
 *
 * Zurueck kommt `schliessen()`; es wartet vor dem Zumachen 1,5 s, weil
 * `plannerPush` um 900 ms entprellt ist. Ohne das Warten waere „abgewiesen:
 * keine" keine Auskunft ueber die Sperre, sondern ueber das Timing.
 */
export async function appOeffnen({ warteAuf = () => window.APP } = {}) {
  const server = await serverBereit();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const schreibversuche = [];
  await page.route('**/rest/v1/**', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    schreibversuche.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
  });
  page.on('dialog', d => d.dismiss());
  await page.goto(SEITE);
  await page.waitForFunction(warteAuf);
  return {
    page, schreibversuche,
    async schliessen() {
      await page.waitForTimeout(1500);
      await browser.close();
      server?.kill();
    },
  };
}

/** Den geholten Stand in die App setzen — als angemeldeter Super-Admin. */
export const standSetzen = ({ allianz, players, priority, aussetzen, events,
                              participation, ws }) => {
  const APP = window.APP;
  APP.user = { playerName: 'Vorschlag', role: 'superadmin', allianceId: allianz.id, superAdmin: true };
  APP.alliances = [allianz];
  APP.allianceId = allianz.id;
  APP.data.players = players;
  APP.data.priority = priority;
  APP.data.aussetzen = aussetzen;
  APP.data.events = events;
  APP.data.participation = participation;
  APP.teamAssign = ws.teamAssign || {};
  APP.buildingOrder = ws.buildingOrder;
  APP.bldSlotsA = ws.bldSlotsA;
  APP.bldSlotsB = ws.bldSlotsB;
  APP.wsStrength = ws.wsStrength;
  APP.wsTime = ws.wsTime;
  APP.accepted = Object.keys(APP.teamAssign);
  APP.synced = true;
};
