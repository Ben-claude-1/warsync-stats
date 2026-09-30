import { APP } from './state.js';
import { wsPower } from './helpers.js';
import { leistungAlle } from './leistung.js';
import { prioCGesamt, prioOf } from './prio.js';
import { aussetzenFuer } from './aussetzen.js';
import { abmeldungFuer } from './abmeldung.js';
import { EINSATZ_LEER, einsatzBilanzAlle, teamOf, ohnePlatzTeams } from './rotation.js';

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
// setzt aus), dann **die Rotation**, und erst danach die Leistung.
//
// **Die Rotation entscheidet, der Index sortiert nur noch innerhalb** (Vorgabe
// Ben, 30.09.2026). Bis dahin war es umgekehrt: der Index stand vorn, und
// Fairness war ein Bonus darauf — eine Prio-Marke wog einen halben Index, jede
// frühere C-Runde ein Fünftel, gedeckelt bei 0,6. Das hat nachweislich nicht
// rotiert, sondern immer dieselben getroffen. Am 30.09.2026 durchgerechnet:
// `Carmen0804` (Index 0,11), `KiLLuminaTi` (0,28) und `Stalker24601` (0,23)
// standen zum **dritten** Mal auf der Raus-Liste, während 39 von 73
// Angemeldeten noch **nie** zugeschaut hatten. Der Grund war rechnerisch:
// der Bonus war bei 0,6 gedeckelt, die Indexspanne lag bei 0,26 … 6,56 —
// Carmen0804 fehlten 0,44 zur Kante, am Deckel wären es noch 0,24 gewesen.
// **Ein gedeckelter Bonus kann eine Rangfolge nicht drehen, er kann sie nur
// beugen.** Deshalb ist die Rotation jetzt der erste Schlüssel und keine
// Zugabe: gezählt wird `ws_priority.c_total`, wer am seltensten zugeschaut hat,
// schaut als nächster zu.
//
// Der Stern bleibt ein Vorzug, aber ein kleiner (`ZUT_STERN_ROT`) — „auch die
// mit einem Stern sollen ein klein wenig öfter aufgestellt werden", nicht
// „Sterne sind ausgenommen". Vorher schützte er absolut, und das war an der
// Grenze sichtbar: `Ghost Fighter X` blieb mit einem Wert von 0,52 drin,
// während `KiLLuminaTi` mit 0,68 ging.
//
// **Die Bank rotiert genauso** (Schritt 4 unten, ebenfalls 30.09.2026). Vorher
// besetzte sie die Kraft: die stärksten 20 in die Aufstellung, der Rest ohne
// Gebäude. Über vier WS-Tage gemessen war das keine Rotation, sondern eine
// Einteilung auf Dauer — **42 von 89** Spielern mit Historie waren noch nie auf
// der Bank, **20 ausschließlich** dort. Gezählt wird dafür die Historie selbst
// (`einsatzBilanzAlle()` über `ws_participation.substitute`), nicht ein neuer
// Zähler: eine abgeleitete Zahl kann nicht auseinanderlaufen.
//
// **Die Festen rotieren dabei nicht** (Entscheidung Ben, 30.09.2026): „fest
// gesetzt" heißt fest *in der Aufstellung*. Sonst stünden je Woche drei bis vier
// der zehn Stärksten ohne Gebäude da, und das Silo ginge an einen Schwächeren.

export const ZUT_MAX_GESETZT = 20, ZUT_MAX_ERSATZ = 10;
export const ZUT_PLAETZE = ZUT_MAX_GESETZT + ZUT_MAX_ERSATZ;

// Was ein Stern in der **Rotation** wiegt: einen halben Schritt. Die Zahl ist
// nicht beliebig, sie folgt daraus, dass `c_total` ganzzahlig ist — ein halber
// Schritt zieht einen Stern damit an allen vorbei, die **gleich oft**
// zugeschaut haben, und an niemandem, der eine ganze Runde weiter ist. Genau
// das ist „ein klein wenig öfter aufgestellt": der Stern ist innerhalb seiner
// Stufe immer der Letzte, den es trifft, aber die Stufe selbst holt ihn ein.
//
// Jede Zahl ≥ 1 wäre etwas anderes — dann übersprünge ein Stern eine ganze
// Runde und wäre praktisch wieder ausgenommen, und damit stünde hier die alte
// Regel unter neuem Namen.
export const ZUT_STERN_ROT = 0.5;

// Wie viele je Team an der Schnittkante hervorgehoben werden — auf jeder Seite.
// Drei, weil ein Tausch von Hand fast immer 1:1 ist und man die Alternative
// daneben sehen will; bei einem einzigen stünde da eine Behauptung statt einer
// Auswahl, bei zehn wäre es wieder die ganze Liste.
export const ZUT_GRENZE_N = 3;

// Wie viele der Stärksten je Team einen **festen** Platz haben, wenn der
// Aufrufer nichts anderes sagt. Die echte Zahl steht je Allianz in
// `alliances.ws_fixed_count` (Default 15) und wird von `wsFixedCount()` in
// ui/ws.js hereingereicht — core darf nicht auf ui zugreifen.
export const ZUT_FIX_DEFAULT = 15;

export const AUSSCHLUSS_REGELN = [
  'Wer sich vorher abgemeldet hat, wird nicht eingeplant — und gilt als entschuldigt.',
  'Die stärksten Angemeldeten je Team haben einen festen Platz (Zahl oben einstellbar) und schauen nie zu.',
  'Wer beim letzten Mal gefehlt hat, setzt aus (⛔-Marke).',
  'Alle übrigen rotieren: wer bisher am seltensten zugeschaut hat, schaut als nächster zu.',
  'Ein Stern wiegt dabei einen halben Schritt — er spielt etwas öfter, ist aber nicht ausgenommen.',
  'Erst innerhalb derselben Rotationsstufe entscheidet der Leistungsindex.',
  'Bei Gleichstand entscheidet die Stärke.',
];

function spieler(name) {
  return (APP.data.players || []).find(p => p.name === name) || null;
}

// Alles, was über einen Spieler in die Entscheidung eingeht — einmal gesammelt,
// damit Sortierung und Begründung dieselbe Auskunft benutzen und nicht
// auseinanderlaufen können.
function merkmale(name, leist, eventDate, bilanz) {
  const p = spieler(name) || {};
  const l = leist[name] || {};
  // Die Bank-Historie kommt **einmal** von außen herein, nicht je Spieler neu:
  // `einsatzBilanzAlle()` läuft über alle Teilnahme-Zeilen, und bei vierstellig
  // vielen wäre ein Aufruf je Spieler spürbar (siehe rotation.js).
  const b = (bilanz && bilanz[name]) || EINSATZ_LEER;
  return {
    name,
    bank: b.ws.ersatz,
    aufgestellt: b.ws.gesetzt,
    kraft: wsPower(name) || 0,
    stern: !!p.stern,
    wunschErsatz: !!p.ersatz_wunsch,
    index: l.index ?? null,
    indexEvents: l.events || 0,
    prio: prioOf(name),
    cGesamt: prioCGesamt(name),
    aussetzen: !!(eventDate && aussetzenFuer(name, 'ws', eventDate)),
    abgemeldet: !!(eventDate && abmeldungFuer(name, 'ws', eventDate)),
  };
}

// Der **Rotationsstand**: wie oft jemand schon zugeschaut hat, plus der halbe
// Schritt für einen Stern. Das ist der erste Schlüssel der Rangfolge — je höher,
// desto eher hat er einen Platz verdient.
//
// Gezählt wird `ws_priority.c_total`, nicht `counter`: der Zähler fällt auf 0
// zurück, sobald jemand wieder gespielt hat, und wer abwechselnd spielt und
// zuschaut, stünde darin dauerhaft bei 0 (so war es bei allen drei Spielern vom
// 30.09.2026). `c_total` zählt nur hoch und ist damit das einzige Buch, in dem
// eine Rotation überhaupt stehen kann. Wer keine Zeile hat, hat nie zugeschaut.
function rotVon(m) {
  return (m.cGesamt || 0) + (m.stern ? ZUT_STERN_ROT : 0);
}

// Der Leistungswert, der **innerhalb** einer Rotationsstufe sortiert. Er steht
// am Spieler, damit Rangfolge und Anzeige dieselbe Zahl benutzen — sonst zeigte
// die Oberfläche etwas anderes, als die Sortierung gerechnet hat.
// Ein fehlender Index heißt „nicht gemessen", nicht „schlecht", und zählt
// deshalb als Durchschnitt.
function wertVon(m) {
  return m.index ?? 1;
}

// Wer als nächster auf die Ersatzbank gehört — je **kleiner**, desto eher.
// Vier Schlüssel, und jeder beantwortet eine eigene Frage:
//
// 1. **Wie oft war er schon auf der Bank** (`bank`, aus der Historie).
// 2. **Wie oft war er gesetzt** — absteigend. Ohne das stünde ein Neuzugang mit
//    einem Einsatz gleichauf mit jemandem, der vier Wochen ein Gebäude hatte:
//    beide waren null Mal auf der Bank. Wer mehr gute Plätze hatte, ist zuerst
//    dran.
// 3. **Der Stern** — und zwar *hinter* der Historie, nicht in ihr. Als halber
//    Schritt auf Schlüssel 1 geschrieben (so stand es hier zuerst) übersprang er
//    die **ganze** zweite Ordnung: ein Stern mit drei Einsätzen landete hinter
//    jedem, der noch gar nie gespielt hatte, weil 0,5 > 0 ist. Das ist kein
//    „klein wenig", das ist eine Ausnahme. Aufgefallen am Test „ein Stern geht
//    auf der Bank als Letzter, überspringt aber keine Runde".
//
//    Beim Zuschauen (`rotVon`) steht der halbe Schritt weiterhin im ersten
//    Schlüssel, und das ist **kein** Widerspruch: dort gibt es keinen zweiten
//    Historien-Schlüssel, den er überspringen könnte, und weil `c_total`
//    ganzzahlig ist, sind beide Schreibweisen dort nachweislich dasselbe.
// 4. **Die Kraft** — aufsteigend, als letzter Ausweg bei gleicher Historie. Nur
//    hier darf die Stärke noch entscheiden: sie kostet die Rotation nichts, weil
//    die beiden ohnehin gleich viel Anspruch haben, und sie stellt das
//    wertvollere Gebäude dem Stärkeren zu.
function bankVon(m) {
  return [m.bank || 0, -(m.aufgestellt || 0), m.stern ? 1 : 0, m.kraft];
}

// Je kleiner, desto eher fliegt er raus. Lexikografisch, damit die Reihenfolge
// der Kriterien dieselbe ist wie in AUSSCHLUSS_REGELN — und nicht in einer
// gewichteten Summe verschwindet, die niemand mehr nachrechnen kann.
//
// **Die Reihenfolge der drei Einträge ist die ganze Regel.** Stand `stern` hier
// vorn und der Index davor, war ein Stern unantastbar und der Index schlug jede
// Rotation; seit dem 30.09.2026 steht die Rotation vorn und trägt den Stern als
// halben Schritt in sich. Wer hier tauscht, tauscht die Vorgabe.
function schutz(m) {
  return [m.rot, m.wert, m.kraft];
}

function kleiner(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Die Begründung nennt die Kriterien in der Reihenfolge, in der sie gegriffen
// haben — die Rotation zuerst, weil sie entscheidet. „Noch nie zugeschaut" ist
// dabei die eigentliche Auskunft und keine Nebenbemerkung: sie ist der Grund,
// aus dem jemand jetzt an der Reihe ist.
function grundText(m) {
  const teile = [m.cGesamt > 0 ? 'schon ' + m.cGesamt + '× zugeschaut' : 'noch nie zugeschaut'];
  if (m.stern) teile.push('Stern (+' + ZUT_STERN_ROT + ')');
  teile.push(m.index == null ? 'kein Index' : 'Index ' + m.index.toFixed(2));
  teile.push(Math.round(m.kraft) + ' Mio');
  return teile.join(' · ');
}

// ── Der Vorschlag ───────────────────────────────────────────────────────────
// `fixCount` ist die Zahl der festen Plätze je Team — die stärksten so vielen
// Angemeldeten einer Uhrzeit. Sie kommt aus `alliances.ws_fixed_count` und wird
// hereingereicht, weil core nicht auf ui zugreifen darf.
//
// **Ein fester Platz schlägt auch die ⛔-Marke** (Entscheidung Ben, 18.09.2026).
// Wer die Mannschaft trägt, wird nicht wegen eines einzelnen Fehlens aus dem
// wichtigsten Event der Woche genommen. Das ist bewusst die Umkehrung der
// bisherigen Reihenfolge, und es wäre ein Freibrief — deshalb kam im selben
// Zug die **Vorab-Abmeldung** dazu (core/abmeldung.js): wer sagt, dass er
// fehlt, wird nicht eingeplant und ist entschuldigt; wer wortlos wegbleibt,
// setzt weiterhin aus. Die ⛔-Marke bleibt für alle unterhalb der Fixplätze in
// Kraft und steht auch bei den Übergangenen sichtbar in der Liste — sie
// verschwindet nicht, sie wird nur nicht vollstreckt.
export function zuteilungVorschlag({ eventDate, fixCount } = {}) {
  const fixN = Math.max(0, Math.min(ZUT_MAX_GESETZT,
    Number.isFinite(fixCount) ? fixCount : ZUT_FIX_DEFAULT));
  const ta = APP.teamAssign || {};
  const leist = leistungAlle();
  // Einmal für den ganzen Lauf — siehe merkmale().
  const bilanz = einsatzBilanzAlle();
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
    const kand = pool[t].map(n => {
      const m = merkmale(n, leist, eventDate, bilanz);
      m.rot = rotVon(m);
      m.wert = wertVon(m);
      return m;
    });

    // Die festen Plätze: die stärksten `fixN` dieser Uhrzeit. **Wer sich
    // abgemeldet hat, zählt nicht mit** — sonst verbrauchte ein Abwesender
    // einen Fixplatz und der Nächststärkste bekäme keinen.
    kand.slice().filter(m => !m.abgemeldet)
      .sort((a, b) => b.kraft - a.kraft)
      .slice(0, fixN)
      .forEach(m => { m.fest = true; });

    // 1. Wer sich vorher abgemeldet hat, wird nicht eingeplant — vor jeder
    //    anderen Regel und auch vor dem Fixplatz. Er wird dadurch nicht
    //    bestraft: beim Einfrieren bekommt seine Zeile `excused=true`, es folgt
    //    also keine ⛔-Marke fürs nächste Mal (core/abmeldung.js).
    // 2. Wer gefehlt hat, setzt aus — es sei denn, er hat einen festen Platz.
    const drin = [];
    kand.forEach(m => {
      if (m.abgemeldet) raus.push({ ...m, team: t, grund: 'hat sich vorher abgemeldet — entschuldigt' });
      else if (m.aussetzen && !m.fest) raus.push({ ...m, team: t, grund: 'hat beim letzten Mal gefehlt' });
      else drin.push(m);
    });

    // 3. Überhang: der am wenigsten geschützte zuerst — aber nie einer mit
    //    festem Platz. Die Rückfallzeile ist kein toter Code: ohne sie liefe
    //    die Schleife endlos, sobald jemand `fixN` über die Zahl der Plätze
    //    hinaus stellte.
    while (drin.length > ZUT_PLAETZE) {
      const frei = drin.filter(m => !m.fest);
      const feld = frei.length ? frei : drin;
      let schwach = feld[0];
      feld.forEach(m => { if (kleiner(schutz(m), schutz(schwach)) < 0) schwach = m; });
      drin.splice(drin.indexOf(schwach), 1);
      raus.push({ ...schwach, team: t, grund: grundText(schwach) });
    }

    // 4. Gesetzt oder Ersatz — **auch das rotiert** (Vorgabe Ben, 30.09.2026).
    //    Vorher entschied hier allein die Kraft: die stärksten 20 in die
    //    Aufstellung, der Rest auf die Bank. Über vier WS-Tage gemessen hieß das,
    //    dass die Bank überhaupt nicht rotiert — von 89 Spielern mit Historie
    //    waren **42 noch nie** auf der Bank und **20 ausschließlich** dort. Wer
    //    einmal unter den Stärksten war, hatte jede Woche ein Gebäude; wer nicht,
    //    nie eines.
    //
    //    Gezählt wird aus der **Historie**, nicht aus einem eigenen Zähler:
    //    `einsatzBilanzAlle()` leitet je Spieler ab, wie oft er gesetzt und wie
    //    oft er Ersatz war (`ws_participation.substitute`). Eine abgeleitete Zahl
    //    kann nicht auseinanderlaufen und gilt rückwirkend für jedes Event, das
    //    schon in der Datenbank steht — dieselbe Begründung wie bei der
    //    Einsatz-Bilanz selbst.
    //
    //    Drei Gruppen, in dieser Reihenfolge:
    //    - **Ersatz-Wunsch** geht vor alles. Eine Aussage des Spielers, keine
    //      Schätzung über ihn, und sie schlägt auch den festen Platz.
    //    - **Fest gesetzt heißt fest in der Aufstellung** — die Festen rotieren
    //      ausdrücklich *nicht* auf die Bank (Entscheidung Ben, 30.09.2026). Sonst
    //      stünden je Woche drei bis vier der zehn Stärksten ohne Gebäude da und
    //      das Silo ginge an einen Schwächeren. Vorher fiel das nebenbei so aus,
    //      weil nach Kraft sortiert wurde; jetzt steht es als Regel da, denn die
    //      Rotation würde sie sonst mitnehmen.
    //    - **Die übrigen rotieren** über `bankVon()`: wer am seltensten auf der
    //      Bank war, sitzt als nächster dort.
    const wunsch = drin.filter(m => m.wunschErsatz).slice(0, ZUT_MAX_ERSATZ);
    const wunschNamen = new Set(wunsch.map(m => m.name));
    const uebrig = drin.filter(m => !wunschNamen.has(m.name));
    const festDrin = uebrig.filter(m => m.fest);
    // Nach Bank-Rotation sortiert: vorn, wen es als nächsten trifft.
    const frei = uebrig.filter(m => !m.fest)
      .sort((a, b) => kleiner(bankVon(a), bankVon(b)));

    // Wie viele Bankplätze nach den Wünschen noch zu besetzen sind — und nie
    // mehr, als es freie Spieler gibt: sind fast alle fest, bleibt die Bank
    // eben leer, statt einen Festen hineinzuziehen.
    const bankOffen = Math.max(0, Math.min(ZUT_MAX_ERSATZ - wunsch.length,
      frei.length - Math.max(0, ZUT_MAX_GESETZT - festDrin.length)));
    const aufBank = frei.slice(0, bankOffen);
    const inReihe = frei.slice(bankOffen);

    const gesetzt = [...festDrin, ...inReihe].slice(0, ZUT_MAX_GESETZT);
    const gesetztNamen = new Set(gesetzt.map(m => m.name));
    const ersatz = [...wunsch, ...aufBank,
      ...[...festDrin, ...inReihe].filter(m => !gesetztNamen.has(m.name))];

    // 5. **Hier stand der Stern-Tausch, und er ist mit der Bank-Rotation
    //    weggefallen** (30.09.2026). Er zog einen Stern mit Index ≥ 1,5 von der
    //    Bank in die 20, getauscht gegen den Schwächsten. Das war die richtige
    //    Regel, solange die Bank nach Kraft besetzt wurde — jetzt wäre sie ein
    //    Loch in der Rotation: ein Stern käme nie mehr auf die Bank, und sein
    //    Platz ginge jede Woche an denselben Ersatzmann zurück. Der Stern
    //    bekommt seinen Vorzug stattdessen **in** der Rotation, als halben
    //    Schritt (`ZUT_STERN_ROT` in `bankVon`) — dieselbe Zahl und dieselbe
    //    Begründung wie beim Zuschauen.

    // 6. Wer an der Schnittkante steht. Die Rangfolge oben trifft eine
    //    Entscheidung, aber zwischen dem Letzten drin und dem Ersten draußen
    //    liegen oft Hundertstel — und *dort* ist ein Tausch von Hand billig.
    //    Ohne diese Markierung müsste man die ganze Liste nachrechnen, um zu
    //    sehen, wen man gegen wen tauschen kann; genau danach hat Ben am
    //    16.09.2026 gefragt, als Carmen0804 spielen sollte.
    //
    //    **Die ⛔-Marke ist keine Wackelkandidatin.** Wer gefehlt hat, setzt
    //    nach einer Regel aus, die die Allianz sich gegeben hat — die steht
    //    nicht zur Abwägung, sonst wäre sie keine Regel.
    //
    //    Die Kante wird **einmal** gerechnet und dann sowohl markiert als auch
    //    ausgegeben. Zweimal formuliert stand sie hier schon, und die Gegenprobe
    //    zum Test lief prompt ins Leere: die eine Fassung war kaputt, die andere
    //    nicht, und der Test sah nur die heile.
    //    **Ein fester Platz steht dort ebenso wenig.** Er ist eine Einstellung,
    //    die für die ganze Woche gilt — wer ihn drehen will, dreht den Regler,
    //    nicht einen einzelnen Namen.
    const nachSchutz = (a, b) => kleiner(schutz(a), schutz(b));
    const grenze = {
      drin: [...gesetzt, ...ersatz].filter(m => !m.fest).sort(nachSchutz).slice(0, ZUT_GRENZE_N),
      draussen: raus.filter(m => m.team === t && !m.aussetzen && !m.abgemeldet)
        .sort((a, b) => nachSchutz(b, a)).slice(0, ZUT_GRENZE_N),
    };
    grenze.drin.forEach(m => { m.wackelt = 'drin'; });
    grenze.draussen.forEach(m => { m.wackelt = 'draussen'; });

    gesetzt.sort((a, b) => b.kraft - a.kraft);
    ersatz.sort((a, b) => b.kraft - a.kraft);
    gesetzt.forEach(m => { soll[m.name] = t; });
    ersatz.forEach(m => { soll[m.name] = t + 'E'; });
    teams[t] = { gesetzt, ersatz, grenze, fixN };
  });
  raus.forEach(m => { soll[m.name] = m.team + 'C'; });

  return { soll, teams, raus, regeln: AUSSCHLUSS_REGELN, fixN };
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
  // **Die Bremse muss vor der Schleife feststehen.** Sie stand als
  // `offen.length * 4 + 8` in der Abbruchbedingung — und `offen` schrumpft mit
  // jedem Zug. Bei 39 Zügen war die Grenze nach 33 Schritten auf 32 gefallen
  // und die Schleife brach ab, während noch drei Züge offen waren: Team B blieb
  // bei 19/20 stehen. Aufgefallen ist es nur, weil die Ansicht die übrigen Züge
  // ausdrücklich meldet, statt sie zu verschlucken.
  const maxSchritte = offen.length * 4 + 8;
  ['A', 'B'].forEach(blatt => {
    for (let schutzZaehler = 0; schutzZaehler <= maxSchritte; schutzZaehler++) {
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
      // **Ringtausch: wenn nichts mehr geht, einen abmelden.** Stehen nur noch
      // Züge offen, deren Ziel voll ist — `A → AE` *und* `AE → A` bei 20/20 und
      // 10/10 —, blockieren sie sich gegenseitig, und kein Anfang ist möglich.
      // Im Spiel löst man das, indem man einen Spieler abmeldet: sein Platz wird
      // frei, die Kette läuft, und am Ende wird er wieder gesetzt. Genau das
      // fehlte, und die Folge brach mit drei offenen Zügen ab.
      if (!moeglich.length) {
        const eng = offen.find(m => blattVon(m.alt) === blatt && ZUT_CAP[m.alt] !== undefined);
        if (!eng) break;
        offen = offen.filter(o => o !== eng);
        stand[eng.alt]--;
        plan.push({ blatt, name: eng.name, alt: eng.alt, neu: '—', ziel: eng.neu, stand: { ...stand } });
        offen.push({ name: eng.name, alt: '—', neu: eng.neu });
        continue;
      }
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
