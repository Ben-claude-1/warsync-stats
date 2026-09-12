import { lwaAllianz, lwaAllianzen, lwaSpielerSuchen, serverOf, suchmuster } from '../core/lwatlas.js';
import { LOC } from '../core/i18n.js';
import { escapeHtml } from './umfragen.js';

// ====== SPIELER UND ALLIANZEN DES SERVERS ======
//
// Zwei Reiter unter „Basen": die vollständige Spielerliste des Servers und die
// Allianzen, die darauf spielen — mit Kills, damit einzuschätzen ist, wer
// gefährlich ist. Eine hohe Kraft sagt das nämlich nicht: kiSS steht am
// 12.09.2026 mit 20,8 Mrd Kraft hinter XP33 (21,0 Mrd), hat aber ein Drittel
// mehr Kills. Kraft ist, was jemand gebaut hat; Kills sind, was er damit tut.
//
// **Erneuert wird nur der Rumpf**, nicht die ganze Seite — sonst nähme ein
// `renderPage()` bei jedem Anschlag dem Suchfeld Fokus und Schreibmarke.
// Dieselbe Regel wie bei der Basen-Suche und der Anwesenheitskarte.

export let _lwSuche='',_lwRows=null,_lwMehr=false,_lwLaeuft=false,_lwFehler=null;
export let _lwAllianzen=null,_lwGewaehlt=null,_lwSort='army_kill';
let _lwTimer=null,_lwLauf=0;

const GRENZE=200;

// ── Zahlen ──────────────────────────────────────────────────────────────────
// Millionen und Milliarden, weil die Rohzahlen neunstellig sind und nebeneinander
// niemand mehr erkennt, welche größer ist.
//
// **Trennzeichen und Einheit hängen an der Sprache**, nicht am Quelltext: auf
// Deutsch „249,1 Mio", auf Englisch „249.1M". Fest verdrahtet stünde im
// englischen Tool ein deutsches Komma, und der i18n-Beobachter hilft hier nicht
// — er übersetzt ganze Textknoten, keine Zahlenformate.
const EINHEIT={de:[' Mrd',' Mio',' Tsd'],en:['B','M','K']};

function kurz(n){
  if(n==null)return'<span style="color:var(--tx3)">–</span>';
  const z=Number(n);
  const e=LOC()==='en-GB'?EINHEIT.en:EINHEIT.de;
  const eins=w=>w.toLocaleString(LOC(),{minimumFractionDigits:1,maximumFractionDigits:1});
  if(z>=1e9)return eins(z/1e9)+e[0];
  if(z>=1e6)return eins(z/1e6)+e[1];
  if(z>=1e3)return Math.round(z/1e3).toLocaleString(LOC())+e[2];
  return z.toLocaleString(LOC());
}

// Wie lange jemand nicht mehr im Spiel war. Das ist die zweite Hälfte der
// Gefahreneinschätzung: ein starker Spieler, der seit zwei Wochen nicht da war,
// steht zwar auf der Karte, verteidigt sie aber nicht.
function herLang(iso){
  if(!iso)return'<span style="color:var(--tx3)">–</span>';
  const tage=Math.floor((Date.now()-new Date(iso).getTime())/86400000);
  if(!isFinite(tage))return'<span style="color:var(--tx3)">–</span>';
  if(tage<=0)return'<span style="color:var(--win)">heute</span>';
  if(tage===1)return'gestern';
  const farbe=tage>=14?'var(--loss)':tage>=7?'var(--tx2)':'var(--tx)';
  return`<span style="color:${farbe}">vor ${tage} Tagen</span>`;
}

function tag(t){
  return t?`<span class="badge" style="background:#2980b922;color:#2980b9">${escapeHtml(t)}</span>`
          :'<span style="color:var(--tx3)">–</span>';
}

// ── Spielerliste ────────────────────────────────────────────────────────────
function spielerZeile(s){
  return`<tr>
    <td><strong>${escapeHtml(s.name||'')||'<span style="color:var(--tx3)">ohne Namen</span>'}</strong>
        <div style="font-size:10px;color:var(--tx3)">X:${s.x} Y:${s.y}${s.rang?' · R'+s.rang:''}</div></td>
    <td style="text-align:center">${tag(s.allianz)}</td>
    <td style="text-align:center;font-weight:700">${s.level==null?'<span style="color:var(--tx3);font-weight:400">–</span>':s.level}</td>
    <td style="text-align:right">${kurz(s.power)}</td>
    <td style="text-align:right;font-weight:700">${kurz(s.army_kill)}</td>
    <td style="text-align:right;font-size:11px">${herLang(s.last_active_at)}</td>
  </tr>`;
}

function spielerKoerper(){
  if(_lwFehler)return`<div class="cb" style="padding:20px;text-align:center;color:var(--loss)">${escapeHtml(_lwFehler)}</div>`;
  if(_lwLaeuft&&!_lwRows)return`<div class="loader"><span class="spin"></span>Suche…</div>`;
  if(!_lwRows)return'';
  if(!_lwRows.length){
    // Die Sätze tragen bewusst keine Auszeichnung in der Mitte: jedes Element
    // zerschneidet den Textknoten, und die Anzeigeschicht übersetzt je Knoten.
    return _lwSuche.trim()
      ?`<div class="cb" style="padding:22px;text-align:center;color:var(--tx3);font-size:13px"><div>Kein Spieler gefunden, auf den dieser Suchbegriff passt.</div><div style="margin-top:8px">Mit einem Stern lässt sich lückenhaft suchen: Ben*men findet Ben_the_men.</div></div>`
      :`<div class="cb" style="padding:22px;text-align:center;color:var(--tx3);font-size:13px"><div>Für diesen Server sind noch keine Spieler abgerufen.</div><div style="margin-top:8px">Sie kommen aus LW Atlas und werden von scripts/lwatlas/sync.py geholt.</div></div>`;
  }
  // Welche Allianz gefiltert ist, steht **hier** und nicht in der Kopfzeile der
  // Karte: erneuert wird nur der Rumpf, die Kopfzeile bliebe beim Klick stehen
  // und behauptete weiter „alle Spieler".
  const gew=_lwGewaehlt&&_lwAllianzen?_lwAllianzen.find(a=>a.alliance_id===_lwGewaehlt):null;
  const kopf=_lwGewaehlt
    ?`<div class="cb" style="padding-bottom:0;display:flex;gap:8px;align-items:center">
        <button class="btn btn-out btn-sm" onclick="lwAllianzZeigen('')">← Alle Spieler</button>
        <strong>${escapeHtml(gew&&gew.tag?gew.tag:'')}</strong></div>`:'';
  return kopf+`<div class="scroll-x"><table>
    <thead><tr>
      <th>Spieler</th>
      <th style="text-align:center">Allianz</th>
      <th style="text-align:center">Stufe</th>
      <th style="text-align:right;cursor:pointer" onclick="lwSort('power')">Kraft${_lwSort==='power'?' ▾':''}</th>
      <th style="text-align:right;cursor:pointer" onclick="lwSort('army_kill')">Kills${_lwSort==='army_kill'?' ▾':''}</th>
      <th style="text-align:right">Zuletzt aktiv</th>
    </tr></thead>
    <tbody>${_lwRows.map(spielerZeile).join('')}</tbody>
  </table></div>`
  +(_lwMehr?`<div class="cb" style="font-size:11px;color:var(--tx3);padding-top:0">Mehr als ${GRENZE} Treffer — es werden die ersten ${GRENZE} gezeigt. Suche eingrenzen.</div>`:'')
  +`<div class="cb" style="font-size:11px;color:var(--tx3);padding-top:6px">${_lwRows.length} ${_lwRows.length===1?'Spieler':'Spieler'}${_lwMehr?' (von mehr)':''}</div>`;
}

// ── Allianzliste ────────────────────────────────────────────────────────────
function allianzZeile(a){
  // Die gemeldete Mitgliederzahl steht daneben, wenn sie abweicht: `mitglieder`
  // sind die Basen, die ein Scan bestätigt hat, `gemeldet` ist, was das Spiel
  // selbst sagt. Ein Unterschied heißt nicht „falsch", sondern „noch nicht
  // wiedergefunden" — und das gehört sichtbar, statt still gemittelt zu werden.
  const abw=a.gemeldet!=null&&a.mitglieder!=null&&a.gemeldet!==a.mitglieder
    ?` <span style="color:var(--tx3);font-size:10px">von ${a.gemeldet}</span>`:'';
  return`<tr style="cursor:pointer" onclick="lwAllianzZeigen('${escapeHtml(a.alliance_id)}')">
    <td><strong>${escapeHtml(a.tag||'')||'–'}</strong></td>
    <td style="text-align:center">${a.mitglieder==null?'–':a.mitglieder}${abw}</td>
    <td style="text-align:right">${kurz(a.power)}</td>
    <td style="text-align:right;font-weight:700">${kurz(a.kills)}</td>
  </tr>`;
}

function allianzKoerper(){
  if(!_lwAllianzen)return`<div class="loader"><span class="spin"></span>Lade…</div>`;
  if(!_lwAllianzen.length)
    return`<div class="cb" style="padding:22px;text-align:center;color:var(--tx3);font-size:13px">Für diesen Server sind noch keine Allianzen abgerufen.</div>`;
  return`<div class="scroll-x"><table>
    <thead><tr><th>Allianz</th><th style="text-align:center">Mitglieder</th><th style="text-align:right">Kraft</th><th style="text-align:right">Kills</th></tr></thead>
    <tbody>${_lwAllianzen.map(allianzZeile).join('')}</tbody>
  </table></div>
  <div class="cb" style="font-size:11px;color:var(--tx3);padding-top:6px">${_lwAllianzen.length} Allianzen · Klick zeigt die Mitglieder</div>`;
}

// ── Laden ───────────────────────────────────────────────────────────────────
// Jeder Lauf bekommt eine Nummer. Tippt jemand weiter, während eine Anfrage
// unterwegs ist, käme deren Antwort später als die der neueren — ohne diese
// Prüfung stünde am Ende das Ergebnis der älteren Suche in der Liste.
async function laden(){
  const lauf=++_lwLauf;
  _lwLaeuft=true;_lwFehler=null;
  zeichnen();
  try{
    const {rows,mehr}=await lwaSpielerSuchen(suchmuster(_lwSuche),
      {limit:GRENZE,allianz:_lwGewaehlt,sortierung:_lwSort});
    if(lauf!==_lwLauf)return;
    _lwRows=rows;_lwMehr=!!mehr;
  }catch(e){
    if(lauf!==_lwLauf)return;
    _lwRows=[];_lwFehler='Spieler konnten nicht geladen werden: '+e.message;
  }finally{
    if(lauf===_lwLauf)_lwLaeuft=false;
  }
  zeichnen();
}

async function allianzenLaden(){
  try{
    const {rows}=await lwaAllianzen();
    _lwAllianzen=rows;
  }catch(e){ _lwAllianzen=[]; }
  zeichnen();
}

function zeichnen(){
  const s=document.getElementById('lw-spieler');
  if(s)s.innerHTML=spielerKoerper();
  const a=document.getElementById('lw-allianzen');
  if(a)a.innerHTML=allianzKoerper();
}

// ── Bedienung ───────────────────────────────────────────────────────────────
// Entprellt: bei jedem Anschlag zu fragen hieße, die Datenbank für jedes
// Zwischenwort zu befragen, dessen Ergebnis niemand sieht.
export function lwSuche(wert){
  _lwSuche=wert;
  clearTimeout(_lwTimer);
  _lwTimer=setTimeout(laden,250);
}

export function lwSort(feld){
  _lwSort=feld;
  laden();
}

// Leere Kennung heißt „zurück zu allen Spielern" — der Knopf über der Liste.
export function lwAllianzZeigen(allianceId){
  _lwGewaehlt=allianceId||null;
  _lwSuche='';
  const f=document.getElementById('lw-q');
  if(f)f.value='';
  laden();
}

export function lwLaden(){
  if(_lwRows===null&&!_lwLaeuft)laden();
  if(_lwAllianzen===null)allianzenLaden();
}

// ── Seitenteile ─────────────────────────────────────────────────────────────
export function lwSpielerKarte(){
  const srv=serverOf();
  return`<div class="card">
    <div class="ch">Spieler auf ${escapeHtml(srv||'')} <span class="ch-sub">aus LW Atlas</span></div>
    <div class="cb">
      <div style="display:flex;gap:8px;align-items:center">
        <input id="lw-q" class="fi" type="search" value="${escapeHtml(_lwSuche)}" placeholder="Spielername suchen — z. B. Ben*men"
               oninput="lwSuche(this.value)" style="flex:1;min-width:0">
        <button class="btn btn-out btn-sm" onclick="lwAllianzZeigen('')">Zurücksetzen</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-top:6px">Kraft und Kills gibt es nur für Spieler in einer Allianz — sie stammen aus der Mitgliederliste, nicht von der Karte.</div>
    </div>
    <div id="lw-spieler">${spielerKoerper()}</div>
  </div>`;
}

export function lwAllianzKarte(){
  return`<div class="card" style="margin-top:12px">
    <div class="ch">Allianzen auf diesem Server <span class="ch-sub">nach Kills</span></div>
    <div id="lw-allianzen">${allianzKoerper()}</div>
  </div>`;
}
