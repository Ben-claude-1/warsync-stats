import { renderPage } from '../app/render.js';
import { canAccess, wsPower } from '../core/helpers.js';
import { avatarImg, isInactive } from '../core/players.js';
import { prioCGesamt, prioListe, prioOf, prioSetzen } from '../core/prio.js';
import { EINSATZ_LEER, einsatzBilanzAlle } from '../core/rotation.js';
import { APP } from '../core/state.js';

// ── Reiter „⭐ Prio" ───────────────────────────────────────────────────────────
// Wer beim letzten Anmeldeschluss keinen der 30 Plätze bekam, steht hier mit
// einer Zahl: wie oft hintereinander das passiert ist. Die Liste ist ein
// Vorschlag für die nächste Einteilung, kein Automatismus — die Aufstellung um
// 04:00 soll niemand mehr umbauen, und wer die Einteilung macht, entscheidet
// selbst, ob die Prio schwerer wiegt als die Stärke.
//
// **Ein Zähler, zwei Einstiege.** Derselbe Reiter hängt im Wüstensturm und im
// Schluchtsturm; beide zeigen dieselbe Liste, weil beide Events auf denselben
// Zähler einzahlen. Zwei getrennte Listen hätten dieselbe Person zweimal mit
// einer harmlosen 1 gezeigt, statt einmal mit der ehrlichen 2.

function _q(s){return String(s).replace(/'/g,"\\'");}

export function prioDarfAendern(){return canAccess('ws')||canAccess('cs');}
// Der Stepper korrigiert von Hand. Gebraucht wird er, wenn nach dem
// Anmeldeschluss noch umgeplant wurde: die Verrechnung läuft je Anmeldeschluss
// genau einmal und trägt spätere Änderungen nicht nach (siehe core/prio.js).
export async function prioAdjust(name,d){
  if(!prioDarfAendern())return;
  const wert=Math.max(0,prioOf(name)+d);
  try{await prioSetzen(name,wert);}
  catch(e){alert('Der Prio-Zähler konnte nicht gespeichert werden:\n'+((e&&e.message)||e));}
  renderPage();
}

// Wie der Spieler gerade in beiden Anmeldungen steht — damit beim Einteilen
// sofort sichtbar ist, ob der Vorschlag schon umgesetzt wurde, und in welchem
// Event er diese Woche wieder leer auszugehen droht.
function standZelle(name){
  const teil=(kurz,wert)=>{
    if(wert==='C')return`<span style="color:#8e44ad;font-weight:700">${kurz} C</span>`;
    if(wert)return`<span style="color:var(--win);font-weight:700">${kurz} ${wert}</span>`;
    return`<span style="color:var(--tx3)">${kurz} –</span>`;
  };
  return teil('WS',(APP.teamAssign||{})[name])+' · '+teil('CS',(APP.csTeamAssign||{})[name]);
}

// ── Bilanz: alle Spieler, alle Zähler ─────────────────────────────────────────
// Die Warteschlange oben zeigt nur, wer gerade dran wäre. Diese Tabelle
// beantwortet die andere Frage: wen trifft es über die Monate hinweg immer
// wieder. Wer abwechselnd spielt und aussetzt, steht in der Warteschlange
// dauernd bei 0 oder 1 und fiele sonst nie auf.
//
// Sortiert nach C-Gesamt absteigend, bei Gleichstand nach der Zahl der Einsätze
// aufsteigend: oben steht, wer oft zuschauen musste und selten gespielt hat.
function bilanzKarte(){
  const bilanz=einsatzBilanzAlle();
  const zeilen=APP.data.players.filter(p=>!isInactive(p.name)).map(p=>{
    const e=bilanz[p.name]||EINSATZ_LEER;
    return{name:p.name,c:prioCGesamt(p.name),offen:prioOf(p.name),
      ws:e.ws,cs:e.cs,einsaetze:e.ws.gesetzt+e.cs.gesetzt};
  }).sort((a,b)=>(b.c-a.c)||(a.einsaetze-b.einsaetze)||a.name.localeCompare(b.name));
  if(!zeilen.length)return'';
  // Nichts gezählt heißt: es gab noch keinen Anmeldeschluss mit diesen Daten.
  // Eine Tabelle aus lauter Nullen wäre kein Gewinn.
  if(!zeilen.some(z=>z.c||z.einsaetze||z.ws.ersatz||z.cs.ersatz))return'';
  const zelle=(g,er)=>`<span style="font-weight:700">${g}</span><span style="color:var(--tx3)"> · ${er}</span>`;
  const rows=zeilen.map(z=>`<tr>
    <td><strong style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${_q(z.name)}')">${z.name}</strong></td>
    <td style="text-align:center;font-weight:800;color:${z.c>=5?'var(--loss)':z.c>=3?'#e67e22':z.c?'#8e44ad':'var(--tx3)'}">${z.c||'–'}</td>
    <td style="text-align:center">${z.ws.gesetzt||z.ws.ersatz?zelle(z.ws.gesetzt,z.ws.ersatz):'<span style="color:var(--tx3)">–</span>'}</td>
    <td style="text-align:center">${z.cs.gesetzt||z.cs.ersatz?zelle(z.cs.gesetzt,z.cs.ersatz):'<span style="color:var(--tx3)">–</span>'}</td>
    <td style="text-align:center;color:var(--tx3)">${z.offen||'–'}</td>
  </tr>`).join('');
  return`<div class="card" style="margin-top:12px">
    <div class="ch">Einsatz-Bilanz <span class="ch-sub">gesetzt · Ersatz je Event</span></div>
    <div class="cb" style="padding-bottom:0;font-size:11px;color:var(--tx3)">
      Erste Zahl: wie oft gesetzt (A oder B). Zweite Zahl: wie oft als Ersatz (AE oder BE). Gezählt wird jeder festgeschriebene Kader — Wüstensturm und Schluchtsturm getrennt, weil es zwei Verpflichtungen sind.
    </div>
    <div class="scroll-x"><table>
      <thead><tr><th>Spieler</th><th style="text-align:center">C gesamt</th><th style="text-align:center">Wüstensturm</th><th style="text-align:center">Schluchtsturm</th><th style="text-align:center">Offen</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

export function prioView(){
  const liste=prioListe();
  const darf=prioDarfAendern();

  let h=`<div class="note info">
    <div style="font-weight:700;margin-bottom:4px">Vorschlag für die nächste Einteilung</div>
    <div>Hier steht, wie oft ein Spieler angemeldet war, aber keinen der 30 Plätze bekommen hat (Knopf C in der Anmeldung). Der Zähler steigt bei jedem Anmeldeschluss um 1, sobald jemand wieder aufgestellt wird um 1 zurück, und nie unter 0. Wer sich gar nicht anmeldet, behält seinen Stand für die nächste Woche.</div>
    <div style="margin-top:6px">Wüstensturm und Schluchtsturm zahlen auf denselben Zähler ein. Wer sich in derselben Woche für beide meldet und beide Male auf C landet, hat zweimal zugeschaut und steht mit einer 2 da.</div>
    <div style="margin-top:6px">„Offen" ist dieser Zähler — der Vorschlag für die nächste Einteilung. „C gesamt" daneben sinkt nie: das ist die Summe aller C-Einteilungen und zeigt, wen es über die Monate hinweg immer wieder trifft.</div>
    <div style="margin-top:6px">Die Liste ändert nichts von selbst: sie zeigt nur, wen du bevorzugen solltest. Dieselbe ⭐-Marke steht in beiden Anmeldungen neben dem Namen.</div>
  </div>`;

  if(!liste.length){
    h+=`<div class="card"><div class="cb" style="text-align:center;color:var(--tx3);font-size:13px;padding:22px">
      Niemand wartet. Alle Angemeldeten haben zuletzt einen Platz bekommen — oder der erste Anmeldeschluss mit dem C-Knopf steht noch aus.
    </div></div>`;
    return h+bilanzKarte();
  }

  const zeilen=liste.map((r,i)=>{
    const name=r.player_name;
    const inaktiv=isInactive(name);
    const kraft=wsPower(name);
    // Rot ab 3: wer dreimal hintereinander leer ausging, ist keine Randnotiz mehr.
    const c=r.counter>=3?'var(--loss)':r.counter===2?'#e67e22':'#8e44ad';
    return`<tr style="${inaktiv?'opacity:.45':''}">
      <td style="text-align:center;font-weight:800;color:var(--tx3)">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:7px">
        ${avatarImg(name,26,'border-radius:6px','')}
        <strong style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${_q(name)}')">${name}</strong>
        ${inaktiv?'<span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>':''}
      </div></td>
      <td style="text-align:center"><span style="display:inline-block;min-width:26px;padding:2px 7px;border-radius:6px;background:${c}22;color:${c};font-weight:800;font-size:13px">${r.counter}</span></td>
      <td style="text-align:center;font-weight:700;color:var(--tx3)">${r.c_total||r.counter}</td>
      <td style="font-size:11px;white-space:nowrap">${standZelle(name)}</td>
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
      <thead><tr><th style="text-align:center">#</th><th>Spieler</th><th style="text-align:center">Offen</th><th style="text-align:center">C gesamt</th><th>Diese Woche</th><th style="text-align:right">Stärke</th>${darf?'<th></th>':''}</tr></thead>
      <tbody>${zeilen}</tbody>
    </table></div>
  </div>`;
  return h+bilanzKarte();
}
