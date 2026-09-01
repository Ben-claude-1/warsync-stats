import { renderPage } from '../app/render.js';
import { canAccess, csPower, wsPower } from '../core/helpers.js';
import { avatarImg, isInactive } from '../core/players.js';
import { PRIO_MODI, prioListe, prioOf, prioSetzen } from '../core/prio.js';
import { APP } from '../core/state.js';

// ── Reiter „⭐ Prio" ───────────────────────────────────────────────────────────
// Wer beim letzten Anmeldeschluss keinen der 30 Plätze bekam, steht hier mit
// einer Zahl: wie oft hintereinander das passiert ist. Die Liste ist ein
// Vorschlag für die nächste Einteilung, kein Automatismus — die Aufstellung um
// 04:00 soll niemand mehr umbauen, und wer die Einteilung macht, entscheidet
// selbst, ob die Prio schwerer wiegt als die Stärke.
//
// Ein Reiter für beide Events, mit Umschalter: die Zähler laufen getrennt
// (ws_priority.mode), aber die Ansicht ist dieselbe, und zwei Reiter an zwei
// Stellen wären zweimal zu suchen.

function _q(s){return String(s).replace(/'/g,"\\'");}
export function prioMode(){
  const m=APP.prioMode;
  return PRIO_MODI.some(x=>x.k===m)?m:'ws';
}
export function prioSetMode(m){
  if(!PRIO_MODI.some(x=>x.k===m))return;
  APP.prioMode=m;renderPage();
}
export function prioDarfAendern(){return canAccess(prioMode()==='ws'?'ws':'cs');}
// Der Stepper korrigiert von Hand. Gebraucht wird er, wenn nach dem
// Anmeldeschluss noch umgeplant wurde: die Verrechnung läuft je Anmeldeschluss
// genau einmal und trägt Spätere Änderungen nicht nach (siehe core/prio.js).
export async function prioAdjust(name,d){
  const mode=prioMode();
  if(!prioDarfAendern())return;
  const wert=Math.max(0,prioOf(name,mode)+d);
  try{await prioSetzen(name,mode,wert);}
  catch(e){alert('Der Prio-Zähler konnte nicht gespeichert werden:\n'+((e&&e.message)||e));}
  renderPage();
}

// Wie der Spieler gerade in der Anmeldung desselben Events steht — damit beim
// Einteilen sofort sichtbar ist, ob der Vorschlag schon umgesetzt wurde.
function aktuellerWert(name,mode){
  const a=mode==='ws'?APP.teamAssign:APP.csTeamAssign;
  return(a||{})[name]||null;
}

export function prioView(){
  const mode=prioMode();
  const liste=prioListe(mode);
  const darf=prioDarfAendern();
  const power=mode==='ws'?wsPower:csPower;
  const modeLabel=PRIO_MODI.find(m=>m.k===mode).label;

  let h=`<div class="ttabs">
    ${PRIO_MODI.map(m=>`<button class="ttab${mode===m.k?(m.k==='ws'?' on-a':' on-b'):''}" onclick="prioSetMode('${m.k}')">⭐ ${m.label}</button>`).join('')}
  </div>`;

  h+=`<div class="note info">
    <div style="font-weight:700;margin-bottom:4px">Vorschlag für die nächste Einteilung — ${modeLabel}</div>
    <div>Hier steht, wie oft ein Spieler angemeldet war, aber keinen der 30 Plätze bekommen hat (Knopf C in der Anmeldung). Der Zähler steigt bei jedem Anmeldeschluss um 1, sobald jemand wieder aufgestellt wird um 1 zurück, und nie unter 0. Wer sich gar nicht anmeldet, behält seinen Stand für die nächste Woche.</div>
    <div style="margin-top:6px">Die Liste ändert nichts von selbst: sie zeigt nur, wen du bevorzugen solltest. Dieselbe ⭐-Marke steht in der Anmeldung neben dem Namen.</div>
  </div>`;

  if(!liste.length){
    h+=`<div class="card"><div class="cb" style="text-align:center;color:var(--tx3);font-size:13px;padding:22px">
      Niemand wartet. Alle Angemeldeten haben zuletzt einen Platz bekommen — oder der erste Anmeldeschluss mit dem C-Knopf steht noch aus.
    </div></div>`;
    return h;
  }

  const zeilen=liste.map((r,i)=>{
    const name=r.player_name;
    const inaktiv=isInactive(name);
    const wert=aktuellerWert(name,mode);
    const kraft=power(name);
    // Rot ab 3: wer dreimal hintereinander leer ausging, ist keine Randnotiz mehr.
    const c=r.counter>=3?'var(--loss)':r.counter===2?'#e67e22':'#8e44ad';
    const stand=wert==='C'?`<span style="color:#8e44ad;font-weight:700">wieder C</span>`
      :wert?`<span style="color:var(--win);font-weight:700">eingeteilt · ${wert}</span>`
      :`<span style="color:var(--tx3)">nicht angemeldet</span>`;
    return`<tr style="${inaktiv?'opacity:.45':''}">
      <td style="text-align:center;font-weight:800;color:var(--tx3)">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        ${avatarImg(name,26,'border-radius:6px','')}
        <strong style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${_q(name)}')">${name}</strong>
        ${inaktiv?'<span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>':''}
      </div></td>
      <td style="text-align:center"><span style="display:inline-block;min-width:26px;padding:2px 7px;border-radius:6px;background:${c}22;color:${c};font-weight:800;font-size:13px">${r.counter}</span></td>
      <td style="font-size:11px;white-space:nowrap">${stand}</td>
      <td style="text-align:right;font-size:11px;color:var(--tx3);white-space:nowrap">${kraft?kraft.toFixed(1)+'M':'–'}</td>
      ${darf?`<td style="text-align:right;white-space:nowrap">
        <button class="btn btn-out btn-sm" title="Zähler um eins verringern" style="padding:2px 8px;font-size:12px" onclick="prioAdjust('${_q(name)}',-1)">−</button>
        <button class="btn btn-out btn-sm" title="Zähler um eins erhöhen" style="padding:2px 8px;font-size:12px" onclick="prioAdjust('${_q(name)}',1)">+</button>
      </td>`:''}
    </tr>`;
  }).join('');

  const summe=liste.reduce((s,r)=>s+r.counter,0);
  const zSpieler=liste.length===1?'1 Spieler':`${liste.length} Spieler`;
  const zMerk=summe===1?'1 offene Vormerkung':`${summe} offene Vormerkungen`;
  h+=`<div class="card">
    <div class="ch">Warteschlange <span class="ch-sub">${zSpieler} · ${zMerk}</span></div>
    <div class="scroll-x"><table>
      <thead><tr><th style="text-align:center">#</th><th>Spieler</th><th style="text-align:center">Ohne Platz</th><th>Diese Woche</th><th style="text-align:right">Stärke</th>${darf?'<th></th>':''}</tr></thead>
      <tbody>${zeilen}</tbody>
    </table></div>
  </div>`;
  return h;
}
