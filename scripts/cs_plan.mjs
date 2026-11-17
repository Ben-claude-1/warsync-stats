// Die Schluchtsturm-Aufstellung als JSON ausgeben — Grundlage fuer
// `cs_service.einstellen --plan`.
//
//     node scripts/cs_plan.mjs [XP33] > plan.json
//     node scripts/cs_plan.mjs XP33 --lesbar    # zum Nachsehen
//
// Das Gegenstueck zu `zuteilung_plan.mjs`. Gerechnet wird **mit der Logik des
// Werkzeugs selbst**: `csRosterGroups(team)` ist dieselbe Funktion, die der
// Reiter „Aufstellung" zeigt (fest + Rotation-Haupt = gesetzt, Rotation-Ersatz
// = Ersatzbank, Warteliste = ohne Platz), und `csAutoAssign()` derselbe Knopf
// „Auto-Verteilung", der die Gebaeude vergibt. Nachgebaut wird nichts.
//
// `soll` traegt dieselben Werte wie `csTeamAssign`:
//   gesetzt → 'A'/'B', Ersatz → 'AE'/'BE', Warteliste → 'AC'/'BC' (bleibt).
//
// **Geschrieben wird nichts** — jeder PostgREST-Schreibzugriff wird auf
// Netzwerkebene abgewiesen (`lib/tool_headless.mjs`). Ins Werkzeug kommt der
// Plan erst, wenn der Einsteller ihn im Spiel gesetzt hat (`event_ablauf.py`).
import { appOeffnen, standHolen, standSetzen } from './lib/tool_headless.mjs';

const args = process.argv.slice(2);
const TAG = args.find(a => !a.startsWith('--')) || 'XP33';
const LESBAR = args.includes('--lesbar');

const stand = standHolen(TAG);
const { page, schreibversuche, schliessen } = await appOeffnen({
  warteAuf: () => window.APP && window.__headless && window.csAutoAssign,
});

const plan = await page.evaluate(({ stand, setzen }) => {
  // eslint-disable-next-line no-new-func
  new Function('return ' + setzen)()(stand);
  const APP = window.APP;
  // csLoadState liest ueber plannerResolve: der geteilte Stand gewinnt, der
  // localStorage des frischen Browsers ist leer.
  APP.planner = { ...(APP.planner || {}), cs: stand.cs };
  window.__headless.csLoadState();
  // „Anmeldung geschlossen" heisst fuer `csRosterGroups`: die eingefrorene
  // Aufstellung des letzten CS-Events gilt. Das stimmt nur, solange dieses
  // Event noch bevorsteht. Ist es vorbei, ist der Schalter ein Rest der
  // Vorwoche — am 18.11.2026 stand er noch vom Kampf des 17.11. auf `true`, und
  // die Rechnung haette die alte Aufstellung zurueckgegeben statt einer aus den
  // neuen Anmeldungen.
  // Datum in Berlin, nicht UTC: um 00:17 Uhr stand UTC noch auf dem Vortag.
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const letztes = APP.data.events.filter(e => e.mode === 'cs')
    .map(e => e.event_date).sort().pop();
  const eingefroren = !!APP.csAnmeldungClosed && !!letztes && letztes >= heute;
  if (APP.csAnmeldungClosed && !eingefroren) APP.csAnmeldungClosed = false;
  const vorher = { ...(APP.csTeamAssign || {}) };
  const kraft = n => (APP.data.players.find(p => p.name === n) || {}).hero_power || 0;

  const soll = {};
  const teams = {};
  for (const t of ['A', 'B']) {
    const g = window.__headless.csRosterGroups(t);
    const gesetzt = [...g.fest, ...g.rotationHaupt];
    gesetzt.forEach(n => { soll[n] = t; });
    g.rotationErsatz.forEach(n => { soll[n] = t + 'E'; });
    g.warteliste.forEach(n => { soll[n] = t + 'C'; });
    // Gebaeude wie der Knopf „Auto-Verteilung" — auf die Gruppen von oben.
    APP.csTeam = t;
    window.csAutoAssign();
    teams[t] = {
      fest: g.fest, rotationHaupt: g.rotationHaupt, ersatz: g.rotationErsatz,
      warteliste: g.warteliste,
      plan: JSON.parse(JSON.stringify(t === 'B' ? APP.csPlanB : APP.csPlanA)),
    };
  }
  // Angemeldet ohne Team ('C') und wer in keiner Gruppe landet (inaktiv):
  // so lassen, wie es war — ueber sie sagt die Aufstellung nichts.
  for (const [n, w] of Object.entries(vorher)) if (!(n in soll)) soll[n] = w;

  const schritte = [];
  for (const blatt of ['A', 'B']) {
    for (const wert of [blatt, blatt + 'E']) {
      Object.keys(soll).filter(n => soll[n] === wert)
        .sort((a, b) => kraft(b) - kraft(a))
        .forEach(n => schritte.push({ blatt, name: n, alt: vorher[n] || null, neu: wert }));
    }
  }
  return {
    tag: stand.allianz.tag, eventDate: 'Schluchtsturm',
    erzeugt: new Date().toISOString(),
    // true: die Aufstellung ist die im Tool eingefrorene eines bevorstehenden
    // Events, nicht neu gerechnet.
    anmeldungGeschlossen: eingefroren, letztesEvent: letztes || null,
    soll, ist: vorher, schritte, offen: [], teams,
  };
}, { stand, setzen: standSetzen.toString() });

plan.abgewieseneSchreibzugriffe = schreibversuche;
await schliessen();

if (!LESBAR) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`Schluchtsturm ${plan.tag} · Aufstellung`
    + (plan.anmeldungGeschlossen
      ? ` (eingefroren fuer das Event vom ${plan.letztesEvent})`
      : ' (aus den aktuellen Anmeldungen gerechnet)'));
  for (const [t, d] of Object.entries(plan.teams)) {
    const n = d.fest.length + d.rotationHaupt.length;
    console.log(`\n══ Team ${t} ══ ${n}/20 gesetzt · ${d.ersatz.length}/10 Ersatz`);
    console.log(`  fest    : ${d.fest.join(' · ')}`);
    console.log(`  Rotation: ${d.rotationHaupt.join(' · ') || '—'}`);
    console.log(`  Ersatz  : ${d.ersatz.join(' · ') || '—'}`);
    console.log(`  Warteliste: ${d.warteliste.join(' · ') || '—'}`);
    const geb = {};
    for (const [name, p] of Object.entries(d.plan || {})) {
      const k = p.s || `→${p.d}`;
      (geb[k] = geb[k] || []).push(name);
    }
    for (const [k, nn] of Object.entries(geb)) console.log(`    ${k}: ${nn.join(', ')}`);
  }
  console.log(`\n${plan.schritte.length} Plaetze zu setzen.`);
  console.log(`Abgewiesene Schreibzugriffe: ${plan.abgewieseneSchreibzugriffe.join(', ') || 'keine'}`);
}
