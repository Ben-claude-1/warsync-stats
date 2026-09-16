import { APP } from './state.js';
import { wsPower } from './helpers.js';
import { leistungAlle } from './leistung.js';
import { prioOf } from './prio.js';
import { aussetzenFuer } from './aussetzen.js';
import { teamOf, ohnePlatzTeams } from './rotation.js';

// ══════════════════════════════════════════════════════════════════
//  ZUTEILUNG — ein Vorschlag, wer in welche der sechs Kategorien gehört
// ══════════════════════════════════════════════════════════════════
// Bis zum Anmeldeschluss am Donnerstag 04:00 darf jeder Spieler noch zwischen
// `A`/`AE`/`B`/`BE`/`AC`/`BC` verschoben werden. Diese Datei beantwortet die
// Frage, die dabei wirklich zu entscheiden ist: **wer diesmal zuschaut.**
//
// **Die gemeldete Zeit ist die Nebenbedingung, nicht der Wunsch des Planers.**
// Wer sich für 13:00 gemeldet hat, steht in der A-Liste; das Kürzel trägt sie
// mit (`AC` heißt „für A gemeldet, kein Platz"). Zwischen den Teams zu schieben
// hieße, jemanden auf eine Zeit einzuteilen, für die er sich nicht gemeldet hat
// — möglich, aber eine Wette darauf, dass er erscheint. Deshalb wird je Zeit
// getrennt gerechnet, und die Zahl der Ausschlüsse ergibt sich daraus von
// selbst: am 16.09.2026 standen 31 Leute für 30 A-Plätze und 39 für 30 B-Plätze.
//
// **`AE`/`BE` ist kein Ausschluss.** Im Wüstensturm spielen alle 30
// gleichzeitig; der Ersatz bekommt nur kein Gebäude. Wer wirklich zuschaut,
// steht auf `AC`/`BC`.
//
// Die Reihenfolge der Regeln ist Absicht und steht in `AUSSCHLUSS_REGELN`:
// erst die Regel, die die Allianz sich selbst gegeben hat (wer gefehlt hat,
// setzt aus), dann der Stern, dann die Leistung. Die Prio-Marke wiegt dabei
// einen halben Index — sie ist ein Gewicht, **kein** Freibrief; warum, steht
// bei `ZUT_PRIO_BONUS`.

export const ZUT_MAX_GESETZT = 20, ZUT_MAX_ERSATZ = 10;
export const ZUT_PLAETZE = ZUT_MAX_GESETZT + ZUT_MAX_ERSATZ;

// Ab diesem Leistungsindex rückt ein Stern an der Grenze noch in die 20 vor.
// 1,5 ist kein runder Zufall: der Median liegt bei 1,0, und wer die Hälfte
// darüber liegt, hat das über mehrere Events gezeigt — darunter wäre es
// Tagesform gegen 10 Mio Heldenkraft Unterschied.
export const ZUT_STERN_INDEX = 1.5;

// Was eine Prio-Marke auf der Index-Skala wiegt. Sie **schützt nicht absolut**:
// am 16.09.2026 stand die Regel einmal als harter Schutz da, und dann flog
// `ZEUS XS` (133 Mio, Index 0,74) heraus, während `Little Kong` (101 Mio, Index
// 0,19) blieb — die Fairness-Regel hätte die Mannschaft geschwächt, statt sie
// zu drehen. Ein halber Index zieht jemanden an der Grenze heraus, nicht
// jemanden, der weit unten steht: 0,19 + 0,5 bleibt unter 0,74, 0,33 + 0,5
// liegt darüber.
export const ZUT_PRIO_BONUS = 0.5;

export const AUSSCHLUSS_REGELN = [
  'Wer beim letzten Mal gefehlt hat, setzt aus (⛔-Marke).',
  'Ein Stern schützt — wer viel bringt, schaut nicht zu.',
  'Danach entscheidet der Leistungsindex; eine Prio-Marke zählt dabei wie ein halber Index.',
  'Bei Gleichstand entscheidet die Stärke.',
];

function spieler(name) {
  return (APP.data.players || []).find(p => p.name === name) || null;
}

// Alles, was über einen Spieler in die Entscheidung eingeht — einmal gesammelt,
// damit Sortierung und Begründung dieselbe Auskunft benutzen und nicht
// auseinanderlaufen können.
function merkmale(name, leist, eventDate) {
  const p = spieler(name) || {};
  const l = leist[name] || {};
  return {
    name,
    kraft: wsPower(name) || 0,
    stern: !!p.stern,
    wunschErsatz: !!p.ersatz_wunsch,
    index: l.index ?? null,
    indexEvents: l.events || 0,
    prio: prioOf(name),
    aussetzen: !!(eventDate && aussetzenFuer(name, 'ws', eventDate)),
  };
}

// Je kleiner, desto eher fliegt er raus. Lexikografisch, damit die Reihenfolge
// der Kriterien dieselbe ist wie in AUSSCHLUSS_REGELN — und nicht in einer
// gewichteten Summe verschwindet, die niemand mehr nachrechnen kann.
function schutz(m) {
  // Ein fehlender Index heißt „nicht gemessen", nicht „schlecht" — er zählt
  // deshalb als Durchschnitt. Sonst flöge jeder Neuzugang zuerst.
  const wert = (m.index ?? 1) + (m.prio > 0 ? ZUT_PRIO_BONUS : 0);
  return [m.stern ? 1 : 0, wert, m.kraft];
}

function kleiner(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function grundText(m) {
  const teile = [];
  if (!m.stern) teile.push('kein Stern');
  teile.push(m.index == null ? 'kein Index' : 'Index ' + m.index.toFixed(2));
  if (m.prio > 0) teile.push('Prio ' + m.prio + ' (+' + ZUT_PRIO_BONUS + ')');
  teile.push(Math.round(m.kraft) + ' Mio');
  return teile.join(' · ');
}

// ── Der Vorschlag ───────────────────────────────────────────────────────────
export function zuteilungVorschlag({ eventDate } = {}) {
  const ta = APP.teamAssign || {};
  const leist = leistungAlle();
  const aktiv = new Set((APP.data.players || []).filter(p => p.active !== false).map(p => p.name));

  const pool = { A: [], B: [] }, beide = [];
  Object.entries(ta).forEach(([name, wert]) => {
    if (!aktiv.has(name)) return;            // stillgelegt: gehört in keine Liste
    const t = teamOf(wert);
    if (t) { pool[t].push(name); return; }
    const teams = ohnePlatzTeams(wert);
    if (teams.length === 2) beide.push(name);
    else if (teams[0]) pool[teams[0]].push(name);
  });

  // Wer sich für **beide** Zeiten gemeldet hat, geht dorthin, wo Plätze fehlen.
  // Das ist der einzige Hebel, mit dem sich die beiden Listen überhaupt
  // ausgleichen lassen, ohne jemanden auf eine fremde Zeit zu setzen.
  beide.sort((a, b) => (wsPower(b) || 0) - (wsPower(a) || 0));
  beide.forEach(name => {
    const luecke = t => ZUT_PLAETZE - pool[t].length;
    pool[luecke('A') >= luecke('B') ? 'A' : 'B'].push(name);
  });

  const soll = {}, raus = [], teams = {};
  ['A', 'B'].forEach(t => {
    const kand = pool[t].map(n => merkmale(n, leist, eventDate));

    // 1. Wer gefehlt hat, setzt aus.
    const drin = [];
    kand.forEach(m => {
      if (m.aussetzen) raus.push({ ...m, team: t, grund: 'hat beim letzten Mal gefehlt' });
      else drin.push(m);
    });

    // 2. Überhang: der am wenigsten geschützte zuerst.
    while (drin.length > ZUT_PLAETZE) {
      let schwach = 0;
      for (let i = 1; i < drin.length; i++) {
        if (kleiner(schutz(drin[i]), schutz(drin[schwach])) < 0) schwach = i;
      }
      const m = drin.splice(schwach, 1)[0];
      raus.push({ ...m, team: t, grund: grundText(m) });
    }

    // 3. Gesetzt oder Ersatz. Ein ausdrücklicher Ersatz-Wunsch geht vor die
    //    Rangfolge — er ist eine Aussage des Spielers, keine Schätzung über ihn.
    const wunsch = drin.filter(m => m.wunschErsatz).slice(0, ZUT_MAX_ERSATZ);
    const wunschNamen = new Set(wunsch.map(m => m.name));
    const feld = drin.filter(m => !wunschNamen.has(m.name))
      .sort((a, b) => b.kraft - a.kraft);
    const platzGesetzt = Math.min(ZUT_MAX_GESETZT, feld.length);
    const gesetzt = feld.slice(0, platzGesetzt);
    const ersatz = [...wunsch, ...feld.slice(platzGesetzt)];

    // 4. Ein Stern mit belegter Leistung rückt am **Rand** der 20 noch vor —
    //    nicht mitten hinein. Getauscht wird nur gegen den Schwächsten der 20,
    //    und nur wenn der weder Stern trägt noch den besseren Index hat. Ohne
    //    diese Enge verdrängte ein 116-Mio-Stern einen 132-Mio-Spieler.
    for (let schutzZaehler = 0; schutzZaehler < ZUT_MAX_ERSATZ; schutzZaehler++) {
      const letzter = [...gesetzt].reverse().find(m => !m.stern);
      const bester = ersatz.find(m => !m.wunschErsatz && m.stern
        && (m.index ?? 0) >= ZUT_STERN_INDEX);
      if (!letzter || !bester) break;
      if ((bester.index ?? 0) <= (letzter.index ?? 1)) break;
      gesetzt[gesetzt.indexOf(letzter)] = bester;
      ersatz[ersatz.indexOf(bester)] = letzter;
      bester.vorgerueckt = letzter.name;
    }

    gesetzt.sort((a, b) => b.kraft - a.kraft);
    ersatz.sort((a, b) => b.kraft - a.kraft);
    gesetzt.forEach(m => { soll[m.name] = t; });
    ersatz.forEach(m => { soll[m.name] = t + 'E'; });
    teams[t] = { gesetzt, ersatz };
  });
  raus.forEach(m => { soll[m.name] = m.team + 'C'; });

  return { soll, teams, raus, regeln: AUSSCHLUSS_REGELN };
}

// ── Die Reihenfolge, in der es im Spiel eingestellt wird ────────────────────
// Alle vier Töpfe sind voll (20 gesetzt + 10 Ersatz je Team). Solange das so
// ist, nimmt Last War **keinen** Wechsel an — es muss immer erst einer heraus.
// Diese Funktion legt die Züge deshalb so, dass nach jedem einzelnen Schritt
// jeder Zähler innerhalb seiner Grenze bleibt, und gruppiert sie nach Blatt,
// damit nicht zwanzigmal umgeschaltet werden muss.
//
// Ein Wechsel über die Teamgrenze zerfällt dabei in zwei Schritte: auf dem
// einen Blatt abmelden, auf dem anderen setzen. Anders ist er nicht zu bedienen.
export const ZUT_CAP = { A: ZUT_MAX_GESETZT, AE: ZUT_MAX_ERSATZ, B: ZUT_MAX_GESETZT, BE: ZUT_MAX_ERSATZ };
const blattVon = w => (w === 'A' || w === 'AE' || w === 'AC') ? 'A' : 'B';

export function zuteilungSchritte(ist, soll) {
  const stand = { A: 0, AE: 0, B: 0, BE: 0 };
  Object.values(ist || {}).forEach(w => { if (stand[w] !== undefined) stand[w]++; });
  let offen = Object.entries(soll)
    .filter(([n, w]) => (ist || {})[n] !== w)
    .map(([n, w]) => ({ name: n, alt: (ist || {})[n] || '—', neu: w }));

  const plan = [];
  ['A', 'B'].forEach(blatt => {
    for (let schutzZaehler = 0; schutzZaehler <= offen.length * 4 + 8; schutzZaehler++) {
      const moeglich = [];
      offen.forEach(m => {
        const vonHier = blattVon(m.alt) === blatt && ZUT_CAP[m.alt] !== undefined;
        const nachHier = blattVon(m.neu) === blatt;
        if (!vonHier && !nachHier) return;
        // Teamwechsel: auf diesem Blatt kann nur abgemeldet werden.
        if (vonHier && !nachHier) { moeglich.push({ m, art: 'raus' }); return; }
        if (ZUT_CAP[m.neu] !== undefined && stand[m.neu] >= ZUT_CAP[m.neu]) return;
        moeglich.push({ m, art: 'zug' });
      });
      if (!moeglich.length) break;
      // Erst freiräumen, dann füllen — und unter den Füllzügen der, dessen Topf
      // am engsten ist. Andersherum verstopft man sich den eigenen Weg.
      moeglich.sort((x, y) => {
        const raeumt = k => (k.art === 'raus' || ZUT_CAP[k.m.neu] === undefined) ? 0 : 1;
        const luft = k => ZUT_CAP[k.m.neu] === undefined ? 99 : ZUT_CAP[k.m.neu] - stand[k.m.neu];
        return raeumt(x) - raeumt(y) || luft(x) - luft(y);
      });
      const { m, art } = moeglich[0];
      offen = offen.filter(o => o !== m);
      if (ZUT_CAP[m.alt] !== undefined) stand[m.alt]--;
      if (art === 'raus') {
        plan.push({ blatt, name: m.name, alt: m.alt, neu: '—', ziel: m.neu, stand: { ...stand } });
        offen.push({ name: m.name, alt: '—', neu: m.neu });
      } else {
        if (ZUT_CAP[m.neu] !== undefined) stand[m.neu]++;
        plan.push({ blatt, name: m.name, alt: m.alt, neu: m.neu, ziel: m.neu, stand: { ...stand } });
      }
    }
  });
  return { plan, offen, stand };
}
