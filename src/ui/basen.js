import { basenSuchen, serverOf, suchmuster } from '../core/basen.js';
import { escapeHtml } from './umfragen.js';

// ====== BASEN DER WELTKARTE ======
//
// Was der Kartenscan gefunden hat: Name, Allianz, Stufe, Koordinate — und eine
// Suche über den Namen.
//
// **Die Suche schreibt nicht die ganze Seite neu.** Getippt wird in ein Feld,
// und ein `renderPage()` bei jedem Anschlag nähme dem Feld den Fokus und die
// Schreibmarke. Erneuert wird deshalb nur `#bs-body` — dieselbe Regel wie bei
// der Anwesenheitskarte im Admin-Bereich.

export let _bsSuche='',_bsRows=null,_bsMehr=false,_bsLaeuft=false,_bsFehler=null;
let _bsTimer=null,_bsLauf=0;

const GRENZE=200;

// ── Anzeige ─────────────────────────────────────────────────────────────────
function koord(x,y){return`<span style="font-variant-numeric:tabular-nums">X:${x} Y:${y}</span>`;}

function zeile(b){
  // Der Rohtext steht unter dem Namen, wenn beide auseinandergehen. Die
  // Erkennung ist nicht buchstabengetreu, und wer eine Zuordnung anzweifelt,
  // soll sehen können, was tatsächlich im Banner stand.
  const roh=b.name_roh&&b.name_roh!==b.name
    ?`<div style="font-size:10px;color:var(--tx3)">${escapeHtml(b.name_roh)}</div>`:'';
  const name=b.name?escapeHtml(b.name)
    :`<span style="color:var(--tx3)">${escapeHtml(b.name_roh||'')||'unlesbar'}</span>`;
  return`<tr>
    <td><strong>${name}</strong>${roh}</td>
    <td style="text-align:center">${b.allianz?`<span class="badge" style="background:#2980b922;color:#2980b9">${escapeHtml(b.allianz)}</span>`:'<span style="color:var(--tx3)">–</span>'}</td>
    <td style="text-align:center;font-weight:700">${b.level==null?'<span style="color:var(--tx3);font-weight:400">–</span>':b.level}</td>
    <td style="text-align:right;color:var(--tx2)">${koord(b.x,b.y)}</td>
  </tr>`;
}

function koerper(){
  if(_bsFehler)return`<div class="cb" style="padding:20px;text-align:center;color:var(--loss)">${escapeHtml(_bsFehler)}</div>`;
  if(_bsLaeuft&&!_bsRows)return`<div class="loader"><span class="spin"></span>Suche…</div>`;
  if(!_bsRows)return'';
  if(!_bsRows.length){
    // Zwei sehr verschiedene Fälle, und sie brauchen zwei verschiedene Sätze:
    // eine Suche ohne Treffer ist normal, eine leere Tabelle heißt, dass noch
    // gar nicht gescannt wurde.
    // Die Sätze tragen bewusst keine Auszeichnung in der Mitte: jedes Element
    // zerschneidet den Textknoten, und die Anzeigeschicht übersetzt je Knoten —
    // auf Englisch stünde die Zeile sonst halb deutsch da.
    return _bsSuche.trim()
      ?`<div class="cb" style="padding:22px;text-align:center;color:var(--tx3);font-size:13px"><div>Keine Basis gefunden, auf die dieser Suchbegriff passt.</div><div style="margin-top:8px">Mit einem Stern lässt sich lückenhaft suchen: Ben*men findet Ben_the_men.</div></div>`
      :`<div class="cb" style="padding:22px;text-align:center;color:var(--tx3);font-size:13px"><div>Für diesen Server sind noch keine Basen gespeichert.</div><div style="margin-top:8px">Sie entstehen beim Kartenscan — der fährt die Weltkarte kachelweise ab und liest die Banner.</div></div>`;
  }
  return`<div class="scroll-x"><table>
    <thead><tr><th>Spieler</th><th style="text-align:center">Allianz</th><th style="text-align:center">Stufe</th><th style="text-align:right">Koordinate</th></tr></thead>
    <tbody>${_bsRows.map(zeile).join('')}</tbody>
  </table></div>`
  +(_bsMehr?`<div class="cb" style="font-size:11px;color:var(--tx3);padding-top:0">Mehr als ${GRENZE} Treffer — es werden die ersten ${GRENZE} gezeigt. Suche eingrenzen.</div>`:'')
  +`<div class="cb" style="font-size:11px;color:var(--tx3);padding-top:6px">${_bsRows.length} ${_bsRows.length===1?'Basis':'Basen'}${_bsMehr?' (von mehr)':''}</div>`;
}

function koerperZeichnen(){
  const el=document.getElementById('bs-body');
  if(el)el.innerHTML=koerper();
}

// ── Laden ───────────────────────────────────────────────────────────────────
// Jeder Lauf bekommt eine Nummer. Tippt jemand weiter, während eine Anfrage
// unterwegs ist, kommt deren Antwort später als die der neueren — ohne diese
// Prüfung stünde am Ende das Ergebnis der *älteren* Suche in der Liste.
async function laden(){
  const lauf=++_bsLauf;
  _bsLaeuft=true;_bsFehler=null;
  koerperZeichnen();
  try{
    const {rows,mehr}=await basenSuchen(suchmuster(_bsSuche),{limit:GRENZE});
    if(lauf!==_bsLauf)return;
    _bsRows=rows;_bsMehr=!!mehr;
  }catch(e){
    if(lauf!==_bsLauf)return;
    _bsRows=[];_bsFehler='Basen konnten nicht geladen werden: '+e.message;
  }finally{
    if(lauf===_bsLauf)_bsLaeuft=false;
  }
  koerperZeichnen();
}

// Entprellt: bei jedem Anschlag zu fragen hieße, die Datenbank für jedes
// Zwischenwort zu befragen, dessen Ergebnis niemand sieht.
export function bsSuche(wert){
  _bsSuche=wert;
  clearTimeout(_bsTimer);
  _bsTimer=setTimeout(laden,250);
}
export function bsLeeren(){
  _bsSuche='';
  const f=document.getElementById('bs-q');
  if(f)f.value='';
  clearTimeout(_bsTimer);
  laden();
}

export function pageBasen(){
  const srv=serverOf();
  if(!srv){
    return`<div class="card"><div class="ch">Basen der Weltkarte</div>
      <div class="cb" style="padding:22px;text-align:center;color:var(--tx3)">Für diese Allianz ist kein Server hinterlegt — ohne ihn ist nicht zu sagen, welche Karte gemeint ist.</div></div>`;
  }
  // Beim ersten Öffnen einmal laden. Danach steht der letzte Stand noch da,
  // wenn man die Seite wieder aufruft — samt Suchbegriff.
  if(_bsRows===null&&!_bsLaeuft)setTimeout(laden,0);
  return`<div class="card">
    <div class="ch">Basen der Weltkarte <span class="ch-sub">Server ${escapeHtml(srv)}</span></div>
    <div class="cb">
      <div style="display:flex;gap:8px;align-items:center">
        <input id="bs-q" class="fi" type="search" value="${escapeHtml(_bsSuche)}" placeholder="Spielername suchen — z. B. Ben*men"
               oninput="bsSuche(this.value)" style="flex:1;min-width:0">
        <button class="btn btn-out btn-sm" onclick="bsLeeren()">Zurücksetzen</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-top:6px">Groß- und Kleinschreibung egal. Ein Stern steht für beliebig viele Zeichen: Ben*men findet Ben_the_men. Ohne Stern wird überall im Namen gesucht.</div>
    </div>
    <div id="bs-body">${koerper()}</div>
  </div>
  <div class="note info" style="margin-top:12px">
    <div style="font-weight:700;margin-bottom:4px">Woher die Daten kommen</div>
    <div>Der Kartenscan fotografiert die Weltkarte kachelweise ab und liest die Banner der Basen. Die Karte gehört dem Server, nicht einer Allianz — hier stehen deshalb die Basen aller Allianzen dieses Servers, nicht nur die eigenen.</div>
    <div style="margin-top:6px">Die Namen kommen aus einer Texterkennung und sind nicht buchstabengetreu. Weicht der erkannte Rohtext vom zugeordneten Namen ab, steht er klein darunter. Eine fehlende Stufe heißt „nicht gelesen", nicht „Stufe 0".</div>
  </div>`;
}
