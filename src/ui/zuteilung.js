import { APP } from '../core/state.js';
import { canAccess, fmt } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { sbPatch } from '../core/api.js';
import { renderPage } from '../app/render.js';
import { zuteilungVorschlag, zuteilungSchritte, ZUT_CAP, ZUT_MAX_GESETZT, ZUT_MAX_ERSATZ, ZUT_GRENZE_N } from '../core/zuteilung.js';
import { abmeldungUmschalten } from '../core/abmeldung.js';
import { REG_WERTE, istOhnePlatzWert } from '../core/rotation.js';
import { changeWsFixedCount, getNextFriday, wsFixedCount, wsIstFixiert, wsZeit } from './ws.js';
import { saveWSState } from './buildings.js';

// ══════════════════════════════════════════════════════════════════
//  REITER „VERTEILUNG" — der Vorschlag und die Schritte im Spiel
// ══════════════════════════════════════════════════════════════════
// Er steht zwischen Anmeldung und Aufstellung, weil er genau dazwischen
// gehört: die Anmeldung sagt, wer will; die Aufstellung, wer wo steht; hier
// wird entschieden, **wer diesmal zuschaut**.
//
// **Der Vorschlag lebt nur im Modul, nicht im Planungsstand.** Er ist eine
// Rechnung auf Knopfdruck, keine gemeinsame Auskunft der Allianz — läge er in
// `ws_planner_state`, stünde eine alte Berechnung wochenlang neben der echten
// Einteilung und sähe aus wie sie. Ein Neuladen wirft ihn weg, und das ist
// richtig so: die Grundlage (Anmeldung, Prio, Sterne) ändert sich stündlich.
//
// **Von selbst geschrieben wird nichts** — nur auf den Knopf „In die Anmeldung
// übernehmen" (`zuteilungUebernehmen`, verlangt von Ben am 24.09.2026). Hier
// stand vorher, dass es diesen Knopf ausdrücklich *nicht* geben soll, und der
// Grund dafür gilt weiter: eingeteilt wird im Spiel, und nach dem Übernehmen
// trägt die Anmeldung die Wunsch-Einteilung, während im Spiel noch die alte
// steht. Genau deshalb hängt der Knopf an drei Bedingungen, die ihn von einem
// stillen „übernehmen" unterscheiden:
//
// - **Die Schrittliste bleibt stehen.** Sie wird gegen `_spielstand` gerechnet,
//   den Schnappschuss von vor dem Übernehmen — sonst hieße es sofort „Nichts zu
//   tun", obwohl im Spiel nichts geschehen ist. Das wäre die Verwechslung.
// - **Die Uhrzeiten der Ausgeschlossenen bleiben stehen** (`'ABC'`), siehe
//   `uebernahmePlan`.
// - **Die Rückfrage sagt, was der Knopf *nicht* tut** — er fasst das Spiel nicht
//   an.
//
// **Der fertige Vorschlag hängt auch an `APP.zutVorschlag`.** Nicht als
// Bequemlichkeit, sondern als Übergabepunkt: `scripts/ws_service/einstellen.py`
// stellt die Verteilung im Spiel ein und holt sie sich dafür headless aus genau
// dieser App (`scripts/zuteilung_plan.mjs`). Die Rechnung in Python nachzubauen
// wäre eine zweite Fassung derselben Entscheidung — sie liefe früher oder
// später anders als der Reiter, und dann stellte der Dienst etwas anderes ein,
// als hier steht.
let _vorschlag = null;

// Was das Werkzeug vom **Spiel** weiß. Normalerweise ist das die Anmeldung
// selbst — dort steht, was der letzte Scan gelesen hat, und `null` heißt genau
// das. Erst das Übernehmen trennt beides: die Anmeldung trägt danach den
// Vorschlag, im Spiel steht weiter der alte Stand, und nur dieser Schnappschuss
// weiß noch, welcher. Die Schrittliste hängt daran.
let _spielstand = null;

function rechnen() {
  const v = zuteilungVorschlag({ eventDate: getNextFriday(), fixCount: wsFixedCount() });
  // Die Schrittfolge gehört zum Vorschlag, nicht zur Anzeige: sie hängt am
  // `teamAssign` **im Moment der Berechnung**. Beim Rendern gerechnet änderte
  // sie sich still, sobald nebenbei ein Scan schreibt.
  v.schritte = zuteilungSchritte(_spielstand || APP.teamAssign || {}, v.soll);
  v.eventDate = getNextFriday();
  APP.zutVorschlag = v;
  return v;
}

export function zuteilungBerechnen() {
  _vorschlag = rechnen();
  renderPage();
}

// Das ✕ wirft den Vorschlag weg — **und den Schnappschuss mit**. Danach gilt
// wieder, was die Anmeldung sagt. Beides getrennt zurückzunehmen gäbe einen
// Zustand, den niemand erklären kann: eine Schrittliste gegen einen Spielstand,
// zu dem es keinen Vorschlag mehr gibt.
export function zuteilungVerwerfen() {
  _vorschlag = null;
  _spielstand = null;
  APP.zutVorschlag = null;
  renderPage();
}

// ── Übernehmen: der Vorschlag wird zur Anmeldung ────────────────────────────
// Was tatsächlich geschrieben würde — einmal formuliert, damit der Knopf
// dieselbe Zahl nennt, die hinterher geschrieben wird. Zwei Fassungen liefen
// hier früher oder später auseinander, wie schon bei der Schnittkante.
//
// **Wer ohne Platz bleibt, behält seine gemeldeten Uhrzeiten.** `soll` kennt nur
// `AC`/`BC` — die Rechnung steckt jeden in genau eine Zeitliste. Wer sich für
// beide gemeldet hat (`'ABC'`), verlöre beim Übernehmen die Hälfte seiner
// Auskunft, und ausgerechnet die ist beim Nachrücken die nützlichste
// (siehe core/rotation.js). Ein C-Wert wird deshalb nie von einem C-Wert
// überschrieben — wohl aber ein `A` von einem `AC`: das ist der Ausschluss.
function uebernahmePlan() {
  if (!_vorschlag) return [];
  const ist = APP.teamAssign || {};
  return Object.entries(_vorschlag.soll)
    .map(([n, w]) => [n, istOhnePlatzWert(w) && istOhnePlatzWert(ist[n]) ? ist[n] : w])
    .filter(([n, w]) => REG_WERTE.includes(w) && ist[n] !== w);
}

export function zuteilungUebernehmen() {
  if (!canAccess('ws') || !_vorschlag) return;
  const ist = APP.teamAssign || {};
  const aend = uebernahmePlan();
  if (!aend.length) { alert('Die Anmeldung steht schon so — es gibt nichts zu übernehmen.'); return; }

  const neu = { ...ist };
  aend.forEach(([n, w]) => { neu[n] = w; });

  // Gegenprobe **vor** dem Schreiben: kein Topf über seiner Grenze. Der
  // Vorschlag hält sie von sich aus ein, er zählt aber nur aktive Spieler —
  // eine stehengebliebene Zeile eines stillgelegten zählt in der Anmeldung
  // mit. Dann stünden 21 auf 20 Plätzen, ohne dass ein Knopf das je zugelassen
  // hätte. Lieber gar nicht schreiben und sagen, woran es liegt.
  const voll = Object.entries(ZUT_CAP)
    .map(([w, max]) => [w, Object.values(neu).filter(x => x === w).length, max])
    .find(([, n, max]) => n > max);
  if (voll) {
    alert(`Nicht übernommen: ${voll[0]} käme auf ${voll[1]} von ${voll[2]} Plätzen. `
      + 'Vermutlich steht dort noch ein stillgelegter Spieler in der Anmeldung.');
    return;
  }

  const ohnePlatz = aend.filter(([, w]) => istOhnePlatzWert(w)).length;
  if (!confirm('Vorschlag in die Anmeldung übernehmen?\n\n'
    + `· ${aend.length} Spieler bekommen einen anderen Wert, ${ohnePlatz} davon ohne Platz\n`
    + '· Im Spiel ändert das nichts — eingeteilt wird weiterhin dort\n\n'
    + 'Die Liste „In Last War einstellen" bleibt stehen und sagt, was dort noch zu tun ist. '
    + 'Bis das geschehen ist, zeigt die Anmeldung eine Einteilung, die es im Spiel nicht gibt.')) return;

  _spielstand = { ...ist };
  APP.teamAssign = neu;
  saveWSState();
  _vorschlag = rechnen();
  renderPage();
}

// Die Zahl der festen Plätze gehört der Allianz (`alliances.ws_fixed_count`) und
// wird deshalb von `changeWsFixedCount` geschrieben — derselben Funktion, die
// auch der Stepper in der Aufstellung benutzt. Zwei Bedienstellen, eine Fassung
// der Logik: eine zweite liefe früher oder später anders, wie schon bei der
// Gebäude-Reihenfolge, die an drei Stellen stand.
//
// **Danach muss neu gerechnet werden.** `changeWsFixedCount` rendert zwar, aber
// `_vorschlag` ist eine erstarrte Rechnung — ohne diesen Aufruf bliebe die alte
// Liste stehen und der Regler sähe wirkungslos aus.
export async function zutFixChange(d) {
  await changeWsFixedCount(d);
  if (_vorschlag) _vorschlag = rechnen();
  renderPage();
}

// Die Vorab-Abmeldung: „ich kann diesen Freitag nicht". Sie ist die Gegenseite
// dazu, dass ein fester Platz die ⛔-Marke schlägt — ohne sie hieße „fest
// gesetzt" auch „darf folgenlos fehlen".
export async function zutAbmeldung(name) {
  await abmeldungUmschalten('ws', getNextFriday(), name);
  if (_vorschlag) _vorschlag = rechnen();
  renderPage();
}

// Der Ersatz-Wunsch ist eine Aussage des Spielers („mir ist es nicht so wichtig
// zu spielen") und gehört deshalb an den Spieler, nicht in die Rechnung.
// Umgeschaltet wird wie der Stern: erst die Anzeige, dann die Datenbank, und
// bei einem Fehler zurück — sonst hinge der Klick am Netz.
export async function zutWunschUmschalten(name) {
  if (!canAccess('ws')) return;
  const p = (APP.data.players || []).find(x => x.name === name);
  if (!p) return;
  const neu = !p.ersatz_wunsch;
  p.ersatz_wunsch = neu;
  if (_vorschlag) _vorschlag = rechnen();
  renderPage();
  try {
    await sbPatch('ws_players', 'name=eq.' + encodeURIComponent(name), { ersatz_wunsch: neu });
  } catch (e) {
    p.ersatz_wunsch = !neu;
    if (_vorschlag) _vorschlag = rechnen();
    renderPage();
    alert('Der Ersatz-Wunsch konnte nicht gespeichert werden: ' + ((e && e.message) || e));
  }
}

// Der Index hat immer zwei Nachkommastellen — 2,0 und 2 nebeneinander in einer
// Spalte liest sich sonst wie zwei verschiedene Größen. Trennzeichen über LOC().
const idx = v => v.toLocaleString(LOC(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ⇅ heißt „steht an der Schnittkante". Zwischen dem Letzten drinnen und dem
// Ersten draußen liegen oft Hundertstel — dort kostet ein Tausch von Hand fast
// nichts, und nur dort lohnt es, ihn überhaupt zu erwägen.
const WACKEL = '<span title="steht an der Schnittkante — hier ist ein Tausch billig" '
  + 'style="color:#0a8f6c;font-weight:800">⇅</span>';

function marken(m) {
  const teile = [];
  if (m.wackelt) teile.push(WACKEL);
  // Der feste Platz steht am Namen, nicht nur in der Kopfzeile: sonst wäre aus
  // der Liste nicht zu sehen, wo die Grenze verläuft, die der Regler zieht.
  if (m.fest) teile.push('<span title="fester Platz — einer der Stärksten dieser Zeit" '
    + 'style="color:#0a8f6c;font-weight:800">🔒</span>');
  // Eine ⛔-Marke, die ein Fixplatz übergeht, verschwindet nicht — sie wird nur
  // nicht vollstreckt. Verschwiege sie die Liste, sähe der Übergangene aus wie
  // jemand, der gar nicht gefehlt hat.
  if (m.fest && m.aussetzen) teile.push('<span title="hat gefehlt — der feste Platz geht vor" '
    + 'style="color:#c0392b">⛔</span>');
  if (m.stern) teile.push('<span title="bringt viel" style="color:#d4a017">★</span>');
  if (m.wunschErsatz) teile.push('<span title="möchte auf die Ersatzbank">🪑</span>');
  if (m.prio > 0) teile.push(`<span style="color:#7c4dff;font-weight:700" title="Prio-Marke">⭐${m.prio}</span>`);
  if (m.index != null) teile.push(`<span style="color:var(--tx3)">📈 ${idx(m.index)}</span>`);
  return teile.join(' ');
}

// Die beiden Schalter je Zeile: 🪑 „möchte auf die Bank" und 🚫 „hat sich für
// diesen Freitag abgemeldet". Beide sind Aussagen über einen Menschen und
// stehen deshalb dort, wo über ihn entschieden wird — nicht in einem
// Einstellungsdialog nebenan.
function schalter(m, darfSetzen) {
  if (!darfSetzen) return '';
  const safe = m.name.replace(/'/g, "\\'");
  const knopf = (fn, zeichen, titel, an) => `<button class="btn btn-out btn-sm"
    style="font-size:10px;padding:2px 6px;flex-shrink:0${an ? ';background:#c0392b18;border-color:#c0392b;color:#c0392b' : ''}"
    onclick="${fn}('${safe}')" title="${titel}">${zeichen}</button>`;
  return knopf('zutWunschUmschalten', '🪑', 'Ersatz-Wunsch umschalten', m.wunschErsatz)
    + knopf('zutAbmeldung', '🚫', 'Hat sich für diesen Freitag abgemeldet — wird nicht eingeplant und gilt als entschuldigt', m.abgemeldet);
}

function zeile(m, i, darfSetzen) {
  return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--bd)">
    <span style="width:22px;color:var(--tx3);font-size:11px;flex-shrink:0">${i}.</span>
    <span style="flex:1 1 120px;min-width:0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
    <span style="font-size:11px;flex-shrink:0">${marken(m)}</span>
    <span style="font-size:11px;color:var(--tx2);width:58px;text-align:right;flex-shrink:0">${fmt(Math.round(m.kraft))} Mio</span>
    ${schalter(m, darfSetzen)}
  </div>`;
}

function teamKarte(t, gruppe, darfSetzen) {
  const farbe = t === 'A' ? '#2f6fed' : '#e07b39';
  return `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span style="color:${farbe}">Team ${t} · ${wsZeit(t)}</span>
      <span class="ch-sub">${gruppe.gesetzt.length}/${ZUT_MAX_GESETZT} gesetzt · ${gruppe.ersatz.length}/${ZUT_MAX_ERSATZ} Ersatz · 🔒 ${gruppe.gesetzt.filter(m => m.fest).length} fest</span></div>
    <div style="padding:6px 14px 10px">
      <div style="font-size:11px;font-weight:800;color:${farbe};margin:4px 0 2px">GESETZT (bekommt ein Gebäude)</div>
      ${gruppe.gesetzt.map((m, i) => zeile(m, i + 1, darfSetzen)).join('')}
      <div style="font-size:11px;font-weight:800;color:var(--tx2);margin:10px 0 2px">ERSATZ (spielt mit, ohne Gebäude)</div>
      ${gruppe.ersatz.map((m, i) => zeile(m, i + 1, darfSetzen)).join('')}
    </div></div>`;
}

// Die Schnittkante als Gegenüberstellung: links die Schwächsten, die drin
// sind, rechts die Stärksten, die draußen stehen. Ein Tausch ist genau ein
// Name von links gegen einen von rechts — mit den Werten daneben sieht man
// sofort, was er kostet.
function grenzKarte(teams) {
  const spalte = (titel, liste, farbe) => `<div style="flex:1 1 150px;min-width:0">
    <div style="font-size:11px;font-weight:800;color:${farbe};margin-bottom:3px">${titel}</div>
    ${liste.length ? liste.map(m => `<div style="display:flex;gap:4px;align-items:baseline;font-size:12px;padding:2px 0">
      <span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
      <span style="color:var(--tx3);font-size:11px;flex-shrink:0"
        title="Leistungsindex plus Prio-Marke plus frühere C-Runden — daran hängt die Entscheidung">${idx(m.wert)}</span>
    </div>`).join('') : '<div style="font-size:11px;color:var(--tx3)">—</div>'}
  </div>`;
  const block = t => {
    const g = teams[t] && teams[t].grenze;
    if (!g || (!g.drin.length && !g.draussen.length)) return '';
    return `<div style="margin:8px 0 2px">
      <div style="font-size:11px;font-weight:800;color:${t === 'A' ? '#2f6fed' : '#e07b39'};margin-bottom:2px">Team ${t}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${spalte('⇅ Schwächste, die spielen', g.drin, 'var(--tx2)')}
        ${spalte('⇅ Stärkste, die zuschauen', g.draussen, 'var(--tx2)')}
      </div></div>`;
  };
  return `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>⇅ An der Schnittkante</span><span class="ch-sub">je ${ZUT_GRENZE_N} Namen</span></div>
    <div style="padding:6px 14px 12px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">
        Hier ist ein Tausch von Hand billig: ein Name links gegen einen rechts. Die Zahl ist der Wert, an dem die Entscheidung hing — Leistungsindex plus Prio-Marke plus frühere C-Runden. Wer eine ⛔-Marke trägt, steht bewusst nicht dabei: das ist eine Regel, keine Abwägung.
      </div>
      ${block('A')}${block('B')}
    </div></div>`;
}

function schrittListe(plan) {
  let blatt = null;
  const zeilen = plan.map((s, i) => {
    const kopf = s.blatt !== blatt
      ? (blatt = s.blatt, `<div style="font-size:12px;font-weight:800;margin:12px 0 4px;padding:4px 8px;
          background:${s.blatt === 'A' ? '#2f6fed' : '#e07b39'}18;border-radius:6px">
          Blatt ${s.blatt} · ${wsZeit(s.blatt)}</div>`)
      : '';
    const feld = w => w === 'A' || w === 'B' ? 'gesetzt' : w === 'AE' || w === 'BE' ? 'Ersatz' : '—';
    // Drei Fälle, die im Spiel verschieden aussehen: abmelden und weg (setzt
    // aus), abmelden und auf dem anderen Blatt wieder setzen (Teamwechsel),
    // und der gewöhnliche Wechsel des Feldes.
    const was = s.neu === 'AC' || s.neu === 'BC'
      ? `aus ${feld(s.alt)} <b>abmelden</b> <span style="color:var(--tx3)">— setzt aus</span>`
      : s.neu === '—'
        // Abmelden hat zwei Gründe: Teamwechsel (kommt auf dem anderen Blatt
        // wieder) oder Ringtausch (macht hier einen Platz frei und wird weiter
        // unten wieder gesetzt). Beides sieht im Spiel gleich aus, heißt aber
        // Verschiedenes — wer das verwechselt, sucht ihn auf dem falschen Blatt.
        ? (s.ziel[0] === s.blatt
            ? `aus ${feld(s.alt)} abmelden <span style="color:var(--tx3)">— macht Platz, kommt unten wieder</span>`
            : `aus ${feld(s.alt)} abmelden <span style="color:var(--tx3)">(kommt auf Blatt ${s.ziel[0]} wieder)</span>`)
        : s.alt === '—' || s.alt === 'AC' || s.alt === 'BC'
          ? `neu in <b>${feld(s.neu)}</b>`
          : `${feld(s.alt)} → <b>${feld(s.neu)}</b>`;
    return `${kopf}<div style="display:flex;gap:6px;align-items:baseline;font-size:12px;padding:2px 0;border-bottom:1px solid var(--bd)">
      <span style="width:24px;color:var(--tx3);flex-shrink:0">${i + 1}.</span>
      <span style="flex:1 1 110px;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis">${s.name}</span>
      <span style="flex:1 1 130px;color:var(--tx2)">${was}</span>
      <span style="font-size:10px;color:var(--tx3);flex-shrink:0">A ${s.stand.A}/20 · AE ${s.stand.AE}/10 · B ${s.stand.B}/20 · BE ${s.stand.BE}/10</span>
    </div>`;
  });
  return zeilen.join('');
}

// Der Regler für die festen Plätze. Er steht **im Kopf** des Reiters und nicht
// weiter unten: er entscheidet, wie viel von der Liste darunter überhaupt noch
// zur Debatte steht — bei 15 von 20 sind es fünf Plätze plus die Ersatzbank.
// Derselbe Wert ist weiterhin unter „Aufstellung → ⚙ Erweitert" zu erreichen;
// dort wirkt er auf die Rotation, hier auf den Vorschlag.
function fixKarte(darfSetzen) {
  const n = wsFixedCount();
  const btn = (d, z) => `<button class="slot-btn" ${darfSetzen ? `onclick="zutFixChange(${d})"` : 'disabled style="opacity:.35"'}>${z}</button>`;
  return `<div class="slot-row" style="margin-top:10px">
      <div class="slot-label" style="font-weight:600;font-size:12px">🔒 Feste Plätze
        <span style="color:var(--tx3);font-weight:400">von ${ZUT_MAX_GESETZT} je Team · die Stärksten</span></div>
      <div class="slot-btns">${btn(-1, '−')}<div class="slot-num">${n}</div>${btn(1, '+')}</div>
    </div>
    <div style="font-size:11px;color:var(--tx3);margin-top:4px;line-height:1.5">
      Die ${n} stärksten Angemeldeten je Uhrzeit bekommen einen festen Platz: sie schauen nie zu — auch nicht nach einem Fehlen. Wer nicht kann, meldet sich mit 🚫 vorher ab; dann wird er nicht eingeplant und gilt als entschuldigt.
    </div>`;
}

// Der Knopf, der den Vorschlag zur Anmeldung macht. Er steht **direkt unter dem
// Kopf**, nicht hinter den Listen. Dort stand er einen Tag lang, und Ben hat ihn
// nicht gefunden: die Karten davor sind über hundert Zeilen lang, und ein
// Bedienelement, das man suchen muss, existiert für den Nutzer nicht — dieselbe
// Lehre wie beim zu blassen Stern am 15.09.2026.
//
// Nach dem Übernehmen steht an derselben Stelle, was jetzt gilt — und vor allem,
// was **nicht** gilt: im Spiel ist nichts geschehen. Ohne diesen Satz wäre der
// Knopf genau die Verwechslung, gegen die der Reiter gebaut ist.
function uebernahmeKarte(darfSetzen) {
  if (!darfSetzen) return '';
  const aend = uebernahmePlan();
  const fixiert = wsIstFixiert(getNextFriday(), 'A') || wsIstFixiert(getNextFriday(), 'B');
  const hinweisFix = fixiert
    ? `<div style="font-size:11px;color:#c0392b;margin-top:6px;line-height:1.5">
        Der Kader für den ${getNextFriday()} ist bereits festgeschrieben — an ihm ändert die Anmeldung nichts mehr.
      </div>` : '';
  if (_spielstand) {
    return `<div class="card" style="margin-bottom:12px">
      <div class="ch"><span>✍ Übernommen</span><span class="ch-sub">${aend.length} offen</span></div>
      <div style="padding:8px 14px 12px;font-size:12px;color:var(--tx2);line-height:1.5">
        Die Anmeldung steht jetzt auf dem Vorschlag — im Spiel steht er noch nicht. Die Schritte unten rechnen weiter gegen den Stand von vor dem Übernehmen und sagen, was dort zu tun ist.
        <div style="font-size:11px;color:var(--tx3);margin-top:6px">
          Ein Neuladen wirft diese Liste weg: die Anmeldung trägt dann den Vorschlag, und das Werkzeug kann nicht mehr sagen, was im Spiel noch fehlt. Bis dahin also offen lassen.
        </div>${hinweisFix}
      </div></div>`;
  }
  return `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>✍ In die Anmeldung übernehmen</span><span class="ch-sub">${aend.length} Änderungen</span></div>
    <div style="padding:8px 14px 12px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">
        Der Vorschlag wird als Team-Einteilung gespeichert und steht damit im Reiter „Anmeldung" — auf jedem Gerät. Im Spiel ändert das nichts; dafür bleibt die Liste darunter die Anleitung. Wer ohne Platz bleibt, behält seine gemeldeten Uhrzeiten.
      </div>${hinweisFix}
      <button class="btn btn-sol" style="width:100%;margin-top:10px${aend.length ? '' : ';opacity:.35'}"
        ${aend.length ? 'onclick="zuteilungUebernehmen()"' : 'disabled'}>✍ Vorschlag in die Anmeldung übernehmen</button>
    </div></div>`;
}

export function zuteilungView() {
  const darfSetzen = canAccess('ws');
  const kopf = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>🧮 Verteilung</span><span class="ch-sub">Vorschlag für ${getNextFriday()}</span></div>
    <div style="padding:10px 14px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">
        Wer diesmal zuschaut — gerechnet aus Anmeldung, Aussetzen-Marken, Sternen, Prioliste und Leistungsindex. Von selbst geschrieben wird nichts: eingeteilt wird im Spiel, die Liste unten sagt Schritt für Schritt, was dort zu tun ist. Der Knopf darunter übernimmt den Vorschlag ins Werkzeug — nicht ins Spiel.
      </div>
      <div style="font-size:11px;color:var(--tx3);line-height:1.5;margin-top:6px">
        Grundlage ist der Anmeldestand, den das Werkzeug kennt — also der letzte Scan.
        Wer sich seitdem abgemeldet hat, steht hier noch mit drin und nimmt einen Platz weg.
      </div>
      ${fixKarte(darfSetzen)}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-sol" style="flex:1" onclick="zuteilungBerechnen()">🧮 Verteilung berechnen</button>
        ${_vorschlag ? `<button class="btn btn-out" onclick="zuteilungVerwerfen()">✕</button>` : ''}
      </div>
    </div></div>`;

  if (!_vorschlag) {
    return kopf + `<div class="card"><div style="padding:14px;font-size:12px;color:var(--tx3);line-height:1.6">
      Noch nichts berechnet. Der Vorschlag entsteht auf Knopfdruck und lebt nur in diesem Tab —
      ein Neuladen wirft ihn weg. Das ist Absicht: Anmeldung, Prio und Sterne ändern sich
      stündlich, eine gespeicherte alte Rechnung sähe später aus wie die echte Einteilung.
    </div></div>`;
  }

  const { teams, raus, regeln } = _vorschlag;
  const { plan, offen } = _vorschlag.schritte;

  const regelKarte = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>Nach welchen Regeln</span><span class="ch-sub">in dieser Reihenfolge</span></div>
    <div style="padding:8px 14px 12px;font-size:12px;color:var(--tx2);line-height:1.6">
      ${regeln.map((r, i) => `<div><span style="color:var(--tx3)">${i + 1}.</span> ${r}</div>`).join('')}
      <div style="margin-top:8px;color:var(--tx3)">
        Ersatz ist kein Ausschluss — im Wüstensturm spielen alle 30 gleichzeitig, der Ersatz bekommt nur kein Gebäude. Wer wirklich zuschaut, steht unten.
      </div>
    </div></div>`;

  const rausKarte = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>⛔ Setzt diesmal aus</span><span class="ch-sub">${raus.length} Spieler</span></div>
    <div style="padding:6px 14px 10px">
      ${raus.length ? raus.slice().sort((a, b) => b.kraft - a.kraft).map(m => `
        <div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid var(--bd);font-size:12px">
          <span style="flex:1 1 110px;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
          <span style="flex-shrink:0;font-size:11px">${m.abgemeldet ? '🚫' : m.wackelt ? WACKEL : ''}</span>
          <span style="flex-shrink:0;color:var(--tx3);font-size:11px">${m.team}C</span>
          <span style="flex:1 1 140px;color:var(--tx2);font-size:11px">${m.grund}</span>
          ${schalter(m, darfSetzen)}
        </div>`).join('')
      : '<div style="font-size:12px;color:var(--tx3);padding:6px 0">Niemand — es passen alle auf die Plätze.</div>'}
    </div></div>`;

  const schritte = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>📋 In Last War einstellen</span><span class="ch-sub">${plan.length} Schritte, in dieser Reihenfolge</span></div>
    <div style="padding:8px 14px 12px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5;margin-bottom:4px">
        Alle vier Töpfe sind voll — solange das so ist, nimmt das Spiel keinen Wechsel an. Die Reihenfolge räumt deshalb zuerst frei; hinter jedem Schritt stehen die Zähler, wie sie danach im Spiel stehen müssen.
      </div>
      ${_spielstand ? `<div style="font-size:11px;color:var(--tx3);line-height:1.5;margin-bottom:4px">
        Gerechnet gegen den Stand von vor dem Übernehmen — die Anmeldung im Werkzeug trägt den Vorschlag bereits, das Spiel noch nicht.
      </div>` : ''}
      ${plan.length ? schrittListe(plan)
      : '<div style="font-size:12px;color:var(--tx3);padding:6px 0">Nichts zu tun — das Spiel steht schon so.</div>'}
      ${offen.length ? `<div style="margin-top:8px;font-size:12px;color:#c0392b">
        ${offen.length} Züge lassen sich nicht einsortieren — bitte melden.</div>` : ''}
    </div></div>`;

  return kopf + uebernahmeKarte(darfSetzen) + regelKarte + grenzKarte(teams)
    + teamKarte('A', teams.A, darfSetzen) + teamKarte('B', teams.B, darfSetzen)
    + rausKarte + schritte;
}
