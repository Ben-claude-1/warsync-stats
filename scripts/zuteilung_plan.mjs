// Den Verteilungs-Vorschlag als JSON ausgeben — Grundlage fuer den
// Einstell-Dienst.
//
//     node scripts/zuteilung_plan.mjs [XP33] > plan.json
//     node scripts/zuteilung_plan.mjs XP33 --lesbar    # zum Nachsehen
//
// Gerechnet wird **mit der Logik des Werkzeugs selbst**: das Skript oeffnet die
// gebaute App, setzt den echten Stand hinein und drueckt den Knopf des Reiters
// „🧮 Verteilung" (`zuteilungBerechnen()`). Der fertige Vorschlag haengt danach
// an `APP.zutVorschlag`, samt Schrittfolge.
//
// **Die Rechnung darf hier nicht nachgebaut werden.** Eine zweite Fassung liefe
// frueher oder spaeter anders als der Reiter — und dann stellte der Dienst im
// Spiel etwas anderes ein, als Ben auf dem Bildschirm sieht. Genau davor warnt
// CLAUDE.md an mehreren Stellen (Gebaeude-Reihenfolge, Schnittkante).
//
// **Geschrieben wird nichts** — jeder PostgREST-Schreibzugriff wird auf
// Netzwerkebene abgewiesen; siehe `lib/tool_headless.mjs`.
import { appOeffnen, standHolen, standSetzen } from './lib/tool_headless.mjs';

const args = process.argv.slice(2);
const TAG = args.find(a => !a.startsWith('--')) || 'XP33';
const LESBAR = args.includes('--lesbar');

const stand = standHolen(TAG);
const { page, schreibversuche, schliessen } = await appOeffnen({
  warteAuf: () => window.APP && window.zuteilungBerechnen,
});

const plan = await page.evaluate(({ stand, setzen }) => {
  // eslint-disable-next-line no-new-func
  new Function('return ' + setzen)()(stand);
  window.nav('ws');
  window.setWSView('verteilung');
  window.zuteilungBerechnen();
  const v = window.APP.zutVorschlag;
  const kurz = m => ({
    name: m.name, wert: Number((m.wert ?? 0).toFixed(3)), kraft: m.kraft || 0,
    stern: !!m.stern, prio: m.prio || 0, aussetzen: !!m.aussetzen,
    wunschErsatz: !!m.wunschErsatz, wackelt: m.wackelt || null, grund: m.grund || null,
  });
  return {
    tag: stand.allianz.tag,
    eventDate: v.eventDate,
    erzeugt: new Date().toISOString(),
    // Was am Ende im Spiel stehen soll: Name → A / AE / B / BE / AC / BC.
    soll: v.soll,
    // Was das Werkzeug im Moment der Rechnung als Ist kannte. Der Dienst
    // vergleicht damit **nicht** — er liest den Bildschirm. Es steht hier als
    // Beleg, worauf die Schrittfolge gerechnet wurde.
    ist: { ...window.APP.teamAssign },
    schritte: v.schritte.plan,
    offen: v.schritte.offen,
    teams: Object.fromEntries(Object.entries(v.teams).map(([t, d]) => [t, {
      gesetzt: d.gesetzt.map(kurz), ersatz: d.ersatz.map(kurz),
      raus: v.raus.filter(m => m.team === t).map(kurz),
    }])),
  };
}, { stand, setzen: standSetzen.toString() });

plan.abgewieseneSchreibzugriffe = schreibversuche;
await schliessen();

if (!LESBAR) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`Verteilung ${plan.tag} · Event ${plan.eventDate}`);
  for (const [t, d] of Object.entries(plan.teams)) {
    console.log(`\n══ Team ${t} ══ ${d.gesetzt.length}/20 gesetzt · ${d.ersatz.length}/10 Ersatz`);
    console.log(`  gesetzt: ${d.gesetzt.map(m => m.name).join(' · ')}`);
    console.log(`  Ersatz : ${d.ersatz.map(m => m.name).join(' · ')}`);
    console.log(`  zuschauen: ${d.raus.map(m => `${m.name} (${m.grund || '—'})`).join(' · ') || '—'}`);
  }
  console.log(`\n══ ${plan.schritte.length} Schritte in Last War ══`);
  for (const s of plan.schritte) {
    console.log(`  [${s.blatt}] ${s.name}: ${s.alt} → ${s.neu}`
      + (s.ziel && s.ziel !== s.neu ? `  (Ziel ${s.ziel})` : ''));
  }
  if (plan.offen.length) console.log(`  OFFEN: ${plan.offen.map(o => o.name).join(', ')}`);
  console.log(`\nAbgewiesene Schreibzugriffe: ${plan.abgewieseneSchreibzugriffe.join(', ') || 'keine'}`);
}
