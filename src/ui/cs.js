import { renderPage } from '../app/render.js';
import { plannerPush, plannerResolve } from '../core/auth.js';
import { badge, byRankThenHero, csPower, fmt, powerTag, relColor, reliability, serverZeit, setCsStrength, strengthPicker, zeitLang } from '../core/helpers.js';
import { trEN } from '../core/i18n.js';
import { avatarImg, isInactive } from '../core/players.js';
import { _svgToPngCanvas, savePngToPhotos } from '../core/png.js';
import { APP } from '../core/state.js';
import { currentAlliance, lsKey } from '../core/tenant.js';
import { copyText, saveWSState } from './buildings.js';
import { openPlayer } from './overlay.js';
import { escapeHtml } from './umfragen.js';
import { wsIstErsatz, wsTeamOf } from './ws.js';

// ========== SCHLUCHTSTURM (Canyon Storm) ==========
// 2 vs 1: Ordnungshüter (1 Allianz) gegen Morgenbringer (2 Allianzen) · je 20 Spieler.
// 30 Min Laufzeit · max. 5 Spieler pro Gebäude · Teleport-Cooldown 3 Min.
//
// Planmodell — pro Spieler {s, d}:
//   s = Startgebäude ab 0:00 (null bei Assassinen, die flexibel agieren)
//   d = Ziel bei Freischaltung (null = bleibt stehen · 'viruslab' = Assassine)
// Regel: gewechselt wird NUR von einem Startgebäude in ein neu freigeschaltetes.
// Zwischen zwei von Anfang an offenen Gebäuden wird nie gewechselt.
export const CS_DUR=1800;
export const CS_MAXCAP=5;
export const CS_BLD={
  viruslab: {label:'Hochsicherheitslabor',     short:'HS-Labor',dot:'🟣',pts:120,from:720,color:'#7c3aed',
    eff:'Wird eine Weile nach Kampfbeginn freigegeben. Laut Spiel „der Schlüssel zum Sieg" — mit Abstand die höchste Punktrate.'},
  kraftturm:{label:'Energieturm',               short:'E-Turm', dot:'🔴',pts:50, from:0,  color:'#c0392b',
    eff:'Erobern die Ordnungshüter ihn, können sie den Schutzschild der sicheren Zone im Kartenzentrum aktivieren — Basen dort sind dann unangreifbar.'},
  dc_w:     {label:'Datenzentrum I',            short:'DZ I',   dot:'🔵',pts:20, from:0,  color:'#2980b9',
    eff:'Eines von zwei Datenzentren nahe dem Ordnungshüter-Spawn. Stetige Punktquelle ab Start.'},
  dc_o:     {label:'Datenzentrum II',           short:'DZ II',  dot:'🔵',pts:20, from:0,  color:'#2980b9',
    eff:'Eines von zwei Datenzentren nahe dem Ordnungshüter-Spawn. Stetige Punktquelle ab Start.'},
  serum_nw: {label:'Serumfabrik I',             short:'Serum I',dot:'🟢',pts:20, from:300,color:'#27ae60',
    eff:'Öffnet 5:00. Gewährt dem Garnisonskommandanten in regelmäßigen Abständen Buffs — die Effekte werden vorher angezeigt.'},
  serum_so: {label:'Serumfabrik II',            short:'Serum II',dot:'🟢',pts:20,from:300,color:'#27ae60',
    eff:'Öffnet 5:00. Gewährt dem Garnisonskommandanten in regelmäßigen Abständen Buffs — die Effekte werden vorher angezeigt.'},
  def_no:   {label:'Verteidigungssystem I',     short:'Vert. I',dot:'🟠',pts:20, from:480,color:'#e67e22',
    eff:'Öffnet 8:00. Greift nach der Eroberung AUTOMATISCH alle feindlich besetzten Kerngebäude an (Labor, Serumfabrik, Verteidigungssystem, Energieturm) und schädigt deren Garnisonstruppen.'},
  def_sw:   {label:'Verteidigungssystem II',    short:'Vert. II',dot:'🟠',pts:20,from:480,color:'#e67e22',
    eff:'Öffnet 8:00. Greift nach der Eroberung AUTOMATISCH alle feindlich besetzten Kerngebäude an (Labor, Serumfabrik, Verteidigungssystem, Energieturm) und schädigt deren Garnisonstruppen.'},
  lager1:   {label:'Probenlager I',            short:'PL I',   dot:'⚪',pts:15, from:0,  color:'#7f8c8d',
    eff:'Eines von vier Probenlagern nahe dem Morgenbringer-Spawn. Ruhige Dauerpunkte.'},
  lager2:   {label:'Probenlager II',           short:'PL II',  dot:'⚪',pts:15, from:0,  color:'#7f8c8d',
    eff:'Eines von vier Probenlagern nahe dem Morgenbringer-Spawn. Ruhige Dauerpunkte.'},
  lager3:   {label:'Probenlager III',          short:'PL III', dot:'⚪',pts:15, from:0,  color:'#7f8c8d',
    eff:'Eines von vier Probenlagern nahe dem Morgenbringer-Spawn. Ruhige Dauerpunkte.'},
  lager4:   {label:'Probenlager IV',           short:'PL IV',  dot:'⚪',pts:15, from:0,  color:'#7f8c8d',
    eff:'Eines von vier Probenlagern nahe dem Morgenbringer-Spawn. Ruhige Dauerpunkte.'},
};
export const CS_START_BLD=['kraftturm','dc_w','dc_o','lager1','lager2','lager3','lager4']; // ab 0:00 offen
export const CS_LATE_BLD =['serum_nw','serum_so','def_no','def_sw'];                       // 5:00 / 8:00
export const CS_ALL_BLD  =['viruslab',...CS_START_BLD,...CS_LATE_BLD];
export const CS_TCOL={300:'#27ae60',480:'#e67e22',720:'#7c3aed'};
export function csTLabel(b){const f=CS_BLD[b].from;return f?Math.floor(f/60)+':00':'0:00';}
export function csTColor(b){return CS_TCOL[CS_BLD[b].from]||'#7f8c8d';}
export const CS_PHASES=[
  {t:'0:00', desc:'Energieturm, 2× Datenzentrum und 4× Probenlager sind offen. Assassinen sichern flexibel, wo es eng wird.'},
  {t:'5:00', desc:'Serumfabriken öffnen — die eingeteilten Spieler wechseln aus ihrem Startgebäude dorthin.'},
  {t:'8:00', desc:'Verteidigungssysteme öffnen — mit Priorität nehmen, sie greifen die gegnerischen Kerngebäude automatisch an.'},
  {t:'12:00',desc:'Hochsicherheitslabor öffnet — 5 Spieler rein (mehr passen nicht), der Rest hält den Raum drumherum frei.'},
];
export const CS_FACTIONS={
  ordnung:{label:'Ordnungshüter',color:'#c0392b',bg:'#fdedec',setup:'1 Allianz — stärker, aber allein gegen zwei',
    spawn:'Spawn im Norden',
    skills:[
      {n:'Tag des Jüngsten Gerichts (Vollstrecker)',cost:'120 s aktiv · 300 s Abklingzeit',eff:'Jeder Teleport macht 5.000 Haltbarkeitsschaden an Feindbasen im weiteren Umfeld. Pro zerstörter Basis −30 s eigener Teleport-Cooldown, +60 s beim Opfer.'},
      {n:'Seismischer Turm',cost:'500k Energie',eff:'Schaden im Umkreis · 60 Einheiten schwer verwundet alle 3s'},
      {n:'Feldlazarett',cost:'500k Energie',eff:'Heilt 150 verwundete Einheiten alle 3s'},
    ],
    tips:[
      'Energieturm ab Sekunde 1 halten — nur damit aktiviert ihr den Schutzschild der Zentrumszone.',
      'Vollstrecker-Fenster für die Freigabe des Hochsicherheitslabors aufsparen. In Ballungen springen, nie auf Einzelziele.',
      'Vollstrecker NICHT während des Kampfes umbesetzen — die Fähigkeit wird dabei zurückgesetzt.',
    ]},
  morgen:{label:'Morgenbringer',color:'#2980b9',bg:'#eaf3fb',setup:'2 Allianzen — zahlenmäßig überlegen, einzeln schwächer',
    spawn:'Spawns im Südwesten und Südosten',
    skills:[
      {n:'Artillerieturm',cost:'Fraktions-exklusiv',eff:'Zielt auf die nächstgelegene Feindbasis · 60 Einheiten schwer verwundet alle 2s'},
      {n:'Feldlazarett',cost:'500k Energie',eff:'Heilt 150 verwundete Einheiten alle 3s'},
    ],
    tips:[
      'Nie klumpen: der Vollstrecker trifft Nachbarbasen beim Teleport. Verteilt stehen halbiert den Schaden.',
      'Die vier Probenlager liegen an eurem Spawn. Je ein Mann reicht — 27.000 Punkte pro Kopf, der beste Wert im Event.',
      'Verteidigungssysteme ab 8:00 mit Priorität nehmen — sie greifen die gegnerische Labor-Garnison automatisch an.',
    ]},
};
export const CS_ENERGY='Energie sammelt ihr durch: Gegner besiegen · Einheiten heilen · Kraftwerk halten · Basis-Haltbarkeit zerstören · Versorgungskisten einsammeln · Garnisonieren.';
// Fraktionsunabhängiger Text für Chat/Mail im Spiel. Bewusst kurz — im Spiel
// gilt ein Limit von 500 Zeichen. Über die Oberfläche änderbar (APP.csMsg).
// Anrede und Unterschrift kommen aus der aktuellen Allianz und vom Angemeldeten —
// fest verdrahtet grüßte der Text sonst in XP33 die AR1S.
export const csMsgDefault=()=>`Hi ${currentAlliance()?.tag||'zusammen'},

Punkte gibt es nur für gehaltene Gebäude.
Viruslabor 120/s (ab 12:00) > Kraftturm 50/s > Rest.

Team A und B spielen gleichzeitig – der Chat ist nie eindeutig. Entscheidet selbst, schaut auf die Karte.

Zuteilung = Richtwert. Kein Gegner bei euch? Helft, wo gekämpft wird. Nie ein Gebäude leer lassen.

Stehlen nur, wenn bei euch nichts zu holen ist. Fällt eures: sofort Kisten sammeln.

Letzte 3 Min nur halten.

${APP.user?.playerName||''}`;
export const CS_MSG_MAX=500;
// Wie beim Wüstensturm: der lokale Puffer trägt die Allianz im Schlüssel.
export const CS_LS_BASE='warsync_cs_state';
export const CS_LS_KEY=()=>lsKey(CS_LS_BASE);

// ── Startzeiten ───────────────────────────────────────────────────────────────
// Der Schluchtsturm läuft zu einer von zwei europäischen Zeiten, und die beiden
// Teams können unterschiedlich einsortiert sein. Deshalb wird die Zeit je Team
// gewählt, nicht einmal fürs Event.
export const CS_ZEITEN=['16:00','03:00'];
export const CS_ZEIT_STD='16:00';
export function csZeit(t){
  const z=APP.csTime&&APP.csTime[t||APP.csTeam];
  return CS_ZEITEN.includes(z)?z:CS_ZEIT_STD;
}
export function csSetZeit(t,z){
  if(!CS_ZEITEN.includes(z))return;
  if(!APP.csTime)APP.csTime={A:CS_ZEIT_STD,B:CS_ZEIT_STD};
  if(csZeit(t)===z)return;
  APP.csTime[t]=z;
  csSaveState();renderPage();
}
// `hinweis=false` für den zweiten Umschalter, wenn beide untereinander stehen —
// derselbe Satz zweimal liest sich wie ein Fehler.
export function csZeitPicker(t,hinweis){
  const cur=csZeit(t);
  return`<div class="card" style="margin-bottom:10px">
    <div class="cb" style="padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Startzeit Team ${t}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${CS_ZEITEN.map(z=>`<button class="btn btn-sm ${z===cur?'btn-sol':'btn-out'}" style="flex:1;min-width:110px;font-size:11px" onclick="csSetZeit('${t}','${z}')">
          ${z} EU<div style="font-size:10px;font-weight:600;opacity:.75">${serverZeit(z)} Server</div></button>`).join('')}
      </div>
      ${hinweis===false?'':`<div style="font-size:11px;color:var(--tx3);margin-top:7px">Team A und Team B können zur gleichen oder zu unterschiedlichen Zeiten spielen.</div>`}
    </div>
  </div>`;
}

// ── Ersatzspieler ─────────────────────────────────────────────────────────────
// Wie im Wüstensturm: 20 gemeldete Spieler je Team plus bis zu 10 Ersatzspieler.
// Die Kodierung in APP.csTeamAssign ist dieselbe ('A'/'B' gesetzt, 'AE'/'BE'
// Ersatz), deshalb werden die Helfer des Wüstensturms mitbenutzt statt kopiert —
// so kann csImportFromWS die Einteilung auch unverändert übernehmen.
export const CS_MAX_GESETZT=20, CS_MAX_ERSATZ=10;
export const csTeamOf=wsTeamOf, csIstErsatz=wsIstErsatz;
export function csZaehle(team,ersatz){
  return Object.values(APP.csTeamAssign||{}).filter(v=>csTeamOf(v)===team&&csIstErsatz(v)===!!ersatz).length;
}
export function csNamen(team,ersatz){
  return Object.entries(APP.csTeamAssign||{})
    .filter(([,v])=>csTeamOf(v)===team&&(ersatz===undefined||csIstErsatz(v)===!!ersatz))
    .map(([n])=>n);
}

export function csTotal(b){const m=CS_BLD[b];return m?m.pts*(CS_DUR-m.from):0;}
// Startgebäude = wo jemand um 0:00 steht · späte Gebäude = wie viele dorthin WECHSELN.
// Die Vorgabe hängt an der FRAKTION, weil die Karte asymmetrisch ist:
// Datenzentren liegen am Ordnungshüter-Spawn, Probenlager am Morgenbringer-Spawn.
export function csDefaultSlots(f){
  if(f==='ordnung')
    // Norden und Mitte halten. Probenlager liegen im gegnerischen Rücken → gar nicht erst hin.
    return{v:4,ass:5,kraftturm:5,dc_w:5,dc_o:5,lager1:0,lager2:0,lager3:0,lager4:0,
           serum_nw:1,serum_so:1,def_no:2,def_sw:2};
  // Morgenbringer: Süden sichern (je 1 Mann pro Probenlager = bester Wert pro Kopf),
  // Druck auf den Energieturm, Datenzentren streitig machen.
  return{v:4,ass:5,kraftturm:3,dc_w:4,dc_o:4,lager1:1,lager2:1,lager3:1,lager4:1,
         serum_nw:1,serum_so:1,def_no:2,def_sw:2};
}
// null = Standardtext verwenden. Sobald geändert, liegt der eigene Text in APP.csMsg.
export function csGetMsg(){return APP.csMsg===null||APP.csMsg===undefined?csMsgDefault():APP.csMsg;}
export function csMsgInput(el){
  APP.csMsg=el.value;
  csSaveState();
  const c=document.getElementById('cs-msg-count');
  if(c){
    const n=el.value.length;
    c.textContent=n+' / '+CS_MSG_MAX;
    c.style.color=n>CS_MSG_MAX?'var(--loss)':n>CS_MSG_MAX-40?'var(--acc)':'var(--tx3)';
    c.style.fontWeight=n>CS_MSG_MAX?'800':'600';
  }
}
export function csResetMsg(){
  if(!confirm('Text auf die Standardfassung zurücksetzen?\nDeine Änderungen gehen dabei verloren.'))return;
  APP.csMsg=null;csSaveState();renderPage();
}
export function csGetPlan(t){
  const k=(t||APP.csTeam)==='B'?'csPlanB':'csPlanA';
  if(!APP[k])APP[k]={};
  return APP[k];
}
export function csSetPlan(t,v){if(t==='B')APP.csPlanB=v;else APP.csPlanA=v;}
export function csGetSlots(t){
  t=t||APP.csTeam;
  const k=t==='B'?'csSlotsB':'csSlotsA';
  // v!==4 → altes Format oder andere Fraktion → Vorgaben der aktuellen Fraktion nehmen
  if(!APP[k]||APP[k].v!==4||APP[k].f!==csFaction(t))APP[k]={...csDefaultSlots(csFaction(t)),f:csFaction(t)};
  return APP[k];
}
export function csGetReady(t){return t==='B'?APP.csReadyB:APP.csReadyA;}
export function csSetReady(t,v){if(t==='B')APP.csReadyB=v;else APP.csReadyA=v;}
export function csFaction(t){return APP.csFaction[t||APP.csTeam]||'morgen';}
export function _csQ(n){return String(n).replace(/'/g,"\\'");}
// Pool eines Teams: gesetzte und Ersatzspieler zusammen. Der Ersatz steht ganz
// normal in der Aufstellung — nur rutscht er in der Reihenfolge hinter die
// Gesetzten, damit die Auto-Verteilung ihm keine Schlüsselrolle (Assassine,
// Energieturm) vor der Nase eines gemeldeten Spielers gibt.
export function csPool(t){
  const seen=new Set();
  return csNamen(t)
    .filter(n=>!isInactive(n))
    .filter(n=>{if(!n||seen.has(n))return false;seen.add(n);return true;})
    .sort(csPoolSort);
}
export function csPoolSort(a,b){
  const ea=csIstErsatz(APP.csTeamAssign&&APP.csTeamAssign[a])?1:0;
  const eb=csIstErsatz(APP.csTeamAssign&&APP.csTeamAssign[b])?1:0;
  return ea!==eb?ea-eb:csPower(b)-csPower(a);
}
export function csIsAss(t,n){const p=csGetPlan(t)[n];return!!(p&&!p.s&&p.d==='viruslab');}
export function csAssassinen(t){return csPool(t).filter(n=>csIsAss(t,n));}
// Wer steht ab 0:00 an diesem Startgebäude (inkl. der Spieler, die später weg wechseln)
export function csAtStart(t,b){const P=csGetPlan(t);return csPool(t).filter(n=>P[n]&&P[n].s===b);}
// Wer wechselt in dieses spät freigegebene Gebäude
export function csAtDest(t,b){const P=csGetPlan(t);return csPool(t).filter(n=>P[n]&&P[n].d===b);}
export function csMoves(t){
  const P=csGetPlan(t);
  return csPool(t).filter(n=>P[n]&&P[n].d&&P[n].d!=='viruslab'&&P[n].s)
    .map(n=>({n,from:P[n].s,to:P[n].d}));
}
export function csUnassigned(t){const P=csGetPlan(t);return csPool(t).filter(n=>!P[n]||(!P[n].s&&!P[n].d));}

// ── Auto-Verteilung ──
export function csAutoAssign(){
  const t=APP.csTeam, pool=csPool(t), slots=csGetSlots(t);
  if(!pool.length){alert('Für Team '+t+' ist noch niemand zugeordnet.\nErst im Tab „Anmeldung" Spieler auf Team A/B verteilen.');return;}
  const plan={};
  // 1) Stärkste werden Assassinen — kein Startgebäude, Ziel Viruslabor
  const assN=Math.min(CS_MAXCAP,slots.ass||0,pool.length);
  pool.slice(0,assN).forEach(n=>plan[n]={s:null,d:'viruslab'});
  // 2) Rest auf die Startgebäude verteilen (stärkster zuerst in das wichtigste)
  const rest=pool.slice(assN);
  const open=[];
  for(const b of CS_START_BLD){const cap=Math.min(CS_MAXCAP,slots[b]||0);for(let i=0;i<cap;i++)open.push(b);}
  rest.forEach((n,i)=>{plan[n]={s:open[i]||null,d:null};});
  // 3) Wechsler für die späten Gebäude ziehen — nie das letzte aus einem Startgebäude
  // Wechsler ziehen. Entfernung spielt keine Rolle — im Spiel wird geportet.
  // Quelle: Gebäude mit den meisten verbleibenden Spielern (verteilt die Abgaben
  // gleichmäßig), bei Gleichstand das unwichtigere. Der Kraftturm gibt nur ab,
  // wenn es sonst keine Quelle gibt. Nie wird der letzte Spieler abgezogen.
  const bleibt=b=>rest.filter(n=>plan[n].s===b&&!plan[n].d).length;
  const rang=b=>CS_START_BLD.indexOf(b);
  for(const lb of CS_LATE_BLD){
    const need=Math.min(CS_MAXCAP,slots[lb]||0);
    for(let k=0;k<need;k++){
      let quellen=CS_START_BLD.filter(b=>bleibt(b)>1);
      const ohneTurm=quellen.filter(b=>b!=='kraftturm');   // Energieturm gibt niemanden ab
      if(ohneTurm.length)quellen=ohneTurm;
      const src=quellen.sort((a,b)=>bleibt(b)-bleibt(a)||rang(b)-rang(a))[0];
      if(!src)break;
      const cand=rest.find(n=>plan[n].s===src&&!plan[n].d);  // stärkster dort
      if(!cand)break;
      plan[cand].d=lb;
    }
  }
  // Innerhalb einer Zeitwelle die Ziele so tauschen, dass sich die Pfeile im Bild
  // nicht kreuzen. Spielerisch irrelevant (es wird geportet), macht das
  // Übersichtsbild aber deutlich leichter lesbar.
  const wellen={};
  CS_LATE_BLD.forEach(b=>{(wellen[CS_BLD[b].from]=wellen[CS_BLD[b].from]||[]).push(b);});
  Object.values(wellen).forEach(ziele=>{
    const mover=rest.filter(n=>plan[n].d&&ziele.includes(plan[n].d));
    if(mover.length<2)return;
    const zielSlots=mover.map(n=>plan[n].d).sort((a,b)=>CS_ANCHOR[a].x-CS_ANCHOR[b].x);
    mover.slice().sort((a,b)=>CS_ANCHOR[plan[a].s].x-CS_ANCHOR[plan[b].s].x)
      .forEach((n,i)=>{plan[n].d=zielSlots[i];});
  });
  csSetPlan(t,plan);csSetReady(t,true);
  APP.csSel=null;csSaveState();renderPage();
}
export function csResetLineup(){
  const t=APP.csTeam;
  csSetPlan(t,{});csSetReady(t,false);
  APP.csSel=null;csSaveState();renderPage();
}
// Wochen-Reset: räumt die Team-Einteilung UND beide Aufstellungen.
// Die Aufstellungen müssen mit weg — sie hängen an der Team-Einteilung, und
// ohne sie zeigt csPool() niemanden mehr an, während die Zuweisungen im
// gespeicherten Plan als unsichtbare Karteileichen weiterlaufen.
// Bewusst unberührt: Fraktion, Partnerallianz und der Allianz-Text. Die
// setzt du je Woche selbst, und der Text ist von Hand geschrieben.
export function csResetWoche(){
  const belegt=Object.values(APP.csTeamAssign).filter(v=>csTeamOf(v)).length;
  const plaene=Object.keys(APP.csPlanA||{}).length+Object.keys(APP.csPlanB||{}).length;
  if(!confirm('Schluchtsturm für die neue Woche zurücksetzen?\n\n'
    +'· Team-Einteilung ('+belegt+' Spieler) wird geleert\n'
    +'· Aufstellungen beider Teams ('+plaene+' Zuweisungen) werden verworfen\n\n'
    +'Fraktion, Startzeiten, Partnerallianz und Allianz-Text bleiben erhalten.'))return;
  APP.csTeamAssign={};
  APP.csPlanA={};APP.csPlanB={};
  APP.csReadyA=false;APP.csReadyB=false;
  APP.csSel=null;
  csSaveState();renderPage();
}

// ── Interaktion ──
export function csSetTeam(t){APP.csTeam=t;APP.csSel=null;renderPage();}
export function csSetView(v){APP.csView=v;APP.csSel=null;renderPage();}
export function csSetFaction(t,f){
  if(APP.csFaction[t]===f)return;
  const hatPlan=Object.keys(csGetPlan(t)).length>0;
  if(hatPlan&&!confirm(`Fraktion für Team ${t} auf ${CS_FACTIONS[f].label} umstellen?\n\nDie Aufstellung wird verworfen — die Vorgaben unterscheiden sich stark:\nOrdnungshüter halten Norden und Mitte, Morgenbringer sichern die Probenlager im Süden.\n\nDie Team-Einteilung bleibt unberührt.`))return;
  APP.csFaction[t]=f;
  csSetPlan(t,{});csSetReady(t,false);
  if(t==='B')APP.csSlotsB=null;else APP.csSlotsA=null;   // Vorgaben der neuen Fraktion ziehen
  csSaveState();renderPage();
}
export function csSelectChip(name){APP.csSel=APP.csSel===name?null:name;renderPage();}
export function csAssign(name,slot){
  const t=APP.csTeam, P=csGetPlan(t);
  if(!P[name])P[name]={s:null,d:null};
  if(slot==='ass'){P[name]={s:null,d:'viruslab'};}
  else if(CS_START_BLD.includes(slot)){P[name].s=slot;if(P[name].d==='viruslab')P[name].d=null;}
  else if(CS_LATE_BLD.includes(slot)){
    if(P[name].d==='viruslab')P[name].d=null;
    P[name].d=slot;
    // Ohne Startgebäude ergibt ein Wechsel keinen Sinn → erstes freies Startgebäude nehmen
    if(!P[name].s)P[name].s=CS_START_BLD.find(b=>csAtStart(t,b).length<CS_MAXCAP)||'kraftturm';
  }
  csSetPlan(t,P);csSetReady(t,true);
  APP.csSel=null;csSaveState();renderPage();
}
export function csClearMove(name){
  const t=APP.csTeam,P=csGetPlan(t);
  if(P[name]&&P[name].d&&P[name].d!=='viruslab')P[name].d=null;
  csSetPlan(t,P);csSaveState();renderPage();
}
export function csMoveTo(slot){if(APP.csSel)csAssign(APP.csSel,slot);}
export function csDragStart(e,name){APP.csSel=name;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',name);}
export function csDrop(e,slot){
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.cs-bld').forEach(el=>el.classList.remove('drop-target'));
  if(APP.csSel)csAssign(APP.csSel,slot);
}
export function csChangeSlot(slot,d){
  const slots=csGetSlots(APP.csTeam);
  slots[slot]=Math.max(0,Math.min(CS_MAXCAP,(slots[slot]||0)+d));
  csSaveState();renderPage();
}
// `slot` ist 'A' | 'AE' | 'B' | 'BE' | null. Ein zweiter Klick auf denselben
// Knopf nimmt die Zuordnung zurück — sonst müsste man für jede Korrektur erst ✕
// treffen, was auf dem Handy fummelig ist.
export function csSetTeamAssign(name,slot){
  if(slot&&APP.csTeamAssign[name]===slot)slot=null;
  if(slot){
    const team=csTeamOf(slot),ersatz=csIstErsatz(slot);
    // Grenzen des Spiels: 20 gemeldete Spieler und 10 Ersatzspieler je Team.
    const belegt=csZaehle(team,ersatz);
    const max=ersatz?CS_MAX_ERSATZ:CS_MAX_GESETZT;
    if(belegt>=max){
      alert((ersatz?'Ersatzbank':'Team')+' '+team+' ist voll.\n\n'
        +max+' '+(ersatz?'Ersatzspieler':'Spieler')+' sind das Maximum. '
        +'Erst jemanden herausnehmen, dann neu zuordnen.');
      return;
    }
    APP.csTeamAssign[name]=slot;
  }else delete APP.csTeamAssign[name];
  csSaveState();renderPage();
}
// Übernimmt die im Wüstensturm gepflegte Einteilung in den Schluchtsturm.
// modus 'kopieren'    → Wüstensturm behält seine Einteilung
// modus 'verschieben' → Wüstensturm-Einteilung wird danach geleert
export function csImportFromWS(modus){
  const ws=Object.entries(APP.teamAssign).filter(([,v])=>wsTeamOf(v));
  if(!ws.length){alert('Im Wüstensturm ist aktuell keine Team-Einteilung hinterlegt.');return;}
  const vorhanden=Object.values(APP.csTeamAssign).filter(v=>csTeamOf(v)).length;
  let txt=`${ws.length} Spieler aus der Wüstensturm-Einteilung in den Schluchtsturm übernehmen?`;
  if(vorhanden)txt+=`\n\nACHTUNG: Die bestehende Schluchtsturm-Einteilung (${vorhanden} Spieler) wird dabei überschrieben.`;
  if(modus==='verschieben')txt+='\n\nDie Wüstensturm-Einteilung wird anschliessend geleert.';
  if(!confirm(txt))return;
  APP.csTeamAssign={};
  // Beide Events kennen dieselbe Einteilung inklusive Ersatzbank, deshalb wird
  // der Wert unverändert übernommen — auch 'AE'/'BE'.
  ws.forEach(([n,v])=>{APP.csTeamAssign[n]=v;});
  csSaveState();
  if(modus==='verschieben'){
    APP.teamAssign={};
    saveWSState();
  }
  renderPage();
}

// ── Persistenz ──
// csTeamAssign ist die von Hand gepflegte Team-A/B-Einteilung. Der Schlüssel darf nicht
// umbenannt werden und wird beim Laden zusammengeführt — eine bestehende Einteilung
// überlebt damit jedes App-Update.
export function csSaveState(){
  const payload={
    savedAt:new Date().toISOString(),
    csTeamAssign:APP.csTeamAssign,
    csPlanA:APP.csPlanA,csPlanB:APP.csPlanB,
    csSlotsA:APP.csSlotsA,csSlotsB:APP.csSlotsB,
    csReadyA:APP.csReadyA,csReadyB:APP.csReadyB,
    csFaction:APP.csFaction,csPartner:APP.csPartner,csInfoOpen:APP.csInfoOpen,
    csTime:APP.csTime,
    csMsg:APP.csMsg,
    csStrength:APP.csStrength,
  };
  try{localStorage.setItem(CS_LS_KEY(),JSON.stringify(payload));}catch(e){}
  plannerPush('cs',payload);
}
export function csLoadState(){
  try{
    const s=plannerResolve('cs',CS_LS_KEY());if(!s)return;
    if(s.csTeamAssign&&typeof s.csTeamAssign==='object')APP.csTeamAssign={...APP.csTeamAssign,...s.csTeamAssign};
    const okPlan=p=>p&&typeof p==='object'&&Object.values(p).every(v=>v&&typeof v==='object'&&('s'in v)&&('d'in v));
    if(okPlan(s.csPlanA))APP.csPlanA=s.csPlanA;
    if(okPlan(s.csPlanB))APP.csPlanB=s.csPlanB;
    if(s.csSlotsA&&s.csSlotsA.v===4)APP.csSlotsA=s.csSlotsA;
    if(s.csSlotsB&&s.csSlotsB.v===4)APP.csSlotsB=s.csSlotsB;
    if(s.csReadyA!==undefined)APP.csReadyA=s.csReadyA;
    if(s.csReadyB!==undefined)APP.csReadyB=s.csReadyB;
    if(s.csFaction)APP.csFaction={...APP.csFaction,...s.csFaction};
    // Nur bekannte Zeiten übernehmen — ein alter Stand darf keine Uhrzeit
    // hinterlassen, für die es keinen Knopf mehr gibt.
    if(s.csTime&&typeof s.csTime==='object')['A','B'].forEach(t=>{if(CS_ZEITEN.includes(s.csTime[t]))APP.csTime[t]=s.csTime[t];});
    if(s.csPartner)APP.csPartner=s.csPartner;
    if(typeof s.csMsg==='string')APP.csMsg=s.csMsg;
    if(s.csInfoOpen!==undefined)APP.csInfoOpen=s.csInfoOpen;
    if(s.csStrength==='hero'||s.csStrength==='t1')APP.csStrength=s.csStrength;
  }catch(e){}
}

// ── Seite ──
export function pageCS(){
  const v=APP.csView;
  return`
    <div class="stabs">
      <button class="stab${v==='anmeldung'?' on':''}" onclick="csSetView('anmeldung')">Anmeldung</button>
      <button class="stab${v==='aufstellung'?' on':''}" onclick="csSetView('aufstellung')">Aufstellung</button>
      <button class="stab${v==='fraktion'?' on':''}" onclick="csSetView('fraktion')">Fraktion &amp; Skills</button>
      <button class="stab${v==='mail'?' on':''}" onclick="csSetView('mail')">Mail</button>
    </div>
    ${v==='anmeldung'?csAnmeldung():v==='fraktion'?csFraktionView():v==='mail'?csMailExport():csAufstellung()}`;
}
export function csTeamTabs(){
  return`<div class="ttabs">
    <button class="ttab${APP.csTeam==='A'?' on-a':''}" onclick="csSetTeam('A')">⚔ Team A · ${csZeit('A')}</button>
    <button class="ttab${APP.csTeam==='B'?' on-b':''}" onclick="csSetTeam('B')">⚔ Team B · ${csZeit('B')}</button>
  </div>`;
}

// ── Tab: Anmeldung ──
export function csAnmeldung(){
  const players=APP.data.players.filter(p=>!isInactive(p.name)).sort(byRankThenHero);
  const grp=(team,ersatz)=>players.filter(p=>{
    const v=APP.csTeamAssign[p.name];
    return csTeamOf(v)===team&&csIstErsatz(v)===ersatz;
  });
  const la=grp('A',false),lae=grp('A',true),lb=grp('B',false),lbe=grp('B',true);
  const ln=players.filter(p=>!csTeamOf(APP.csTeamAssign[p.name]));
  const ta=la.length,tae=lae.length,tb=lb.length,tbe=lbe.length;
  function row(p){
    const slot=APP.csTeamAssign[p.name];
    const rel=reliability(p.name);
    // Je Team zwei Knöpfe: gesetzt und Ersatz. Der Ersatz-Knopf ist gestrichelt
    // und schmaler — dieselbe Unterscheidung wie im Wüstensturm, damit man auf
    // dem Handy nicht danebengreift.
    const knopf=(s,label,farbe,titel)=>{
      const an=slot===s;
      const ers=csIstErsatz(s);
      const voll=!an&&csZaehle(csTeamOf(s),ers)>=(ers?CS_MAX_ERSATZ:CS_MAX_GESETZT);
      return`<button onclick="csSetTeamAssign('${_csQ(p.name)}','${s}')" title="${titel}"
        style="font-size:${ers?'10px':'11px'};padding:3px ${ers?'6px':'9px'};border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;
          border:1.5px ${ers?'dashed':'solid'} ${farbe};background:${an?farbe:'transparent'};color:${an?'#fff':farbe}${voll?';opacity:.4':''}">${label}</button>`;
    };
    return`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bd)">
      ${avatarImg(p.name,26,'border-radius:6px;margin-right:7px','')}<div style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="openPlayer('${_csQ(p.name)}')">${p.name}</div>
      <div style="font-size:10px;color:var(--tx3);white-space:nowrap">${csPower(p.name)?csPower(p.name).toFixed(1)+'M':'–'}</div>
      <div style="font-size:10px;font-weight:700;color:${relColor(rel)};white-space:nowrap;width:34px;text-align:right">${rel!==null?rel+'%':'–'}</div>
      <div style="display:flex;gap:3px;flex-shrink:0">
        ${knopf('A','A','var(--win)','Team A · gesetzt')}${knopf('AE','E','var(--win)','Team A · Ersatzspieler')}
        <span style="width:3px"></span>
        ${knopf('B','B','#2980b9','Team B · gesetzt')}${knopf('BE','E','#2980b9','Team B · Ersatzspieler')}
      </div>
    </div>`;
  }
  const warn=n=>n>CS_MAX_GESETZT?`<span style="color:var(--loss);font-weight:700"> · ${n-CS_MAX_GESETZT} über dem Limit!</span>`:n<CS_MAX_GESETZT?`<span style="color:var(--tx3)"> · noch ${CS_MAX_GESETZT-n} frei</span>`:`<span style="color:var(--win);font-weight:700"> · voll ✓</span>`;
  return`
    <div class="note ok"><strong>Eigene Einteilung, unabhängig vom Wüstensturm.</strong>
      Beide Events überschneiden sich, deshalb hat jedes seine eigene Team-A/B-Liste.
      Diese hier wird getrennt gespeichert — Auto-Verteilen, Reset und App-Updates fassen sie nicht an.
      Für eine neue Woche leerst du sie über „↺ Neue Woche".</div>
    <div class="note info">Team A und Team B spielen in zwei getrennten Schlachten — zur gleichen oder zu unterschiedlichen Zeiten.
      Pro Match sind <strong>${CS_MAX_GESETZT} Spieler</strong> zugelassen, dazu bis zu <strong>${CS_MAX_ERSATZ} Ersatzspieler</strong>.
      Ersatzspieler stehen ganz normal in der Aufstellung — ob sie antreten können, steht aber nicht fest.</div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;background:var(--win-l);border:1.5px solid var(--win);border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:var(--win);text-transform:uppercase;letter-spacing:.04em">Team A · ${zeitLang(csZeit('A'))}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:3px">${ta}/${CS_MAX_GESETZT}${warn(ta)}</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">+${tae}/${CS_MAX_ERSATZ} Ersatz</div>
      </div>
      <div style="flex:1;background:#eaf3fb;border:1.5px solid #2980b9;border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:#2980b9;text-transform:uppercase;letter-spacing:.04em">Team B · ${zeitLang(csZeit('B'))}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:3px">${tb}/${CS_MAX_GESETZT}${warn(tb)}</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">+${tbe}/${CS_MAX_ERSATZ} Ersatz</div>
      </div>
    </div>
    ${csZeitPicker('A')}
    ${csZeitPicker('B',false)}
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn btn-out btn-sm" onclick="csResetWoche()" title="Team-Einteilung und Aufstellungen für die neue Woche löschen">↺ Neue Woche</button>
    </div>
    ${(()=>{
      const wsN=Object.values(APP.teamAssign).filter(v=>wsTeamOf(v)).length;
      const csN=ta+tb;
      if(!wsN)return'';
      const warnen=csN===0;
      return`<div class="card" style="margin-bottom:12px;border:2px solid ${warnen?'var(--loss)':'var(--bd)'}">
        <div class="ch"${warnen?' style="background:var(--loss-l)"':''}>
          <span${warnen?' style="color:var(--loss)"':''}>⇄ Einteilung aus dem Wüstensturm</span>
          <span class="ch-sub">${wsN} Spieler dort eingeteilt</span>
        </div>
        <div class="cb">
          ${warnen?`<div class="note" style="border-left-color:var(--loss);background:var(--loss-l);border-color:#f5b7b1;margin:0 0 10px">
            <strong>Im Schluchtsturm ist noch niemand eingeteilt</strong>, im Wüstensturm dagegen ${wsN} Spieler.
            Falls das in Wirklichkeit eure Schluchtsturm-Einteilung ist: hier herüberholen.
            <br><br><strong>Wichtig:</strong> die Wüstensturm-Einteilung wird automatisch geleert, sobald der
            gespeicherte Freitag vorbei ist. Im Schluchtsturm passiert das nicht.
          </div>`:`<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">
            Beide Events haben eine eigene Einteilung. Hier kannst du die Wüstensturm-Liste als Startpunkt übernehmen.
          </div>`}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-out" onclick="csImportFromWS('kopieren')" style="flex:1;min-width:150px">📋 Kopieren</button>
            <button class="btn ${warnen?'btn-sol':'btn-out'}" onclick="csImportFromWS('verschieben')" style="flex:1;min-width:150px">➡ Verschieben</button>
          </div>
          <div style="font-size:11px;color:var(--tx3);margin-top:8px">
            <strong>Kopieren:</strong> der Wüstensturm behält seine Einteilung ·
            <strong>Verschieben:</strong> der Wüstensturm wird danach geleert
          </div>
        </div>
      </div>`;
    })()}
    <div class="card" style="margin-bottom:12px">
      <div class="ch">👥 Spieler → Team <span class="ch-sub">${ln.length} noch ohne Team</span></div>
      ${(()=>{
        // Gesetzte und Ersatz getrennt auflisten — sonst sieht man nicht auf
        // einen Blick, wer wirklich gemeldet ist.
        const kopf=(txt,farbe,bg,rand)=>`<div style="padding:7px 12px 3px;font-size:11px;font-weight:800;color:${farbe};background:${bg};border-bottom:1px solid ${rand}">── ${txt} ──</div>`;
        const block=(liste,txt,farbe,bg,rand)=>liste.length
          ?kopf(txt,farbe,bg,rand)+`<div style="padding:0 12px">${liste.map(row).join('')}</div>`:'';
        return block(la,`Team A (${ta}/${CS_MAX_GESETZT})`,'var(--win)','#eafaf1','#27ae6022')
          +block(lae,`Ersatz Team A (${tae}/${CS_MAX_ERSATZ})`,'var(--win)','#eafaf180','#27ae6015')
          +block(lb,`Team B (${tb}/${CS_MAX_GESETZT})`,'#2980b9','#eaf3fb','#2980b922')
          +block(lbe,`Ersatz Team B (${tbe}/${CS_MAX_ERSATZ})`,'#2980b9','#eaf3fb80','#2980b915')
          +block(ln,`Noch nicht zugeteilt (${ln.length})`,'var(--tx3)','var(--bg2)','var(--bd)');
      })()}
    </div>`;
}

// ── Tab: Fraktion & Skills ──
export function csFraktionView(){
  const t=APP.csTeam,f=csFaction(t),F=CS_FACTIONS[f];
  const other=f==='ordnung'?CS_FACTIONS.morgen:CS_FACTIONS.ordnung;
  return`
    ${csTeamTabs()}
    <div class="note info">Die Seite wird <strong>pro Match ausgelost</strong> und kann für Team A und Team B unterschiedlich sein.</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${Object.entries(CS_FACTIONS).map(([k,v])=>`
        <button onclick="csSetFaction('${t}','${k}')" style="flex:1;padding:12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
          border:2px solid ${f===k?v.color:'var(--bd)'};background:${f===k?v.bg:'var(--card)'};color:${f===k?v.color:'var(--tx3)'}">
          ${v.label}<div style="font-size:10px;font-weight:500;margin-top:3px">${v.setup}</div>
        </button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:12px;border:2px solid ${F.color}44">
      <div class="ch" style="background:${F.bg}"><span style="color:${F.color}">⚡ Skills — ${F.label}</span><span class="ch-sub">${F.spawn}</span></div>
      <div class="cb">
        ${F.skills.map(s=>`<div style="padding:8px 0;border-bottom:1px solid var(--bd)">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
            <div style="font-size:13px;font-weight:700;color:${F.color}">${s.n}</div>
            <div style="font-size:11px;font-weight:700;color:var(--acc);white-space:nowrap">${s.cost}</div>
          </div>
          <div style="font-size:11px;color:var(--tx2);margin-top:3px">${s.eff}</div>
        </div>`).join('')}
        <div class="note" style="margin:10px 0 0">🔋 ${CS_ENERGY}</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="ch">🎯 Taktik-Hinweise für ${F.label}</div>
      <div class="cb">
        ${F.tips.map((x,i)=>`<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:9px">
          <div style="width:24px;height:24px;border-radius:50%;background:${F.color}22;color:${F.color};font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
          <div style="font-size:12px;color:var(--tx2);line-height:1.45">${x}</div>
        </div>`).join('')}
      </div>
    </div>
    ${f==='morgen'?`<div class="card" style="margin-bottom:12px">
      <div class="ch">🤝 Partnerallianz</div>
      <div class="cb">
        <div style="font-size:12px;color:var(--tx3);margin-bottom:8px">Als Morgenbringer teilt ihr euch die Karte mit einer zweiten Allianz. Name hier eintragen — er landet in der Mail.</div>
        <input type="text" value="${escapeHtml(APP.csPartner)}" placeholder="z. B. Nightfall #2091"
          oninput="APP.csPartner=this.value;csSaveState()"
          style="width:100%;padding:9px 11px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit">
      </div>
    </div>`:''}
    <div class="card" style="margin-bottom:12px">
      <div class="ch">🛡 Gegnerische Skills <span class="ch-sub">${other.label} — damit rechnen</span></div>
      <div class="cb">
        ${other.skills.map(s=>`<div style="font-size:12px;color:var(--tx2);padding:5px 0;border-bottom:1px solid var(--bd)">
          <strong style="color:${other.color}">${s.n}</strong> <span style="color:var(--tx3)">(${s.cost})</span><br>
          <span style="font-size:11px">${s.eff}</span></div>`).join('')}
      </div>
    </div>`;
}

// ── Tab: Aufstellung ──
export function csAufstellung(){
  const t=APP.csTeam,f=csFaction(t),F=CS_FACTIONS[f];
  const pool=csPool(t),P=csGetPlan(t),slots=csGetSlots(t);
  const sel=APP.csSel,unass=csUnassigned(t);
  const V=CS_BLD.viruslab;

  function chip(name,ctx){
    const p=P[name]||{};
    let badge='';
    if(ctx==='start'&&p.d&&p.d!=='viruslab'){
      const c=csTColor(p.d);
      badge=`<button onclick="event.stopPropagation();csClearMove('${_csQ(name)}')" title="Wechsel entfernen"
        style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid ${c}66;background:${c}18;color:${c};font-weight:800;cursor:pointer;white-space:nowrap">→ ${CS_BLD[p.d].short} ${csTLabel(p.d)}</button>`;
    }
    if(ctx==='dest'&&p.s){
      badge=`<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:#7f8c8d18;color:#7f8c8d;font-weight:700;white-space:nowrap">von ${CS_BLD[p.s].short}</span>`;
    }
    // Ersatzspieler stehen normal in der Aufstellung — das Merkzeichen sagt nur,
    // dass ihr Einsatz nicht gesichert ist.
    const eB=csIstErsatz(APP.csTeamAssign[name])
      ?`<span title="Ersatzspieler — Einsatz nicht gesichert" style="font-size:8px;padding:1px 4px;border-radius:3px;border:1px dashed var(--tx3);color:var(--tx3);font-weight:800">E</span>`:'';
    return`<div class="player-chip${sel===name?' selected':''}" draggable="true"
      ondragstart="csDragStart(event,'${_csQ(name)}')"
      onclick="event.stopPropagation();csSelectChip('${_csQ(name)}')"
      style="display:inline-flex;align-items:center;gap:4px">
      ${avatarImg(name,18,'border-radius:4px;margin-right:1px','')}<span onclick="event.stopPropagation();openPlayer('${_csQ(name)}')" style="cursor:pointer">${name}</span>
      <span class="chip-t1">${powerTag(name,APP.csStrength)}</span>${eB}${badge}
    </div>`;
  }
  function box(b,ctx){
    const m=CS_BLD[b];
    const cap=Math.min(CS_MAXCAP,slots[b]||0);
    const inside=ctx==='dest'?csAtDest(t,b):csAtStart(t,b);
    const over=inside.length>CS_MAXCAP;
    const bleiben=ctx==='start'?inside.filter(n=>!(P[n]&&P[n].d&&P[n].d!=='viruslab')).length:inside.length;
    return`<div class="cs-bld" data-bld="${b}"
      ondragover="event.preventDefault();this.classList.add('drop-target')"
      ondragleave="this.classList.remove('drop-target')"
      ondrop="csDrop(event,'${b}')" onclick="csMoveTo('${b}')"
      style="padding:8px 9px;border:1.5px ${sel?'solid':'dashed'} ${m.color}66;border-radius:8px;background:${m.color}0d;cursor:${sel?'pointer':'default'};margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:5px">
        <span style="font-size:11px;font-weight:700;color:${m.color}">${m.dot} ${m.label}</span>
        <span style="font-size:10px;color:${over?'var(--loss)':'var(--tx3)'};font-weight:${over?'800':'500'};white-space:nowrap">${inside.length}/${cap}</span>
      </div>
      <div style="font-size:9px;color:var(--tx3);margin-bottom:5px">${m.pts}/s · gesamt ${fmt(csTotal(b))} Pkt${ctx==='start'&&bleiben!==inside.length?` · ab 12:00 noch ${bleiben}`:''}</div>
      ${inside.length?inside.map(n=>chip(n,ctx)).join(''):'<div style="font-size:10px;color:var(--tx3);font-style:italic;text-align:center;padding:4px 0">leer</div>'}
      ${over?`<div style="font-size:9px;color:var(--loss);font-weight:700;text-align:center;margin-top:3px">⚠ über dem Spiel-Limit von 5</div>`:''}
    </div>`;
  }
  const ass=csAssassinen(t);
  const moves=csMoves(t);
  const placed=pool.filter(n=>P[n]&&(P[n].s||P[n].d)).length;
  const ersatzN=pool.filter(n=>csIstErsatz(APP.csTeamAssign[n])).length;

  return`
    ${csTeamTabs()}
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;background:${t==='A'?'var(--win-l)':'#eaf3fb'};border:1.5px solid ${t==='A'?'var(--win)':'#2980b9'};border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:${t==='A'?'var(--win)':'#2980b9'};text-transform:uppercase;letter-spacing:.04em">Team ${t} · ${zeitLang(csZeit(t))}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:3px">${pool.length} zugeordnet${ersatzN?' (davon '+ersatzN+' Ersatz)':''} · ${placed} eingeplant · ${moves.length} Wechsel</div>
      </div>
      <div style="flex:0 0 auto;background:${F.bg};border:1.5px solid ${F.color};border-radius:10px;padding:10px 12px;cursor:pointer" onclick="csSetView('fraktion')">
        <div style="font-size:10px;font-weight:700;color:${F.color};text-transform:uppercase;letter-spacing:.04em">Fraktion</div>
        <div style="font-size:13px;font-weight:800;color:${F.color};margin-top:2px">${F.label}</div>
      </div>
    </div>

    ${csZeitPicker(t)}

    <!-- AUTO-VERTEILEN + KARTE — die zwei Kernaktionen, immer sichtbar -->
    ${strengthPicker(APP.csStrength,'setCsStrength')}
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-sol" onclick="csAutoAssign()" style="flex:1">⚡ Auto-Verteilen Team ${t}</button>
      <button class="btn btn-out" onclick="csResetLineup()" style="flex:0;white-space:nowrap">↺ Reset</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="note info" style="flex:1;text-align:center;cursor:pointer;margin:0;background:#f5f0ff;color:var(--ass);border-color:var(--ass)44" onclick="showCSMap()">🗺 Übersichtsbild · PNG</div>
    </div>

    <!-- ERWEITERT — manuelle Feinjustierung & Einstellungen, zweitrangig, eingeklappt -->
    <div class="card" style="margin-bottom:12px">
      <div class="ch" style="cursor:pointer" onclick="APP.csAdvOpen=!APP.csAdvOpen;renderPage()">
        <span>⚙ Erweitert · manuelle Aufstellung &amp; Einstellungen</span>
        <span style="font-size:16px">${APP.csAdvOpen?'▲':'▼'}</span>
      </div>
    </div>
    ${APP.csAdvOpen?`
    ${sel?`<div class="move-hint">„${sel}" ausgewählt — Gebäude antippen zum Zuweisen</div>`:''}

    ${unass.length?`<div class="card" style="margin-bottom:12px;border:2px solid var(--acc)">
      <div class="ch">🎒 Ohne Zuweisung <span class="ch-sub">${unass.length} Spieler</span></div>
      <div style="padding:8px 10px">${unass.map(n=>chip(n,'start')).join('')}</div>
    </div>`:''}

    <!-- ASSASSINEN -->
    <div class="zc ass" style="grid-column:1/-1;margin-bottom:12px;border:2px solid var(--ass)">
      <div class="zc-hd">
        <div><div class="zc-name" style="color:var(--ass)">⚔ Assassinen — kein festes Startgebäude</div>
        <div class="zc-pts">Stärkste Spieler · ab 12:00 geschlossen ins Viruslabor</div></div>
        <div class="zc-count" style="background:var(--ass)22;color:var(--ass)">${ass.length}/${Math.min(CS_MAXCAP,slots.ass||0)}</div>
      </div>
      <div class="cs-bld" data-bld="ass"
        ondragover="event.preventDefault();this.classList.add('drop-target')"
        ondragleave="this.classList.remove('drop-target')"
        ondrop="csDrop(event,'ass')" onclick="csMoveTo('ass')"
        style="padding:8px 9px;border:1.5px ${sel?'solid':'dashed'} ${V.color}66;border-radius:8px;background:${V.color}0d;cursor:${sel?'pointer':'default'}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:5px">
          <span style="font-size:11px;font-weight:700;color:${V.color}">${V.dot} Ziel ab 12:00 · ${V.label}</span>
          <span style="font-size:10px;color:var(--tx3)">${V.pts}/s</span>
        </div>
        ${ass.length?ass.map(n=>chip(n,'ass')).join(''):'<div style="font-size:10px;color:var(--tx3);font-style:italic;text-align:center;padding:4px 0">leer</div>'}
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--tx2);line-height:1.5">
        <strong style="color:var(--ass)">Auftrag:</strong> sie stehen nirgends fest. Bis 12:00 sichern sie flexibel die
        Gebäude, die gerade unter Druck stehen — <strong>ab 12:00 alle geschlossen ins Viruslabor</strong> und bis zum Ende halten.
      </div>
    </div>

    <!-- STARTGEBÄUDE -->
    <div class="zc oil" style="grid-column:1/-1;margin-bottom:10px">
      <div class="zc-hd">
        <div><div class="zc-name">🚩 Startaufstellung · ab 0:00</div>
        <div class="zc-pts">Diese 7 Gebäude sind von Beginn an offen</div></div>
        <div class="zc-count" style="background:rgba(0,0,0,.06)">${CS_START_BLD.reduce((s,b)=>s+csAtStart(t,b).length,0)}</div>
      </div>
      ${CS_START_BLD.map(b=>box(b,'start')).join('')}
    </div>

    <!-- WECHSEL -->
    <div class="zc med" style="grid-column:1/-1;margin-bottom:10px">
      <div class="zc-hd">
        <div><div class="zc-name">🔄 Wechsel bei Freischaltung</div>
        <div class="zc-pts">Serumfabriken ab 5:00 · Verteidigungssysteme ab 8:00</div></div>
        <div class="zc-count" style="background:rgba(0,0,0,.06)">${moves.length}</div>
      </div>
      <div class="note info" style="margin:0 0 8px;font-size:11px">
        Hierhin wird <strong>nur aus einem Startgebäude</strong> gewechselt. Wer hier steht, zieht zur genannten Minute um —
        sein Startgebäude zeigt den Wechsel als Badge.
      </div>
      ${CS_LATE_BLD.map(b=>box(b,'dest')).join('')}
    </div>

    <!-- SLOTS -->
    <div class="card" style="margin-bottom:12px">
      <div class="ch">Spieler-Slots <span class="ch-sub">Team ${t} · max. ${CS_MAXCAP} pro Gebäude</span></div>
      <div class="cb">
        <div class="slot-row" style="padding-left:4px">
          <div class="slot-label" style="color:var(--ass);font-weight:700;font-size:12px">⚔ Assassinen</div>
          <div class="slot-btns">
            <button class="slot-btn" onclick="csChangeSlot('ass',-1)">−</button>
            <div class="slot-num">${Math.min(CS_MAXCAP,slots.ass||0)}</div>
            <button class="slot-btn" onclick="csChangeSlot('ass',1)">+</button>
          </div>
        </div>
        <div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px">Startgebäude</div>
        ${CS_START_BLD.map(b=>{const m=CS_BLD[b];return`<div class="slot-row" style="padding-left:4px">
          <div class="slot-label" style="color:${m.color};font-weight:600;font-size:12px">${m.dot} ${m.label}</div>
          <div class="slot-btns">
            <button class="slot-btn" onclick="csChangeSlot('${b}',-1)">−</button>
            <div class="slot-num">${Math.min(CS_MAXCAP,slots[b]||0)}</div>
            <button class="slot-btn" onclick="csChangeSlot('${b}',1)">+</button>
          </div></div>`;}).join('')}
        <div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px">Wechsel dorthin</div>
        ${CS_LATE_BLD.map(b=>{const m=CS_BLD[b];return`<div class="slot-row" style="padding-left:4px">
          <div class="slot-label" style="color:${m.color};font-weight:600;font-size:12px">${m.dot} ${m.label} <span style="color:var(--tx3);font-weight:500">ab ${csTLabel(b)}</span></div>
          <div class="slot-btns">
            <button class="slot-btn" onclick="csChangeSlot('${b}',-1)">−</button>
            <div class="slot-num">${Math.min(CS_MAXCAP,slots[b]||0)}</div>
            <button class="slot-btn" onclick="csChangeSlot('${b}',1)">+</button>
          </div></div>`;}).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="ch">⏱ Ablauf</div>
      <div class="cb">
        ${CS_PHASES.map(p=>`<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px">
          <div style="min-width:44px;font-size:12px;font-weight:800;color:var(--primary)">${p.t}</div>
          <div style="font-size:11px;color:var(--tx2);line-height:1.45">${p.desc}</div>
        </div>`).join('')}
      </div>
    </div>

    ${csBuildingInfoCard()}

    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div class="note info" style="flex:1;text-align:center;cursor:pointer;margin:0" onclick="csSetView('mail')">✉ Mail-Export</div>
    </div>
    `:''}`;
}

export function csBuildingInfoCard(){
  const open=APP.csInfoOpen;
  const rows=CS_ALL_BLD.map(b=>{
    const m=CS_BLD[b];
    return`<tr>
      <td style="white-space:nowrap;font-weight:600;color:${m.color}">${m.dot} ${m.label}</td>
      <td style="white-space:nowrap;font-weight:700;color:var(--win)">${m.pts}/s</td>
      <td style="white-space:nowrap">${m.from?Math.floor(m.from/60)+':00':'Start'}</td>
      <td style="white-space:nowrap;font-weight:600">${fmt(csTotal(b))}</td>
      <td style="font-size:10px;color:var(--tx2)">${m.eff}</td>
    </tr>`;
  }).join('');
  const poolPts=CS_ALL_BLD.reduce((a,b)=>a+csTotal(b),0);
  return`<div class="card" style="margin-bottom:12px">
    <div class="ch" style="cursor:pointer" onclick="APP.csInfoOpen=!APP.csInfoOpen;csSaveState();renderPage()">
      <span>🏛 Gebäude-Übersicht</span><span style="font-size:16px">${open?'▲':'▼'}</span>
    </div>
    ${open?`<div class="cb">
      <div style="font-size:11px;color:var(--tx3);margin-bottom:10px">
        12 eroberbare Gebäude · Gesamtpool bei durchgehender Kontrolle: <strong style="color:var(--win)">${fmt(poolPts)} Punkte</strong> in 30 Minuten.
      </div>
      <div class="scroll-x">
        <table style="font-size:11px">
          <thead><tr><th>Gebäude</th><th>Pkt/s</th><th>Ab</th><th>Gesamt</th><th>Effekt</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`:''}
  </div>`;
}

// ── Übersichtsbild ──
// Ein Bild: Karte in der Mitte, Namen in den Seitenspalten, farbige Pfeile für jeden
// Wechsel (grün 5:00 · orange 8:00 · lila 12:00) und darunter der Wechsel-Fahrplan.
export const CS_MAP_W=388, CS_MAP_H=537, CS_S=1.30;
export const CS_ANCHOR={
  dc_w:     {x:112,y:118,side:'l'},
  kraftturm:{x:194,y:222,side:'l'},
  serum_nw: {x:72, y:240,side:'l'},
  def_sw:   {x:72, y:322,side:'l'},
  lager1:   {x:50, y:398,side:'l'},
  lager2:   {x:146,y:398,side:'l'},
  dc_o:     {x:274,y:118,side:'r'},
  def_no:   {x:317,y:240,side:'r'},
  viruslab: {x:194,y:307,side:'r'},
  serum_so: {x:317,y:322,side:'r'},
  lager3:   {x:242,y:398,side:'r'},
  lager4:   {x:338,y:398,side:'r'},
};
// Spawn-Bereiche auf dem Bild: Ordnungshüter oben, Morgenbringer unten (2 Spawns,
// einer davon gehört der Partnerallianz).
export const CS_SPAWN={
  ordnung:[{x:194,y:42}],
  morgen: [{x:76, y:494},{x:283,y:494}],
};
export function csMapSvg(t){
  const MW=Math.round(CS_MAP_W*CS_S), MH=Math.round(CS_MAP_H*CS_S);
  const GUT=176, TOP=32, mapX=GUT;
  const P=t?csGetPlan(t):{};
  const moves=t?csMoves(t):[];
  const ass=t?csAssassinen(t):[];
  // Das Bild ist bewusst durchgehend englisch — siehe trEN(). Deshalb stehen hier
  // keine deutschen Wörter, auch nicht in zusammengesetzten Texten.
  const legendRows=[...moves.map(m=>({t:csTLabel(m.to),c:csTColor(m.to),
      txt:`${m.n}: ${trEN(CS_BLD[m.from].label)} → ${trEN(CS_BLD[m.to].label)}`})),
    ...(ass.length?[{t:'12:00',c:'#7c3aed',txt:`${trEN('Assassinen')} (${ass.join(', ')}) → ${trEN('Hochsicherheitslabor')}`}]:[])];
  // Ersatzspieler bekommen im Bild einen Stern und eine Fußnote — im Spiel gepostet
  // muss erkennbar bleiben, wessen Antreten nicht gesichert ist.
  const istErsatz=n=>csIstErsatz(APP.csTeamAssign[n]);
  const hatErsatz=t?csPool(t).some(n=>istErsatz(n)&&P[n]&&(P[n].s||P[n].d)):false;
  const LEG_BASE=legendRows.length?34+legendRows.length*14+10:14;
  const FUSS=hatErsatz?16:0;
  const LEG=LEG_BASE+FUSS;
  const W=GUT*2+MW, H=TOP+MH+LEG;

  // Wer steht auf welcher Karte
  function occ(b){
    if(!t)return[];
    const mit=(n,tag,c)=>({n,tag,c,sub:istErsatz(n)});
    if(b==='viruslab')return ass.map(n=>mit(n,'from 12:00','#7c3aed'));
    if(CS_LATE_BLD.includes(b))
      return csAtDest(t,b).map(n=>mit(n,'from '+csTLabel(b)+(P[n]&&P[n].s?' · from '+trEN(CS_BLD[P[n].s].short):''),csTColor(b)));
    return csAtStart(t,b).map(n=>{
      const d=P[n]&&P[n].d&&P[n].d!=='viruslab'?P[n].d:null;
      return mit(n,d?'→ '+trEN(CS_BLD[d].short)+' '+csTLabel(d):null,d?csTColor(d):null);
    });
  }
  const ROW=n=>n.some(z=>z.tag)?18:13;
  function layout(side){
    const keys=CS_ALL_BLD.filter(b=>CS_ANCHOR[b].side===side).sort((a,b)=>CS_ANCHOR[a].y-CS_ANCHOR[b].y);
    const out=[];let prev=-999;
    keys.forEach(b=>{
      // +14 statt +8 wenn Badges dabei sind — sonst wird die Badge-Zeile unter dem
      // letzten Namen vom Kartenrand abgeschnitten.
      const ns=occ(b), h=17+Math.max(1,ns.length)*ROW(ns)+(ns.some(z=>z.tag)?15:8);
      let y=CS_ANCHOR[b].y*CS_S-h/2;
      if(y<prev+9)y=prev+9;
      if(y<2)y=2;
      out.push({b,y,h,ns});prev=y+h;
    });
    const last=out[out.length-1];
    if(last&&last.y+last.h>MH){
      let sh=last.y+last.h-MH;
      for(let i=out.length-1;i>=0&&sh>0;i--){
        const min=i===0?0:out[i-1].y+out[i-1].h+9;
        const can=Math.min(sh,out[i].y-min);out[i].y-=can;sh-=can;
      }
    }
    return out;
  }
  function card(o,side){
    const b=o.b,m=CS_BLD[b],isAss=b==='viruslab';
    const x=side==='l'?8:mapX+MW+12, w=GUT-20;
    const col=m.color, ax=mapX+CS_ANCHOR[b].x*CS_S, ay=TOP+CS_ANCHOR[b].y*CS_S;
    const cy=TOP+o.y+o.h/2, lx=side==='l'?x+w:x, rh=ROW(o.ns);
    return`<g>
      <line x1="${lx}" y1="${cy}" x2="${ax}" y2="${ay}" stroke="${col}" stroke-width="1.2" stroke-opacity=".7" stroke-dasharray="3,2"/>
      <circle cx="${ax}" cy="${ay}" r="4" fill="${col}" stroke="#fff" stroke-width="1.4"/>
      <rect x="${x}" y="${TOP+o.y}" width="${w}" height="${o.h}" rx="6" fill="#fff" stroke="${col}" stroke-width="${isAss?2.2:1.3}"/>
      <path d="M${x+6},${TOP+o.y} h${w-12} a6,6 0 0 1 6,6 v11 h${-w} v-11 a6,6 0 0 1 6,-6 z" fill="${col}"/>
      <text x="${x+w/2}" y="${TOP+o.y+12}" font-size="9.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${escapeHtml(trEN(m.label))}</text>
      <text x="${x+5}" y="${TOP+o.y+26}" font-size="8" font-weight="700" fill="${col}" font-family="sans-serif">${m.pts}/s${m.from?' · from '+Math.floor(m.from/60)+':00':''}</text>
      ${isAss?`<text x="${x+w-5}" y="${TOP+o.y+26}" font-size="8" font-weight="800" fill="#7c3aed" text-anchor="end" font-family="sans-serif">${escapeHtml(trEN('Assassinen').toUpperCase())}</text>`:''}
      ${o.ns.length?o.ns.map((z,i)=>{
        const yy=TOP+o.y+17+(i+1)*rh;
        // Der Stern gehört zum Namen, darf beim Kürzen also nicht wegfallen.
        const nm=(z.n.length>19?z.n.slice(0,18)+'…':z.n)+(z.sub?' *':'');
        return`<text x="${x+w/2}" y="${yy}" font-size="9.5" font-weight="700" fill="#1d2b3a" text-anchor="middle" font-family="sans-serif">${escapeHtml(nm)}</text>`+
          (z.tag?`<text x="${x+w/2}" y="${yy+8.5}" font-size="8" font-weight="800" fill="${z.c}" text-anchor="middle" font-family="sans-serif">${escapeHtml(z.tag)}</text>`:'');
      }).join(''):`<text x="${x+w/2}" y="${TOP+o.y+17+rh}" font-size="8.5" font-style="italic" fill="#8892a4" text-anchor="middle" font-family="sans-serif">${escapeHtml(trEN('frei'))}</text>`}
    </g>`;
  }
  function arrows(){
    let g='<defs>';
    ['#27ae60','#e67e22','#7c3aed'].forEach((c,i)=>{
      g+=`<marker id="csah${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`;
    });
    g+='</defs>';
    const mi={'#27ae60':0,'#e67e22':1,'#7c3aed':2};
    moves.forEach(m=>{
      const a=CS_ANCHOR[m.from],b=CS_ANCHOR[m.to],c=csTColor(m.to);
      const x1=mapX+a.x*CS_S,y1=TOP+a.y*CS_S,x2=mapX+b.x*CS_S,y2=TOP+b.y*CS_S;
      const mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
      const cx=mx-dy/len*26,cy=my+dx/len*26;
      g+=`<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" fill="none" stroke="${c}" stroke-width="2.6" stroke-opacity=".95" marker-end="url(#csah${mi[c]})"/>`;
      const lx=(x1+2*cx+x2)/4,ly=(y1+2*cy+y2)/4;
      g+=`<rect x="${lx-17}" y="${ly-8}" width="34" height="16" rx="8" fill="${c}"/>`;
      g+=`<text x="${lx}" y="${ly+3.5}" font-size="9.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${csTLabel(m.to)}</text>`;
    });
    if(ass.length){
      const v=CS_ANCHOR.viruslab;
      const x2=mapX+v.x*CS_S,y2=TOP+v.y*CS_S;
      const x1=mapX+194*CS_S,y1=TOP+150*CS_S;
      g+=`<path d="M${x1},${y1} L${x2},${y2-9}" fill="none" stroke="#7c3aed" stroke-width="3.4" stroke-opacity=".95" marker-end="url(#csah2)"/>`;
      g+=`<rect x="${x1-58}" y="${y1-27}" width="116" height="20" rx="10" fill="#7c3aed"/>`;
      g+=`<text x="${x1}" y="${y1-13}" font-size="10.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${escapeHtml(trEN('Assassinen').toUpperCase())} 12:00</text>`;
    }
    return g;
  }
  // Spawn-Bereiche beschriften. Die eigene Seite wird farbig hervorgehoben,
  // die gegnerische bleibt gedämpft.
  function spawns(){
    const eigene=t?csFaction(t):null;
    let g='';
    Object.entries(CS_SPAWN).forEach(([fk,pos])=>{
      const wir=eigene===fk;
      const col=wir?CS_FACTIONS[fk].color:'#3d4a5c';
      // Bei den Morgenbringern gehören BEIDE unteren Spawns zur eigenen Seite —
      // einer davon der Partnerallianz. Deshalb „unsere Seite" statt „wir".
      const zusatz=!t?'':wir?(pos.length>1?' · OUR SIDE':' · US'):' · ENEMY';
      const label=trEN(CS_FACTIONS[fk].label).toUpperCase()+zusatz;
      // 5.0 pro Zeichen war zu knapp: "DAWNBRINGERS · OUR SIDE" misst 118.9px und lief
      // aus der 115px-Kapsel heraus. 5.4 plus 12px Innenabstand deckt den längsten Fall.
      const w=Math.max(112,label.length*5.4+12), h=17;
      pos.forEach(p=>{
        const cx=mapX+p.x*CS_S, cy=TOP+p.y*CS_S;
        g+=`<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" rx="8"
             fill="${col}" fill-opacity="${wir?0.95:0.72}" stroke="#fff" stroke-width="${wir?1.8:1}"${wir?'':' stroke-dasharray="4,2"'}/>`;
        g+=`<text x="${cx}" y="${cy+4}" font-size="8.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${escapeHtml(label)}</text>`;
      });
    });
    return g;
  }
  const F=t?CS_FACTIONS[csFaction(t)]:null;
  const title=t?`${trEN('Schluchtsturm')} · Team ${t} · ${zeitLang(csZeit(t))}${F?' · '+trEN(F.label):''}`
             :`${trEN('Schluchtsturm')} · ${trEN('Gebäude')}`;
  const fussnote=hatErsatz?`<text x="${W/2}" y="${TOP+MH+LEG_BASE+10}" font-size="9" font-weight="700" fill="#5b6879" text-anchor="middle" font-family="sans-serif">${escapeHtml(trEN('* Ersatzspieler — Einsatz nicht gesichert'))}</text>`:'';
  const legend=legendRows.length?`
    <rect x="10" y="${TOP+MH+8}" width="${W-20}" height="${LEG_BASE-16}" rx="8" fill="#fff" stroke="#c9d2e0"/>
    <text x="20" y="${TOP+MH+25}" font-size="10.5" font-weight="800" fill="#2c3e6b" font-family="sans-serif">${escapeHtml(trEN('WECHSEL-FAHRPLAN'))}</text>
    ${legendRows.map((r,i)=>`
      <rect x="20" y="${TOP+MH+33+i*14}" width="36" height="12" rx="6" fill="${r.c}"/>
      <text x="38" y="${TOP+MH+42+i*14}" font-size="8" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${r.t}</text>
      <text x="63" y="${TOP+MH+42+i*14}" font-size="9.5" fill="#1d2b3a" font-family="sans-serif">${escapeHtml(r.txt)}</text>`).join('')}`:'';
  return`<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin:0 auto;border-radius:10px;border:1px solid #c9d2e0" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#f4f6fa"/>
    <rect width="${W}" height="26" fill="#2c3e6b"/>
    <text x="${W/2}" y="18" font-size="12.5" font-weight="800" fill="#fff" text-anchor="middle" font-family="sans-serif">${escapeHtml(title)}</text>
    <image href="assets/cs_map_bg.png" x="${mapX}" y="${TOP}" width="${MW}" height="${MH}" preserveAspectRatio="none"/>
    ${spawns()}
    ${t?arrows():''}
    ${layout('l').map(o=>card(o,'l')).join('')}
    ${layout('r').map(o=>card(o,'r')).join('')}
    ${legend}
    ${fussnote}
  </svg>`;
}
export function showCSMap(){
  const t=APP.csTeam;
  const ex=document.getElementById('csmap');if(ex)ex.remove();
  const d=document.createElement('div');
  d.id='csmap';
  d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900;overflow:auto;padding:16px';
  d.innerHTML=`<div style="max-width:940px;margin:0 auto;background:#fff;border-radius:14px;padding:14px" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:15px;font-weight:800">Übersichtsbild · Team ${t}</div>
      <button onclick="document.getElementById('csmap').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tx3)">×</button>
    </div>
    <div id="csmap-body">${csMapSvg(t)}</div>
    <button class="btn btn-sol" style="width:100%;margin-top:10px" onclick="downloadCSMapPng('${t}')">⬇ Als PNG speichern</button>
    <button class="btn btn-out" style="width:100%;margin-top:6px" onclick="shareCSMapPng('${t}',this)">📷 In Fotos speichern</button>
  </div>`;
  d.onclick=()=>d.remove();
  document.body.appendChild(d);
}
export async function _buildCSMapCanvas(){
  const svg=document.querySelector('#csmap-body svg');
  if(!svg)return null;
  return _svgToPngCanvas(svg,2);
}
export async function downloadCSMapPng(t){
  const c=await _buildCSMapCanvas();
  if(!c)return;
  const a=document.createElement('a');
  a.download=`schluchtsturm_team${t}.png`;
  a.href=c.toDataURL('image/png');
  a.click();
}
export async function shareCSMapPng(t,btn){
  await savePngToPhotos(_buildCSMapCanvas,`schluchtsturm_team${t}.png`,btn);
}

// ── Tab: Mail ──
export function csBuildMail(t){
  // Bewusst OHNE Spielernamen und OHNE fraktionsspezifische Anweisungen: wer wo steht,
  // zeigt die Karte. Hier stehen nur Hinweise, die für beide Teams und beide Fraktionen
  // gelten. Alle Zahlen aus dem In-Game-Regeln-Bildschirm.
  const L=[];
  const a=x=>L.push(x);
  a('\u26f0 SCHLUCHTSTURM \u2014 BRIEFING');
  a('='.repeat(52));
  a('');
  a('\u25b8 TEAM '+t+' \u2014 START '+csZeit(t)+' EU / '+serverZeit(csZeit(t))+' SERVERZEIT');
  a('  Im Spiel wird nach Serverzeit angesagt.');
  a('');
  a('\u25b8 WORAUF ES ANKOMMT');
  a('  30 Minuten. '+CS_MAX_GESETZT+' Spieler je Allianz. Max. 5 pro Geb\u00e4ude.');
  a('  Punkte kommen NUR aus gehaltenen Geb\u00e4uden, nicht aus Kills.');
  a('  Wer am Ende mehr Punkte hat, gewinnt. Sonst nichts.');
  a('');
  a('\u25b8 DIE GEB\u00c4UDE');
  a('  Hochsicherheitslabor   120/s   ab 12:00');
  a('  Energieturm             50/s   ab Start');
  a('  Datenzentrum I + II     20/s   ab Start');
  a('  Serumfabrik I + II      20/s   ab 5:00');
  a('  Verteidigungssyst. I+II 20/s   ab 8:00');
  a('  Probenlager I bis IV    15/s   ab Start');
  a('');
  a('  Vier Probenlager zusammen sind 60/s \u2014 mehr als der');
  a('  Energieturm. Untersch\u00e4tzt sie nicht, nur weil einzeln');
  a('  wenig danebensteht.');
  a('');
  a('\u25b8 DREI GEB\u00c4UDE K\u00d6NNEN MEHR ALS PUNKTE');
  a('  Verteidigungssystem: greift nach der Eroberung AUTOMATISCH');
  a('  alle feindlich besetzten Kerngeb\u00e4ude an (Labor, Serumfabrik,');
  a('  Verteidigungssystem, Energieturm) und sch\u00e4digt deren');
  a('  Garnisonstruppen. Wer sie ab 8:00 h\u00e4lt, zerm\u00fcrbt die');
  a('  gegnerische Labor-Besatzung, bevor das Labor \u00fcberhaupt aufgeht.');
  a('');
  a('  Energieturm: h\u00e4lt ihn die Ordnungsh\u00fcter-Seite, k\u00f6nnen sie den');
  a('  Schutzschild der Zentrumszone aktivieren. Basen dort sind dann');
  a('  unangreifbar \u2014 und das Labor liegt im Zentrum.');
  a('');
  a('  Serumfabrik: gibt dem Garnisonskommandanten regelm\u00e4ssig Buffs.');
  a('  Die Effekte werden vorher angezeigt \u2014 schaut hin und plant');
  a('  euren Angriff auf den Buff.');
  a('');
  a('\u25b8 DIE F\u00c4HIGKEITEN');
  a('  Tag des J\u00fcngsten Gerichts (nur Ordnungsh\u00fcter-Seite):');
  a('  120 s aktiv, 300 s Abklingzeit. Jeder Teleport macht 5.000');
  a('  Haltbarkeitsschaden an Feindbasen im weiteren Umfeld. Pro');
  a('  zerst\u00f6rter Basis \u221230 s eigener Teleport, +60 s beim Opfer.');
  a('  \u2192 Steht als Gegner nie dicht beieinander. Verteilt anr\u00fccken.');
  a('');
  a('  Artillerieturm (nur Morgenbringer-Seite): zielt auf die');
  a('  n\u00e4chstgelegene Feindbasis.');
  a('');
  a('  Feldlazarett (beide Seiten): heilt verwundete Einheiten.');
  a('');
  a('  Energie f\u00fcr all das entsteht durch: Gegner besiegen, Einheiten');
  a('  heilen, Kraftwerk halten, Basis-Haltbarkeit zerst\u00f6ren ODER');
  a('  reparieren, Versorgungskisten sammeln, garnisonieren.');
  a('  Wer im Direktkampf chancenlos ist, tr\u00e4gt hier am meisten bei.');
  a('');
  // Der Chat-Hinweis gilt nur, wenn beide Teams tats\u00e4chlich gleichzeitig
  // antreten. Bei getrennten Zeiten ist der Allianzchat eindeutig.
  if(csZeit('A')===csZeit('B')){
    a('\u25b8 TEAM A UND TEAM B SPIELEN GLEICHZEITIG');
    a('  Im Allianzchat ist NIE eindeutig, f\u00fcr welches Match eine');
    a('  Nachricht gilt. Wartet auf keine Ansage \u2014 es kommt keine,');
    a('  die sicher f\u00fcr euch gilt.');
    a('  Schaut auf die Karte. Jeder entscheidet selbst.');
  }else{
    a('\u25b8 TEAM A UND TEAM B SPIELEN GETRENNT');
    a('  Team A um '+csZeit('A')+' EU ('+serverZeit(csZeit('A'))+' Serverzeit),');
    a('  Team B um '+csZeit('B')+' EU ('+serverZeit(csZeit('B'))+' Serverzeit).');
    a('  Der Allianzchat geh\u00f6rt also jeweils euch \u2014 nutzt ihn.');
  }
  a('');
  a('\u25b8 EURE ZUTEILUNG IST EIN RICHTWERT');
  a('  Haltet euren Posten, solange dort etwas los ist.');
  a('  Kein Gegner bei euch und woanders brennt es? Geht hin.');
  a('  Ein Geb\u00e4ude, das gerade verloren geht, kostet mehr als');
  a('  euer ruhiger Posten einbringt.');
  a('');
  a('  ABER: nie ein Geb\u00e4ude verwaisen lassen. Ein leeres Geb\u00e4ude');
  a('  ist ein geschenktes Geb\u00e4ude. Vergewissert euch vorher, dass');
  a('  noch jemand von uns dort steht.');
  a('');
  a('\u25b8 BEHALTET DIE KARTE IM BLICK');
  a('  Die \u00dcbersicht zeigt euch, wer welches Geb\u00e4ude h\u00e4lt und wie');
  a('  stark. Schaut da regelm\u00e4ssig drauf, nicht nur auf euren Posten.');
  a('');
  a('  \u2022 Ein unbewachtes oder schwach besetztes Gegner-Geb\u00e4ude ist');
  a('    geschenkt \u2014 und ihr nehmt ihm gleichzeitig seine Punkte weg.');
  a('  \u2022 Sucht die Stellen, wo der Gegner NICHT ist. Er kann nicht');
  a('    \u00fcberall sein. Genau dort holt ihr die billigsten Punkte.');
  a('  \u2022 Nach eurer \u00dcbernahme fliegen seine angesammelten Punkte');
  a('    als Kisten heraus. Sofort einsammeln.');
  a('');
  a('  Drei Bedingungen, bevor ihr losgeht:');
  a('  1. Bei euch steht gerade kein Gegner.');
  a('  2. Euer Posten bleibt besetzt \u2014 pr\u00fcft das vorher.');
  a('  3. Ihr k\u00f6nnt das neue Geb\u00e4ude auch halten. Eine Eroberung,');
  a('     die zwanzig Sekunden sp\u00e4ter wieder f\u00e4llt, war umsonst.');
  a('');
  a('  Meldet solche L\u00fccken ruhig im Chat \u2014 aber verlasst euch nicht');
  a('  darauf, dass jemand reagiert. Handelt selbst.');
  a('');
  a('\u25b8 MAX. 5 PRO GEB\u00c4UDE');
  a('  Auch ins Hochsicherheitslabor passen nur f\u00fcnf. Der Kampf');
  a('  ab 12:00 findet UM das Geb\u00e4ude herum statt, nicht darin.');
  a('  \u201eAlle ins Labor\u201c geht nicht \u2014 der Rest h\u00e4lt den Raum frei.');
  a('');
  a('\u25b8 PUNKTE STEHLEN');
  a('  Ein Geb\u00e4ude sammelt mit der Zeit Punkte an, die bei einer');
  a('  \u00dcbernahme als Kisten herumfliegen.');
  a('  1. Verlasst euren Posten nur, wenn dort noch nichts zu holen');
  a('     ist. Sonst verschenkt ihr mehr, als ihr holt.');
  a('  2. Je l\u00e4nger ihr haltet, desto wertvoller werdet ihr als Ziel.');
  a('     F\u00e4llt euer Geb\u00e4ude: SOFORT die Kisten einsammeln, bevor');
  a('     der Gegner sie hat.');
  a('  3. Am Ende lieber ein lange gehaltenes Gegner-Geb\u00e4ude nehmen');
  a('     als ein frisches.');
  a('');
  a('\u25b8 ABLAUF');
  // Phasentexte auf Spielbreite umbrechen (In-Game-Mail bricht lange Zeilen unsauber um)
  CS_PHASES.forEach(p=>{
    const worte=p.desc.split(' ');let z='';const zeilen=[];
    worte.forEach(w=>{ if((z+' '+w).trim().length>52){zeilen.push(z.trim());z=w;} else z+=' '+w; });
    if(z.trim())zeilen.push(z.trim());
    zeilen.forEach((zl,i)=>a('  '+(i===0?p.t.padEnd(7):' '.repeat(7))+zl));
  });
  a('');
  a('\u25b8 LETZTE 3 MINUTEN');
  a('  Nicht mehr rausgehen und Basen jagen. Eine Sekunde l\u00e4nger');
  a('  halten bringt mehr als jeder Angriff. In einem dokumentierten');
  a('  Match kippte der Punktestand in dieser Phase mehrfach \u2014');
  a('  gewonnen hat, wer Einheiten nachgeschoben hat.');
  a('');
  a('\u25b8 EURE BASIS');
  a('  6.000 Haltbarkeit. Ist sie leer, werdet ihr zwangsweise zum');
  a('  Startpunkt zur\u00fcckgesetzt und seid erst mal raus.');
  a('  Repariert rechtzeitig \u2014 das gibt nebenbei Energie.');
  a('');
  a('\u25b8 TELEPORT');
  a('  Die Abklingzeit ist hier sp\u00fcrbar l\u00e4nger als im W\u00fcstensturm.');
  a('  Springt nicht blind. Ein verschwendeter Teleport kostet euch');
  a('  Minuten, in denen ihr nirgends Punkte macht.');
  a('');
  a('\u25b8 DIE H\u00c4UFIGSTEN FEHLER');
  a('  \u2022 In den letzten Minuten losziehen und Basen angreifen,');
  a('    statt die Eroberung zu halten.');
  a('  \u2022 \u00dcberall ein bisschen stehen. Wenige Geb\u00e4ude richtig');
  a('    halten schl\u00e4gt viele halb.');
  a('  \u2022 Erst um 12:00 Richtung Labor aufbrechen. Wer dann noch');
  a('    anmarschiert, kommt zu sp\u00e4t.');
  a('  \u2022 Dicht zusammenstehen. Fl\u00e4chenschaden trifft sonst alle.');
  a('  \u2022 K\u00e4mpfe annehmen, die man nicht gewinnen kann. Truppen');
  a('    sind endlich \u2014 am Ende z\u00e4hlt, wer noch welche hat.');
  return L.join('\n');
}
export function csMailExport(){
  const t=APP.csTeam,txt=csBuildMail(t);
  return`
    ${csTeamTabs()}
    ${(()=>{
      const msg=csGetMsg(), n=msg.length, ueber=n>CS_MSG_MAX;
      return`<div class="card" style="margin-bottom:12px;border:2px solid var(--acc)">
        <div class="ch" style="background:var(--acc-l)">
          <span>📣 Allianz-Text</span>
          <span class="ch-sub">gilt für beide Fraktionen · max. ${CS_MSG_MAX} Zeichen</span>
        </div>
        <div class="cb">
          <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">
            Der kurze Text, den ihr zusammen mit den Bildern in den Allianzchat stellt.
            Änderungen werden automatisch gespeichert.
          </div>
          <textarea id="cs-msg" oninput="csMsgInput(this)"
            style="width:100%;height:200px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;border:1.5px solid ${ueber?'var(--loss)':'var(--bd)'};border-radius:8px;padding:10px;resize:vertical">${escapeHtml(msg)}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px">
            <span id="cs-msg-count" style="font-size:11px;font-weight:${ueber?'800':'600'};color:${ueber?'var(--loss)':n>CS_MSG_MAX-40?'var(--acc)':'var(--tx3)'}">${n} / ${CS_MSG_MAX}</span>
            <button class="btn btn-out btn-sm" onclick="csResetMsg()">↺ Standardtext</button>
          </div>
          ${ueber?`<div class="note" style="border-left-color:var(--loss);background:var(--loss-l);border-color:#f5b7b1;margin:8px 0 0;font-size:11px">
            <strong>${n-CS_MSG_MAX} Zeichen über dem Limit</strong> — im Spiel wird der Text sonst abgeschnitten.</div>`:''}
          <button class="btn btn-sol" style="width:100%;margin-top:10px" onclick="copyText(document.getElementById('cs-msg').value,this,'📋 Allianz-Text kopieren')">📋 Allianz-Text kopieren</button>
        </div>
      </div>`;
    })()}
    <div class="note info">Darunter das ausführliche Briefing. Bewusst <strong>ohne Spielernamen</strong> — wer wo steht, zeigt das Übersichtsbild.</div>
    <div class="card" style="margin-bottom:12px">
      <div class="ch">✉ Strategie-Briefing <span class="ch-sub">gilt für beide Teams und beide Fraktionen</span></div>
      <div class="cb">
        <textarea id="cs-mail" readonly style="width:100%;height:360px;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.45;border:1.5px solid var(--bd);border-radius:8px;padding:10px;resize:vertical">${escapeHtml(txt)}</textarea>
        <button class="btn btn-sol" id="cs-copy" style="width:100%;margin-top:10px" onclick="copyText(document.getElementById('cs-mail').value,this,'📋 Text kopieren')">📋 Text kopieren</button>
      </div>
    </div>`;
}
