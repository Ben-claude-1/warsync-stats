import { APP } from '../core/state.js';
import { canAccess, fmt } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { sbPatch } from '../core/api.js';
import { renderPage } from '../app/render.js';
import { zuteilungVorschlag, zuteilungSchritte, ZUT_MAX_GESETZT, ZUT_MAX_ERSATZ } from '../core/zuteilung.js';
import { getNextFriday, wsZeit } from './ws.js';

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
// **Geschrieben wird hier nichts.** Eingeteilt wird im Spiel — das Werkzeug
// bekommt den neuen Stand beim nächsten Scan. Ein Knopf „übernehmen" würde
// genau die Verwechslung erzeugen, gegen die der ganze Reiter gebaut ist:
// im Tool stünde die Wunsch-Aufstellung, im Spiel die echte.
let _vorschlag = null;

export function zuteilungBerechnen() {
  _vorschlag = zuteilungVorschlag({ eventDate: getNextFriday() });
  renderPage();
}

export function zuteilungVerwerfen() {
  _vorschlag = null;
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
  if (_vorschlag) _vorschlag = zuteilungVorschlag({ eventDate: getNextFriday() });
  renderPage();
  try {
    await sbPatch('ws_players', 'name=eq.' + encodeURIComponent(name), { ersatz_wunsch: neu });
  } catch (e) {
    p.ersatz_wunsch = !neu;
    if (_vorschlag) _vorschlag = zuteilungVorschlag({ eventDate: getNextFriday() });
    renderPage();
    alert('Der Ersatz-Wunsch konnte nicht gespeichert werden: ' + ((e && e.message) || e));
  }
}

// Der Index hat immer zwei Nachkommastellen — 2,0 und 2 nebeneinander in einer
// Spalte liest sich sonst wie zwei verschiedene Größen. Trennzeichen über LOC().
const idx = v => v.toLocaleString(LOC(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function marken(m) {
  const teile = [];
  if (m.stern) teile.push('<span title="bringt viel" style="color:#d4a017">★</span>');
  if (m.wunschErsatz) teile.push('<span title="möchte auf die Ersatzbank">🪑</span>');
  if (m.prio > 0) teile.push(`<span style="color:#7c4dff;font-weight:700" title="Prio-Marke">⭐${m.prio}</span>`);
  if (m.index != null) teile.push(`<span style="color:var(--tx3)">📈 ${idx(m.index)}</span>`);
  return teile.join(' ');
}

function zeile(m, i, darfSetzen) {
  const wunsch = darfSetzen
    ? `<button class="btn btn-out btn-sm" style="font-size:10px;padding:2px 6px;flex-shrink:0"
        onclick="zutWunschUmschalten('${m.name.replace(/'/g, "\\'")}')"
        title="Ersatz-Wunsch umschalten">🪑</button>`
    : '';
  return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--bd)">
    <span style="width:22px;color:var(--tx3);font-size:11px;flex-shrink:0">${i}.</span>
    <span style="flex:1 1 120px;min-width:0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
    <span style="font-size:11px;flex-shrink:0">${marken(m)}</span>
    <span style="font-size:11px;color:var(--tx2);width:58px;text-align:right;flex-shrink:0">${fmt(Math.round(m.kraft))} Mio</span>
    ${wunsch}
  </div>`;
}

function teamKarte(t, gruppe, darfSetzen) {
  const farbe = t === 'A' ? '#2f6fed' : '#e07b39';
  return `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span style="color:${farbe}">Team ${t} · ${wsZeit(t)}</span>
      <span class="ch-sub">${gruppe.gesetzt.length}/${ZUT_MAX_GESETZT} gesetzt · ${gruppe.ersatz.length}/${ZUT_MAX_ERSATZ} Ersatz</span></div>
    <div style="padding:6px 14px 10px">
      <div style="font-size:11px;font-weight:800;color:${farbe};margin:4px 0 2px">GESETZT (bekommt ein Gebäude)</div>
      ${gruppe.gesetzt.map((m, i) => zeile(m, i + 1, darfSetzen)).join('')}
      <div style="font-size:11px;font-weight:800;color:var(--tx2);margin:10px 0 2px">ERSATZ (spielt mit, ohne Gebäude)</div>
      ${gruppe.ersatz.map((m, i) => zeile(m, i + 1, darfSetzen)).join('')}
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
        ? `aus ${feld(s.alt)} abmelden <span style="color:var(--tx3)">(kommt auf Blatt ${s.ziel[0]} wieder)</span>`
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

export function zuteilungView() {
  const darfSetzen = canAccess('ws');
  const kopf = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>🧮 Verteilung</span><span class="ch-sub">Vorschlag für ${getNextFriday()}</span></div>
    <div style="padding:10px 14px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">
        Wer diesmal zuschaut — gerechnet aus Anmeldung, Aussetzen-Marken, Sternen, Prioliste und Leistungsindex. Geschrieben wird nichts: eingeteilt wird im Spiel, die Liste unten sagt Schritt für Schritt, was dort zu tun ist.
      </div>
      <div style="font-size:11px;color:var(--tx3);line-height:1.5;margin-top:6px">
        Grundlage ist der Anmeldestand, den das Werkzeug kennt — also der letzte Scan.
        Wer sich seitdem abgemeldet hat, steht hier noch mit drin und nimmt einen Platz weg.
      </div>
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

  const { teams, raus, regeln, soll } = _vorschlag;
  const { plan, offen } = zuteilungSchritte(APP.teamAssign || {}, soll);

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
        <div style="display:flex;gap:6px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--bd);font-size:12px">
          <span style="flex:1 1 110px;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
          <span style="flex-shrink:0;color:var(--tx3);font-size:11px">${m.team}C</span>
          <span style="flex:1 1 140px;color:var(--tx2);font-size:11px">${m.grund}</span>
        </div>`).join('')
      : '<div style="font-size:12px;color:var(--tx3);padding:6px 0">Niemand — es passen alle auf die Plätze.</div>'}
    </div></div>`;

  const schritte = `<div class="card" style="margin-bottom:12px">
    <div class="ch"><span>📋 In Last War einstellen</span><span class="ch-sub">${plan.length} Schritte, in dieser Reihenfolge</span></div>
    <div style="padding:8px 14px 12px">
      <div style="font-size:12px;color:var(--tx2);line-height:1.5;margin-bottom:4px">
        Alle vier Töpfe sind voll — solange das so ist, nimmt das Spiel keinen Wechsel an. Die Reihenfolge räumt deshalb zuerst frei; hinter jedem Schritt stehen die Zähler, wie sie danach im Spiel stehen müssen.
      </div>
      ${plan.length ? schrittListe(plan)
      : '<div style="font-size:12px;color:var(--tx3);padding:6px 0">Nichts zu tun — das Spiel steht schon so.</div>'}
      ${offen.length ? `<div style="margin-top:8px;font-size:12px;color:#c0392b">
        ${offen.length} Züge lassen sich nicht einsortieren — bitte melden.</div>` : ''}
    </div></div>`;

  return kopf + regelKarte
    + teamKarte('A', teams.A, darfSetzen) + teamKarte('B', teams.B, darfSetzen)
    + rausKarte + schritte;
}
