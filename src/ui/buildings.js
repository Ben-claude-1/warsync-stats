import { nav, renderPage, setWSView } from '../app/render.js';
import { sbDelete, sbGet, sbPatch, sbPost, sbPostRet } from '../core/api.js';
import { loadData, plannerPush, plannerResolve } from '../core/auth.js';
import { avgPts, badge, byRankThenHero, canAccess, fmt, fmtK, fmtMio, getBldSlots, getLineup, getT1, getZoneSlots, rankBadge, relColor, reliability, setLineup, setLineupReady, sortPlayers, wsPower, zeitLang } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { GENDER_SYM, avatarImg, avatarUrl, genderMark, hqBadge, isInactive } from '../core/players.js';
import { prioCGesamt, prioOf } from '../core/prio.js';
import { EINSATZ_LEER, REG_WERTE, einsatzBilanzAlle, regPlatzPruefen, teamOf } from '../core/rotation.js';
import { APP, MAIL_DEFAULT } from '../core/state.js';
import { lsKey } from '../core/tenant.js';
import { apdSetActive, calcGrowthAll } from './allianz.js';
import { csResetWoche } from './cs.js';
import { openPlayer } from './overlay.js';
import { WS_MAX_ERSATZ, WS_MAX_GESETZT, WS_ZEITEN, getNextFriday, wsAnmeldeschluss, wsFixedCount, wsFreezeRoster, wsIstFixiert, wsPoolSort, wsPrioVerrechnen, wsRosterGroups, wsTeamPool, wsZeit } from './ws.js';

// ====== GEBÄUDE-PRIO + ZUWEISUNG (WIP-Features) ======
export const BLD_STRAT={
  infozentrum:{tag:'MUSS-HALTEN',tagColor:'#c0392b',
    why:'+10% Multiplikator auf ALLE Gebäude global. Bei halber Gebäudekontrolle ~44.000–62.000 Pts Verlust wenn verloren. Braucht einen festen Halter — Assassinen sind bis Min 10 frei unterwegs.'},
  oelraf1:{tag:'KERNGEBÄUDE',tagColor:'#c0392b',
    why:'Größte Einzelpunktquelle Phase 1 — 50/s über 30 Min = 90.000 Pts. Verlust ist kaum aufzuholen.'},
  oelraf2:{tag:'KERNGEBÄUDE',tagColor:'#27ae60',
    why:'Zweite Hauptpunktquelle — identischer Wert wie Ölraf. I. Zone 3 halten = Fundament des Punktevorsprungs.'},
  sciencehub:{tag:'TAKTISCH',tagColor:'#27ae60',
    why:'TP-Cooldown halbiert (2 Min → 1 Min). Eigene Helden können doppelt so schnell reagieren, Zonen wechseln und Angriffe abwehren.'},
  arsenal:{tag:'KAMPFBUFF',tagColor:'#e67e22',
    why:'+15% ATK/DEF/HP für eigene Helden. Kombiniert mit Söldnerfabrik: +30% Kampfvorteil — entscheidend für Zone-5-Dominanz.'},
  soeldner:{tag:'DEBUFF',tagColor:'#e74c3c',
    why:'−15% ATK/DEF/HP für Feinde. Gegner kämpfen geschwächt — erhöht Überlebenschancen aller eigenen Helden massiv.'},
  laz1:{tag:'HEILUNG',tagColor:'#e8a020',
    why:'Truppenheilung +15 Einh./10s · 30/s Punkte · Zone 2. Hält die eigene Zone am Leben.'},
  laz2:{tag:'HEILUNG',tagColor:'#e8a020',
    why:'Truppenheilung +15 Einh./10s · 30/s Punkte · Zone 2. Puffer-Gebäude, wenn Zone 2 unter Druck steht.'},
  laz3:{tag:'HEILUNG',tagColor:'#2980b9',
    why:'Truppenheilung +15 Einh./10s · 30/s Punkte · Zone 4. Hält die eigene Zone am Leben.'},
  laz4:{tag:'HEILUNG',tagColor:'#2980b9',
    why:'Truppenheilung +15 Einh./10s · 30/s Punkte · Zone 4. Puffer-Gebäude, wenn Zone 4 unter Druck steht.'},
  silo:{tag:'ENDGAME',tagColor:'#7c3aed',
    why:'80/s = höchste Einzelpunktzahl. 93.440 Pts in 1.168s. Ab Min 10:00 das wertvollste Einzelgebäude — Assassinen stürmen sofort rein.'},
  oelquellen:{tag:'SPRINGER',tagColor:'#7f8c8d',
    why:'5/s ab Min 20 · Sammelmechanik. Springer-Priorität: Kisten sammeln & leere Gebäude einnehmen, Ölquellen als Fallback.'},
};
export const BLD_META={
  infozentrum:{label:'Infozentrum',dot:'🔴',pts:'10/s',total:'18.000',avail:'Start',color:'#c0392b'},
  oelraf1:{label:'Ölraffinerie I',dot:'🔴',pts:'50/s',total:'90.000',avail:'Start',color:'#c0392b'},
  oelraf2:{label:'Ölraffinerie II',dot:'🔴',pts:'50/s',total:'90.000',avail:'Start',color:'#27ae60'},
  sciencehub:{label:'Science Hub',dot:'🔴',pts:'10/s',total:'18.000',avail:'Start',color:'#27ae60'},
  arsenal:{label:'Arsenal',dot:'🟠',pts:'10/s',total:'11.680',avail:'Min 10:00',color:'#e67e22'},
  soeldner:{label:'Söldnerfabrik',dot:'🟠',pts:'10/s',total:'11.680',avail:'Min 10:00',color:'#e74c3c'},
  laz1:{label:'Feldlazarett I',dot:'🟡',pts:'30/s',total:'54.000',avail:'Start',color:'#e8a020'},
  laz2:{label:'Feldlazarett II',dot:'🟡',pts:'30/s',total:'54.000',avail:'Start',color:'#e8a020'},
  laz3:{label:'Feldlazarett III',dot:'🟡',pts:'30/s',total:'54.000',avail:'Start',color:'#2980b9'},
  laz4:{label:'Feldlazarett IV',dot:'🟡',pts:'30/s',total:'54.000',avail:'Start',color:'#2980b9'},
  silo:{label:'Raketensilo',dot:'🟢',pts:'80/s',total:'93.440',avail:'Min 10:00',color:'#7c3aed'},
  oelquellen:{label:'Ölquellen',dot:'⚪',pts:'5/s',total:'~3.000',avail:'Min 20',color:'#7f8c8d'},
};
export const _bldSlotMap={
  infozentrum:'z1',oelraf1:'z1',sciencehub:'z3',oelraf2:'z3',
  laz1:'z4',laz2:'z2',laz3:'z4',laz4:'z2',
  arsenal:'ars',soeldner:'sold',silo:'ass',oelquellen:'sup'
};
export const _bldShort={infozentrum:'Info',oelraf1:'Öl I',oelraf2:'Öl II',sciencehub:'Sci',laz1:'Laz I',laz2:'Laz II',laz3:'Laz III',laz4:'Laz IV',arsenal:'Ars',soeldner:'Söld',silo:'Silo',oelquellen:'ÖlQ'};
export const _zoneBlds={z1:['oelraf1','infozentrum'],z2:['laz2','laz4'],z3:['oelraf2','sciencehub'],z4:['laz1','laz3']};
export function moveBldPrio(key,dir){
  const defaultOrd=['infozentrum','oelraf1','sciencehub','oelraf2','arsenal','soeldner','laz1','laz2','laz3','laz4','silo','oelquellen'];
  const order=[...(APP.buildingOrder&&APP.buildingOrder.length>=12?APP.buildingOrder:defaultOrd)];
  const idx=order.indexOf(key);if(idx<0)return;
  const nIdx=idx+dir;if(nIdx<0||nIdx>=order.length)return;
  [order[idx],order[nIdx]]=[order[nIdx],order[idx]];
  APP.buildingOrder=order;
  saveWSState();renderPage();
}
export function changeBldSlot(key,d){
  if(!BLD_META[key])return; // unbekanntes Gebäude
  const bs=getBldSlots();
  // Min/Max je Gebäudetyp
  const min=0; // alle Gebäude können auf 0 gesetzt werden
  const max=10;
  bs[key]=Math.max(min,Math.min(max,(bs[key]||0)+d));
  saveWSState();
  renderPage();
}
export function cycleBldAssign(name,zone){
  const blds=_zoneBlds[zone];
  if(!blds)return;
  if(!APP.bldAssign)APP.bldAssign={};
  const cur=APP.bldAssign[name];
  const idx=blds.indexOf(cur);
  APP.bldAssign[name]=blds[(idx+1)%blds.length];
  saveWSState();renderPage();
}
export function autoAssignBld(name,zone,lineup){
  const blds=_zoneBlds[zone];
  if(!blds)return;
  if(!APP.bldAssign)APP.bldAssign={};
  const ba=APP.bldAssign;
  const zonePlayers=lineup[zone]||[];
  const cnt={};blds.forEach(b=>cnt[b]=0);
  zonePlayers.forEach(n=>{if(ba[n]&&cnt[ba[n]]!==undefined)cnt[ba[n]]++;});
  const target=blds.reduce((a,b)=>cnt[a]<=cnt[b]?a:b);
  ba[name]=target;
}
export function renderStrategyCard(){
  const open=APP.stratCardOpen!==false;
  const defOrd=['infozentrum','oelraf1','sciencehub','oelraf2','arsenal','soeldner','laz1','laz2','laz3','laz4','silo','oelquellen'];
  const ord=(APP.buildingOrder&&APP.buildingOrder.length>=12)?APP.buildingOrder:defOrd;
  const rows=ord.map((key,i)=>{
    const b=BLD_META[key];const s=BLD_STRAT[key];
    if(!b||!s)return'';
    const isFirst=i===0,isLast=i===ord.length-1;
    const btnBase='width:24px;height:24px;border:1.5px solid var(--bd);border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1';
    return`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
        <button onclick="moveBldPrio('${key}',-1)" style="${btnBase};background:${isFirst?'#f3f3f3':'#fff'};color:${isFirst?'#ccc':'var(--tx)'}" ${isFirst?'disabled':''}>▲</button>
        <button onclick="moveBldPrio('${key}',1)" style="${btnBase};background:${isLast?'#f3f3f3':'#fff'};color:${isLast?'#ccc':'var(--tx)'}" ${isLast?'disabled':''}>▼</button>
      </div>
      <div style="min-width:22px;height:22px;border-radius:50%;background:${b.color}22;color:${b.color};font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
          <span style="font-size:12px;font-weight:800;color:${b.color}">${b.dot} ${b.label}</span>
          <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:${s.tagColor}18;color:${s.tagColor}">${s.tag}</span>
          <span style="font-size:10px;color:var(--tx3);margin-left:auto">${b.pts} · ${b.total} Pts · ${b.avail}</span>
        </div>
        <div style="font-size:11px;color:var(--tx2);line-height:1.45">${s.why}</div>
      </div>
    </div>`;
  });
  return`<div class="card" style="margin-bottom:12px">
    <div class="ch" onclick="APP.stratCardOpen=!APP.stratCardOpen;saveWSState();renderPage()" style="cursor:pointer;user-select:none">
      <span>📋 Gebäude-Strategie</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="ch-sub">Prioritäten · ▲▼ verschieben</span>
        <span style="font-size:16px;color:var(--tx3)">${open?'▲':'▼'}</span>
      </div>
    </div>
    ${open?`<div style="padding:0 14px 10px">${rows.join('')}</div>`:''}
  </div>`;
}

export function autoAssign(){
  const t=APP.team;
  // wsTeamPool liefert nur noch, wer wirklich auf der Karte steht (fest gesetzt +
  // Rotation-Haupt, max. 20) — Ersatz und Warteliste bekommen keine Zonen-/
  // Gebäudezuweisung mehr, sie stehen als Namensliste unter der Karte.
  const teamPool=wsTeamPool(t);
  const seen=new Set();
  const rawPool=teamPool.length?teamPool:[...APP.accepted];
  const pool=rawPool.filter(n=>{
    if(!n||seen.has(n)||isInactive(n))return false;
    seen.add(n);return true;
  }).sort(wsPoolSort);

  const newL={ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]};
  if(!APP.bldAssign)APP.bldAssign={};
  pool.forEach(n=>delete APP.bldAssign[n]);

  const ts=getZoneSlots(t);
  const supN=ts.sup||0;

  // Springer: schwächste N (kein Gebäude). Achtung: slice(-0) === slice(0) → gesondert behandeln.
  newL.sup=supN===0?[]:(pool.length>supN?pool.slice(-supN):pool.slice());
  const ph1=pool.slice(0,pool.length-newL.sup.length); // alle außer Springer

  // Z5-Rollen nach Stärke: stärkste → Silo, nächste → Arsenal, nächste → Söldner
  // Constraint: jede Zone muss mindestens 1 permanenten Spieler behalten
  const ph1BldKeysEarly=['infozentrum','oelraf1','sciencehub','oelraf2','laz1','laz2','laz3','laz4'];
  const bldOrdEarly=(APP.buildingOrder||ph1BldKeysEarly).filter(k=>ph1BldKeysEarly.includes(k));
  const _bzE={oelraf1:'z1',infozentrum:'z1',laz2:'z2',laz4:'z2',oelraf2:'z3',sciencehub:'z3',laz1:'z4',laz3:'z4'};
  // Slot-Folge aus den eingestellten Zahlen bauen. Vorher lief das stumpf reihum über
  // alle acht Gebäude und las getBldSlots gar nicht — ein Gebäude mit 0 Slots bekam
  // trotzdem Spieler, eines mit 3 bekam zu viele. Die Zonen-Anzeige rechnet Phase-1-
  // Gäste (Silo/Arsenal/Söldner) gegen dieselbe Kapazität, deshalb zählen die hier mit.
  // Reihum bleibt es innerhalb der Kapazität: erst bekommt jedes Gebäude einen Spieler,
  // dann der Reihe nach den zweiten. So gehen die Stärksten auf die wichtigsten Gebäude.
  const bldCap=getBldSlots(t);
  const slotSeqE=[];
  {
    const used={};
    let platziert=true;
    while(slotSeqE.length<ph1.length&&platziert){
      platziert=false;
      for(const bk of bldOrdEarly){
        if(slotSeqE.length>=ph1.length)break;
        if((used[bk]||0)>=(bldCap[bk]||0))continue;
        used[bk]=(used[bk]||0)+1;slotSeqE.push(bk);platziert=true;
      }
    }
  }
  let assN=ts.ass||0,arsN=ts.ars||0,soldN=ts.sold||0;
  // Kappen: nicht mehr als ph1.length Z5-Spieler
  while(assN+arsN+soldN>ph1.length){if(soldN>0)soldN--;else if(arsN>0)arsN--;else assN--;}
  // Assassinen bekommen **kein** Phase-1-Gebäude: bis das Silo aufgeht, nullen sie
  // frei beweglich Gegner, statt irgendwo die Stellung zu halten. Die Slot-Folge
  // wird deshalb erst hinter ihnen abgezählt — sie beginnt bei Arsenal/Söldner.
  const bldStart=()=>arsN+soldN;                 // Index des ersten Zonen-Spielers in slotSeqE
  const bldPlaetze=()=>Math.min(slotSeqE.length,ph1.length-assN); // tatsächlich belegte Gebäude-Plätze
  // Hilfsfunktion: Anzahl Zonen mit permanentem Spieler ab Index 'off'
  const zonesFrom=off=>{const zs=new Set();const bis=bldPlaetze();for(let i=off;i<bis;i++){const z=_bzE[slotSeqE[i]];if(z)zs.add(z);}return zs.size;};
  // Reduziere Z5 (unwichtigste zuerst) bis alle 4 Zonen mindestens 1 Spieler haben.
  // Ein Assassine weniger heißt hier: ein Spieler mehr im Gebäude-Pool.
  const needZones=Math.min(4,ph1.length);
  while(assN+arsN+soldN>0&&zonesFrom(bldStart())<needZones){
    if(soldN>0)soldN--;else if(arsN>0)arsN--;else if(assN>0)assN--;else break;
  }
  let off=0;
  newL.ass=ph1.slice(off,off+assN); off+=assN;
  newL.ars=ph1.slice(off,off+arsN); off+=arsN;
  newL.sold=ph1.slice(off,off+soldN); off+=soldN;
  const zonePlayers=ph1.slice(off); // bleiben die ganze Zeit in ihren Zonen

  // Phase-1-Gebäude-Zuteilung: alle außer den Assassinen, Index für Index gegen
  // slotSeqE. Reichen die Slots nicht für alle, bleiben die Schwächsten ohne
  // Gebäude — sie landen unten in keiner Zone und stehen weiter im Pool zum
  // Verteilen von Hand.
  const bldPool=ph1.slice(assN);
  bldPool.forEach((name,i)=>{if(slotSeqE[i])APP.bldAssign[name]=slotSeqE[i];});
  const ohnePlatz=Math.max(0,bldPool.length-slotSeqE.length);

  // Zone-Spieler (permanent) in z1-z4 einsortieren
  zonePlayers.forEach(name=>{
    const zone=_bzE[APP.bldAssign[name]];
    if(zone)newL[zone].push(name);
  });

  // --- Minimaler Shift (Phase 2) ---
  // Arsenal und Söldner verlassen ihre Phase-1-Gebäude ab Min 10.
  // Spieler von den UNWICHTIGSTEN Gebäuden (letzte N in zonePlayers) springen in die geräumten wichtigen Slots.
  // Innerhalb dieser Gruppe: stärkster Shifter → wichtigstes geräumtes Gebäude.
  // Assassinen zählen hier nicht mit: sie hatten kein Gebäude, also räumen sie keins.
  const z5Count=newL.ars.length+newL.sold.length;
  const vacatedSlots=slotSeqE.slice(0,z5Count); // wichtigste Gebäude (von Z5 geräumt)
  if(!APP.bldAssignPh2)APP.bldAssignPh2={};
  ph1.forEach(n=>delete APP.bldAssignPh2[n]);
  const shifterStart=Math.max(0,zonePlayers.length-z5Count);
  zonePlayers.forEach((n,i)=>{
    if(!APP.bldAssign[n])return;   // ohne Phase-1-Gebäude auch keine Phase-2-Zuordnung
    if(i>=shifterStart&&vacatedSlots[i-shifterStart]){
      APP.bldAssignPh2[n]=vacatedSlots[i-shifterStart];
    } else {
      APP.bldAssignPh2[n]=APP.bldAssign[n];
    }
  });

  setLineup(t,newL);
  setLineupReady(t,true);
  APP.selectedChip=null;
  saveWSState();
  renderPage();
  // Nicht stillschweigend übergehen: sonst wundert man sich, wo die Spieler geblieben sind.
  if(ohnePlatz>0)alert(`${ohnePlatz} Spieler passen nicht in die eingestellten Gebäude-Slots (${slotSeqE.length} Plätze für ${bldPool.length} Spieler ohne Assassinen) und stehen weiter im Pool.\n\nEntweder Slots erhöhen oder von Hand verteilen.`);
}
export function resetLineup(){
  const t=APP.team;
  setLineup(t,{ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]});
  setLineupReady(t,false);
  APP.selectedChip=null;
  saveWSState();
  renderPage();
}

export function buildAufstellungMail(t){
  const L=getLineup(t);
  const ba=APP.bldAssign||{};
  const time=wsZeit(t);
  const stealZone=APP.teamSide==='left'?'z4':APP.teamSide==='right'?'z2':null;
  const BLD_SHORT={
    infozentrum:'Infozentrum',oelraf1:'Ölraf I',oelraf2:'Ölraf II',
    sciencehub:'Science Hub',laz1:'Laz I',laz2:'Laz II',laz3:'Laz III',laz4:'Laz IV',
  };
  const assSet=new Set(L.ass||[]),arsSet=new Set(L.ars||[]),soldSet=new Set(L.sold||[]);
  const ba2=APP.bldAssignPh2||{};
  function ph2(n){
    if(assSet.has(n))return'→ Silo (Z5) ab Min 10';
    if(arsSet.has(n))return'→ Arsenal (Z5) ab Min 10';
    if(soldSet.has(n))return'→ Söldner (Z5) ab Min 10';
    const p2=ba2[n];
    if(p2&&p2!==ba[n])return`→ ${BLD_SHORT[p2]||p2} ab Min 10 (Shift)`;
    return'bleibt';
  }
  const lines=[];
  const intro=APP.mailText[t]&&APP.mailText[t].trim();
  if(intro)lines.push(intro,'');
  lines.push(`Team ${t} · ${zeitLang(time)} – Aufstellung`);
  lines.push('');
  const zoneDef=[
    {key:'z1',lbl:'ZONE 1 (Infozentrum + Ölraf I)'},
    {key:'z2',lbl:'ZONE 2 (2× Feldlazarett)'},
    {key:'z3',lbl:'ZONE 3 (Ölraf II + Science Hub)'},
    {key:'z4',lbl:'ZONE 4 (2× Feldlazarett)'},
  ];
  // Z5-Gäste: Z5-Spieler in einer Zone anhand bldAssign
  const _bz={oelraf1:'z1',infozentrum:'z1',laz2:'z2',laz4:'z2',
             oelraf2:'z3',sciencehub:'z3',laz1:'z4',laz3:'z4'};
  // Assassinen stehen in Phase 1 in keiner Zone — sie haben kein Gebäude.
  const z5All=[...arsSet,...soldSet];
  function guestsInZone(zk){return z5All.filter(n=>_bz[ba[n]]===zk);}
  zoneDef.forEach(({key,lbl})=>{
    const isSteal=key===stealZone;
    const perm=L[key]||[];
    const guests=guestsInZone(key);
    const all=[...guests,...perm]; // Z5-Spieler zuerst (stärkste)
    lines.push(isSteal?`${lbl} ⚠ STEAL:`:`${lbl}:`);
    if(isSteal){
      lines.push('  leer lassen');
    } else if(!all.length){
      lines.push('  (leer)');
    } else {
      all.forEach(n=>{
        const bShort=BLD_SHORT[ba[n]]||'';
        lines.push(`  ${n} – ${bShort?bShort+' · ':''}${ph2(n)}`);
      });
    }
    lines.push('');
  });
  // Die Assassinen fehlen oben in jeder Zone, weil sie kein Gebäude halten. Ohne
  // diesen Block stünden die stärksten Spieler in der Ansage bis Min 10 nirgends.
  if((L.ass||[]).length){
    lines.push('⚔ ASSASSINEN (kein festes Gebäude):');
    L.ass.forEach(n=>lines.push(`  ${n} – frei beweglich · Gegner nullen · ab Min 10 Silo`));
    lines.push('');
  }
  if((L.sup||[]).length){
    lines.push('🛡 SPRINGER:');
    L.sup.forEach(n=>lines.push(`  ${n} – Kisten sammeln · ab Min 25 freie Gebäude${stealZone?' · Steal-Zone beobachten':''}`));
    lines.push('');
  }
  lines.push('ZONE 5 (ab Min 10:00):');
  if((L.ass||[]).length)lines.push(`  Silo: ${[...assSet].join(', ')}`);
  if((L.ars||[]).length)lines.push(`  Arsenal: ${[...arsSet].join(', ')}`);
  if((L.sold||[]).length)lines.push(`  Söldner: ${[...soldSet].join(', ')}`);
  return lines.join('\n').trim();
}
export function buildHinweiseMail(){
  const custom=APP.mailGeneral&&APP.mailGeneral.trim();
  return custom||MAIL_DEFAULT;
}
export function copyText(text,btn,resetLabel){
  navigator.clipboard.writeText(text).then(()=>{
    if(btn){btn.textContent='✅ Kopiert!';setTimeout(()=>{btn.textContent=resetLabel;},2000);}
  }).catch(()=>prompt('Text:',text));
}
export function exportAufstellung(t,btnId){
  const btn=document.getElementById(btnId);
  copyText(buildAufstellungMail(t),btn,'📋 Aufstellung Team '+t+' kopieren');
}
export function exportHinweise(btnId){
  const btn=document.getElementById(btnId);
  copyText(buildHinweiseMail(),btn,'📋 Hinweise kopieren');
}
export function wsMailExport(){
  function aufstellungBlock(t){
    const teamColor=t==='A'?'#2980b9':'#e67e22';
    const teamBg=t==='A'?'#e8f4fd':'#fdf0e8';
    const time=wsZeit(t);
    const L=getLineup(t);
    const hasLineup=Object.values(L).some(arr=>arr.length>0);
    const intro=APP.mailText[t]||'';
    const preview=hasLineup?buildAufstellungMail(t):'';
    return`<div class="card" style="margin-bottom:14px;border:2px solid ${teamColor}22">
      <div class="ch" style="color:${teamColor}">📋 Aufstellung Team ${t} · ${zeitLang(time)}</div>
      <div class="cb">
        <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Einleitung (optional)</label>
        <textarea rows="2" placeholder="z.B. Hallo Team ${t}, heute kämpfen wir gegen…"
          style="width:100%;padding:10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;min-height:60px;outline:none;margin-bottom:10px"
          oninput="APP.mailText['${t}']=this.value;saveWSState()">${intro}</textarea>
        ${hasLineup
          ?`<div style="background:#f4f6fb;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;white-space:pre-wrap;color:var(--tx);border:1px solid var(--bd);margin-bottom:10px;line-height:1.6">${preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <button id="copy-auf-${t}" class="btn btn-sol" style="width:100%;background:${teamColor}" onclick="exportAufstellung('${t}','copy-auf-${t}')">📋 Aufstellung Team ${t} kopieren</button>`
          :`<div class="note" style="background:${teamBg};border:1px solid ${teamColor}33;color:${teamColor}">Noch keine Aufstellung für Team ${t}. Zuerst im Tab <strong>Aufstellung</strong> planen.</div>`}
      </div>
    </div>`;
  }
  const hinweiseText=APP.mailGeneral||MAIL_DEFAULT;
  return`
    ${aufstellungBlock('A')}
    ${aufstellungBlock('B')}
    <div class="card" style="margin-bottom:14px">
      <div class="ch">💬 Hinweise-Mail <span class="ch-sub">allgemeine Taktik · für beide Teams</span></div>
      <div class="cb">
        <textarea rows="10" placeholder="${MAIL_DEFAULT}"
          style="width:100%;padding:10px;border:1.5px solid var(--bd);border-radius:8px;font-size:12px;font-family:monospace;resize:vertical;min-height:180px;outline:none;margin-bottom:10px;line-height:1.5"
          oninput="APP.mailGeneral=this.value;saveWSState()">${hinweiseText}</textarea>
        <button id="copy-hinweise" class="btn btn-sol" style="width:100%" onclick="exportHinweise('copy-hinweise')">📋 Hinweise kopieren</button>
      </div>
    </div>`;
}

// --- ANMELDUNG ---
export function playCount(name){return APP.data.participation.filter(x=>x.player_name===name&&x.played).length;}
export function regStats(name,since,mode='ws'){
  const parts=APP.data.participation.filter(x=>{
    if(x.player_name!==name)return false;
    const ev=APP.data.events.find(e=>e.id===x.event_id);
    return ev&&ev.mode===mode&&(!since||ev.event_date>=since);
  });
  // Ersatzspieler zählen nicht in den Nenner: wer als Ersatz gemeldet war und nicht
  // gebraucht wurde, hat nichts versäumt. Wurde er eingesetzt, zählt der Einsatz
  // sehr wohl — deshalb steckt `played` weiterhin alle Zeilen ein. Wartelisten-Zeilen
  // (Rotation hat keinen Platz übrig gehabt) zählen aus demselben Grund nicht mit.
  const gesetzt=parts.filter(x=>x.registered!==false&&!x.substitute&&!x.waitlisted);
  return{reg:gesetzt.length,played:parts.filter(x=>x.played).length,
         ersatz:parts.filter(x=>x.substitute).length,
         warteliste:parts.filter(x=>x.waitlisted).length,total:parts.length};
}
export function wsAnmeldung(){
  const friday=getNextFriday();
  const closed=APP.anmeldungClosed;
  const players=APP.data.players.filter(p=>!isInactive(p.name)).sort(byRankThenHero);
  const ta=players.filter(p=>teamOf(APP.teamAssign[p.name])==='A');
  const tb=players.filter(p=>teamOf(APP.teamAssign[p.name])==='B');
  const tc=players.filter(p=>APP.teamAssign[p.name]==='C');
  const tn=players.filter(p=>!APP.teamAssign[p.name]);
  // Angemeldet heißt nicht gesetzt: die E-Markierung nimmt jemanden aus der
  // Aufstellung, ohne ihn abzumelden. Beide Zahlen gehören deshalb nebeneinander.
  const eZahl=l=>l.filter(p=>APP.teamAssign[p.name]==='AE'||APP.teamAssign[p.name]==='BE').length;
  // Live-Vorschau (oder, nach dem Einfrieren, der echte Kader) — dieselbe
  // computeRoster()-Logik wie beim Anmeldeschluss, damit vorher schon sichtbar
  // ist, wer aktuell fest gesetzt wäre und wer rotieren würde.
  const groupsA=wsRosterGroups('A'),groupsB=wsRosterGroups('B');
  function rolleVon(name,groups){
    if(groups.fest.includes(name))return{label:'Fest',color:'var(--win)'};
    if(groups.rotationHaupt.includes(name))return{label:'Rotation',color:'var(--acc)'};
    if(groups.rotationErsatz.includes(name))return{label:'Ersatz',color:'var(--tx3)'};
    if(groups.warteliste.includes(name))return{label:'Warteliste',color:'var(--loss)'};
    return null;
  }
  // Wie oft ein Wert schon vergeben ist — für die „18/20"-Anzeige über der Liste
  // und um volle Knöpfe auszugrauen, bevor jemand vergeblich draufdrückt.
  const belegt=w=>Object.values(APP.teamAssign||{}).filter(v=>v===w).length;
  // Einmal für alle Spieler, nicht je Zeile: die Bilanz läuft über die ganze
  // Teilnahme-Tabelle, und die hat vierstellig viele Zeilen.
  const bilanz=einsatzBilanzAlle();
  // Fünf Knöpfe, ein Wert. Jeder schreibt genau seinen, ein zweiter Klick auf den
  // aktiven meldet ab — dieselbe Regel wie im Schluchtsturm, damit ein Knopf in
  // beiden Anmeldungen dasselbe bedeutet. Ersatz gestrichelt, 'C' ohne Rahmen-Team.
  function knopf(name,w,farbe,titel){
    const an=APP.teamAssign[name]===w;
    const grenze=w==='C'?Infinity:(w.length>1?WS_MAX_ERSATZ:WS_MAX_GESETZT);
    const voll=!an&&belegt(w)>=grenze;
    return`<button onclick="setTeamAssign('${name.replace(/'/g,"\\'")}','${w}')" title="${voll?'Kein Platz mehr frei':titel}"
      style="font-size:11px;padding:3px ${w.length>1?6:9}px;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;
        border:1.5px ${w.length>1?'dashed':'solid'} ${farbe};background:${an?farbe:'transparent'};color:${an?'#fff':farbe}${voll?';opacity:.35':''}">${w}</button>`;
  }
  function assignRow(p){
    const wert=APP.teamAssign[p.name];
    const slot=teamOf(wert);
    const rel=reliability(p.name);const rc=relColor(rel);
    const ap=avgPts(p.name);
    const rs=regStats(p.name,'2026-05-08');
    const rsColor=rs.reg===0?'var(--tx3)':rs.played===rs.reg?'var(--win)':rs.played===0?'var(--loss)':'var(--acc)';
    const safe=p.name.replace(/'/g,"\\'");
    const gd=calcGrowthAll(p.name);
    const pt=(tier,val)=>`<span>${tier} <strong>${val||'–'}</strong>${gd[tier.toLowerCase()].projected!==null?` <span style="color:var(--tx3);font-weight:400">(~${gd[tier.toLowerCase()].projected}M)</span>`:''}</span>`;
    const rolle=slot?rolleVon(p.name,slot==='A'?groupsA:groupsB):null;
    const rolleBadge=rolle?`<span style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;background:${rolle.color}22;color:${rolle.color};margin-left:4px;white-space:nowrap">${rolle.label}</span>`:'';
    // Vorschlag, keine Vorgabe: der Zähler steht neben dem Namen, damit sichtbar
    // ist, wer schon mehrfach leer ausging. Die Einteilung macht weiterhin der Mensch.
    const prio=prioOf(p.name);
    const prioBadge=prio>0?`<span title="${prio}× angemeldet ohne Platz — bei der Einteilung bevorzugen" style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;background:#8e44ad22;color:#8e44ad;white-space:nowrap">⭐ Prio ${prio}</span>`:'';
    const tc=wert==='C'?'#8e44ad':slot==='A'?'#2980b9':slot==='B'?'#e67e22':'var(--tx3)';
    return`<div class="mi" style="${closed&&!wert?'opacity:.38':''}">
      ${(()=>{const fb=`<div class="mav" style="background:${wert==='C'?'#f3e9f8':slot==='A'?'#e8f4fd':slot==='B'?'#fdf0e8':'var(--bg2)'};color:${tc};font-size:${wert&&wert.length>1?11:13}px;font-weight:800">${wert||'–'}</div>`;
        if(!avatarUrl(p.name))return fb;
        return`<div style="position:relative;flex-shrink:0;width:38px;height:38px">
          ${avatarImg(p.name,38,'border-radius:8px',fb)}
          <span style="position:absolute;right:-2px;bottom:-2px;min-width:15px;height:15px;border-radius:8px;background:${tc};color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--card);padding:0 2px">${wert||'–'}</span>
        </div>`;})()}
      <div style="flex:1;min-width:0">
        <div class="mn" style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${safe}')">${p.name}</span>${rankBadge(p.role||'R3')}${rolleBadge}${prioBadge}</div>
        <div class="mm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
          ${pt('T1',p.t1)}${p.t2?pt('T2',p.t2):''}${p.t3?pt('T3',p.t3):''}${p.t4?pt('T4',p.t4):''}
          <span style="color:${rc}">Quote <strong>${rel!==null?rel+'%':'Neu'}</strong></span>
          <span>Ø <strong>${ap?fmtK(ap):'-'}</strong></span>
          <span style="color:${rsColor}">Seit 08.05 <strong>${rs.played}/${rs.reg}</strong>${rs.reg>0&&rs.played===0?'<span style="font-size:8px;color:var(--loss);font-weight:800;background:rgba(231,76,60,.12);padding:1px 3px;border-radius:3px;margin-left:3px">ABWESEND</span>':''}</span>
          ${(()=>{
            // Wie oft er insgesamt eingeteilt war — gesetzt vor dem Schrägstrich,
            // Ersatz dahinter. Erspart beim Einteilen den Weg ins Profil.
            const e=bilanz[p.name]||EINSATZ_LEER;
            const cGes=prioCGesamt(p.name);
            if(!(e.ws.gesetzt||e.ws.ersatz||e.cs.gesetzt||e.cs.ersatz||cGes))return'';
            // Bewusst ohne <strong> mittendrin: jedes Element zerschneidet den
            // Textknoten, und die Anzeigeschicht übersetzt je Knoten — die Zeile
            // stünde sonst auf Englisch halb deutsch da.
            return`<span style="font-weight:600${cGes?';color:#8e44ad':''}" title="Bisher eingeteilt: gesetzt/Ersatz je Event, dazu wie oft insgesamt auf Team C">Bisher WS ${e.ws.gesetzt}/${e.ws.ersatz} · CS ${e.cs.gesetzt}/${e.cs.ersatz}${cGes?` · C ${cGes}`:''}</span>`;
          })()}
        </div>
      </div>
      <div style="display:flex;gap:3px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${knopf(p.name,'A','#2980b9','Für Team A anmelden (gesetzt)')}
        ${knopf(p.name,'AE','#2980b9','Für Team A als Ersatzspieler einplanen')}
        ${knopf(p.name,'B','#e67e22','Für Team B anmelden (gesetzt)')}
        ${knopf(p.name,'BE','#e67e22','Für Team B als Ersatzspieler einplanen')}
        ${knopf(p.name,'C','#8e44ad','Angemeldet, aber kein Platz unter den 30 — zählt in der Prioliste')}
        ${wert?`<button class="btn btn-sm btn-out" title="Aus der Anmeldung nehmen" style="padding:4px 7px;font-size:12px;color:var(--tx3)" onclick="setTeamAssign('${safe}',null)">✕</button>`:''}
      </div>
    </div>`;
  }
  let h=``;
  // Hinweis: Schluchtsturm hat eine eigene, unabhängige Team-Einteilung
  if(canAccess('cs')){
    const csN=Object.values(APP.csTeamAssign||{}).filter(Boolean).length;
    h+=`<div class="note info" style="cursor:pointer" onclick="nav('cs');APP.csView='anmeldung';renderPage()">
      ℹ <strong>Nur für den Wüstensturm.</strong> Der Schluchtsturm hat eine eigene Team-Einteilung
      (aktuell ${csN} Spieler) — hier tippen, um dorthin zu wechseln.
    </div>`;
  }
  // Upload area
  h+=`<div class="card" style="margin-bottom:10px"><div class="ch">Screenshot hochladen <span class="ch-sub">Anmeldeliste aus dem Spiel</span></div>
    <div class="cb"><div class="upl" onclick="document.getElementById('ssUp').click()">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <div class="upl-t">Screenshot Anmeldeliste</div><div class="upl-s">OCR liest Spielernamen · oder manuell unten zuweisen</div>
      <input type="file" id="ssUp" accept="image/*" style="display:none" onchange="handleSSUp(this)">
    </div></div></div>`;
  // Zusammenfassung und Knöpfe in getrennten Reihen — nebeneinander quetscht sich
  // die Zusammenfassung am Handy in eine schmale Spalte und wird unlesbar.
  h+=`<div style="margin-bottom:10px">
    <div style="font-size:13px;font-weight:700;margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap">
      <span>Team A: <strong style="color:#2980b9">${belegt('A')}/${WS_MAX_GESETZT}</strong> <span style="font-weight:600;color:var(--tx3)">+ ${belegt('AE')}/${WS_MAX_ERSATZ} Ersatz</span></span>
      <span>Team B: <strong style="color:#e67e22">${belegt('B')}/${WS_MAX_GESETZT}</strong> <span style="font-weight:600;color:var(--tx3)">+ ${belegt('BE')}/${WS_MAX_ERSATZ} Ersatz</span></span>
      <span style="color:#8e44ad">Ohne Platz: <strong>${tc.length}</strong></span>
      <span style="color:var(--tx3);font-weight:600">Offen: ${tn.length}</span>
    </div>
    <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">
      Mit A oder B meldest du jemanden gesetzt an (je ${WS_MAX_GESETZT}), mit AE oder BE als Ersatzspieler (je ${WS_MAX_ERSATZ}). Wer angemeldet war, aber keinen dieser ${WS_MAX_GESETZT+WS_MAX_ERSATZ} Plätze bekommt, kommt auf C — das zählt im Reiter „⭐ Prio" hoch und er wird nächste Woche vorgeschlagen. Die ${wsFixedCount()} stärksten Gesetzten je Team sind automatisch fest dabei (Anzahl änderbar in der Aufstellung unter „⚙ Erweitert").
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <button class="btn btn-out btn-sm" onclick="resetWSAnmeldung()" title="Team-Einteilung und Aufstellungen für die neue Woche löschen">↺ Neue Woche</button>
      ${!closed?`<button class="btn btn-ok btn-sm" onclick="wsCloseAnmeldung()">Anmeldung schließen</button>`
      :`<span style="color:var(--win);font-weight:700;font-size:12px">✓ Anmeldung geschlossen</span><button class="btn btn-out btn-sm" onclick="wsReopenAnmeldung()">Öffnen</button>`}
    </div>
  </div>`;
  {// Anmeldeschluss-Hinweis: vorher die verbleibende Zeit, nachher der fixierte Kader.
   const fixA=wsIstFixiert(friday,'A'),fixB=wsIstFixiert(friday,'B');
   const schluss=wsAnmeldeschluss(friday);
   // Haupt (fest + Rotation), Ersatz und Warteliste getrennt ausweisen — sonst
   // liest sich ein Kader aus 18 Hauptspielern und 4 Ersatz wie 22 Startplätze.
   const kaderZahl=t=>{
     const g=wsRosterGroups(t);
     const haupt=g.fest.length+g.rotationHaupt.length;
     return haupt+(g.rotationErsatz.length?' +'+g.rotationErsatz.length+' Ersatz':'')+(g.warteliste.length?' · '+g.warteliste.length+' Warteliste':'');
   };
   const zeit=schluss.toLocaleString(LOC(),{weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
   if(fixA||fixB){
     h+=`<div class="note ok" style="margin-bottom:10px">
       <div>🔒 <strong>Kader steht fest</strong></div>
       <div style="margin-top:3px">${zeit} · Team A: ${fixA?kaderZahl('A'):'offen'} · Team B: ${fixB?kaderZahl('B'):'offen'}</div>
       <div style="margin-top:3px">Spätere Änderungen an der Anmeldung ändern daran nichts.</div>
     </div>`;
   }else if(!closed){
     h+=`<div class="note" style="margin-bottom:10px">
       <div>⏳ <strong>Anmeldeschluss ${zeit}</strong></div>
       <div style="margin-top:3px">Danach wird der Kader automatisch berechnet und in die Datenbank geschrieben.</div>
     </div>`;
   }}
  if(closed){
    h+=`<div class="note info" style="margin-bottom:10px">Anmeldung abgeschlossen · <strong>${ta.length}</strong> Spieler für Team A · <strong>${tb.length}</strong> für Team B · Weiter zur Aufstellung.</div>`;}
  // Player list — nach Team gruppiert. Die Rolle (Fest/Rotation/Ersatz/
  // Warteliste) steht pro Spieler als Badge, damit vor dem Einfrieren schon
  // sichtbar ist, wer aktuell einen Platz hätte.
  h+=`<div class="card">`;
  const kopf=(txt,farbe,bg,rand)=>`<div style="padding:7px 14px 3px;font-size:11px;font-weight:800;color:${farbe};background:${bg};border-bottom:1px solid ${rand}">── ${txt} ──</div>`;
  if(ta.length){h+=kopf(`Team A (${ta.length} angemeldet${eZahl(ta)?`, davon ${eZahl(ta)} Ersatz`:''})`,'#2980b9','#e8f4fd33','#2980b922');ta.forEach(p=>{h+=assignRow(p);});}
  if(tb.length){h+=kopf(`Team B (${tb.length} angemeldet${eZahl(tb)?`, davon ${eZahl(tb)} Ersatz`:''})`,'#e67e22','#fdf0e833','#e67e2222');tb.forEach(p=>{h+=assignRow(p);});}
  if(tc.length){h+=kopf(`Angemeldet, aber kein Platz (${tc.length})`,'#8e44ad','#f3e9f833','#8e44ad22');tc.forEach(p=>{h+=assignRow(p);});}
  if(tn.length){h+=kopf(`Noch nicht angemeldet (${tn.length})`,'var(--tx3)','var(--bg2)','var(--bd)');tn.forEach(p=>{h+=assignRow(p);});}
  h+=`</div>`;
  return h;
}
// Von Hand vorzeitig schließen — dieselbe Fixierung wie der Donnerstags-Schnitt,
// nur ohne auf die Uhrzeit zu warten.
export async function wsCloseAnmeldung(){
  const friday=getNextFriday();
  const zahl=w=>Object.values(APP.teamAssign||{}).filter(v=>v===w).length;
  if(!confirm('Anmeldung jetzt schließen?\n\n'
    +'· Team A: '+zahl('A')+' gesetzt, '+zahl('AE')+' Ersatz\n'
    +'· Team B: '+zahl('B')+' gesetzt, '+zahl('BE')+' Ersatz\n'
    +'· Ohne Platz (C): '+zahl('C')+'\n\n'
    +'Die '+wsFixedCount()+' stärksten Gesetzten je Team werden automatisch fest gesetzt, der Rest rotiert. '
    +'Der Kader wird in die Datenbank geschrieben und ist danach für das Event vom '+friday+' fix.\n\n'
    +'Die Prioliste wird dabei fortgeschrieben: +1 für jeden auf C, -1 für jeden mit Platz.'))return;
  APP.anmeldungClosed=true;
  APP.accepted=[...new Set(Object.entries(APP.teamAssign||{}).filter(([,v])=>teamOf(v)).map(([k])=>k))];
  saveWSState();renderPage();
  try{
    const res=await wsFreezeRoster(friday);
    const[ev,pa]=await Promise.all([sbGet('ws_events?order=event_date.desc,team.asc'),sbGet('ws_participation?order=rank.asc')]);
    APP.data.events=ev;APP.data.participation=pa;
    await wsPrioVerrechnen(friday).catch(e=>console.warn('Prioliste:',(e&&e.message)||e));
    renderPage();
    const leer=res.filter(r=>r.status==='leer').map(r=>r.team);
    if(leer.length)alert('Hinweis: Für Team '+leer.join(' und ')+' ist niemand eingeteilt — dieser Kader wurde nicht festgeschrieben.');
  }catch(e){alert('Der Kader konnte nicht in die Datenbank geschrieben werden:\n'+(e&&e.message||e));}
}
// Wieder öffnen: Sperre lösen und den unberührten Kader entfernen. Zeilen, an denen
// schon gearbeitet wurde (gespielt markiert oder Punkte eingetragen), bleiben stehen —
// sonst wäre ein versehentliches Öffnen ein Datenverlust.
export async function wsReopenAnmeldung(){
  const friday=getNextFriday();
  if(!confirm('Anmeldung wieder öffnen?\n\nDer festgeschriebene Kader für den '+friday+' wird entfernt.\nBereits erfasste Teilnahmen und Punkte bleiben erhalten.'))return;
  APP.anmeldungClosed=false;saveWSState();
  try{
    const evs=await sbGet('ws_events?event_date=eq.'+encodeURIComponent(friday));
    for(const ev of evs){
      if(!ev.roster_locked_at)continue;
      await sbDelete('ws_participation','event_id=eq.'+ev.id+'&played=is.false&individual_pts=is.null');
      await sbPatch('ws_events','id=eq.'+ev.id,{roster_locked_at:null});
    }
    const[e2,p2]=await Promise.all([sbGet('ws_events?order=event_date.desc,team.asc'),sbGet('ws_participation?order=rank.asc')]);
    APP.data.events=e2;APP.data.participation=p2;
  }catch(e){alert('Die Fixierung konnte nicht zurückgenommen werden:\n'+(e&&e.message||e));}
  renderPage();
}
// Der lokale Puffer trägt die Allianz im Schlüssel — sonst zeigte ein Wechsel der
// Ansicht die Aufstellung der vorigen Allianz (siehe core/tenant.js: lsKey).
export const LS_BASE='warsync_ws_state';
export const LS_KEY=()=>lsKey(LS_BASE);
// Wochen-Reset, gleiches Verhalten wie csResetWoche(): Team-Einteilung UND
// beide Aufstellungen. Die Aufstellungen müssen mit weg — sie hängen an der
// Einteilung, blieben sonst mit den Spielern der Vorwoche stehen und würden
// über APP.accepted sogar wieder als Auto-Verteil-Pool herhalten.
// Unberührt bleiben Gebäude-Reihenfolge, Gebäude-Slots und die Mail-Texte.
export function resetWSAnmeldung(){
  const belegt=Object.values(APP.teamAssign).filter(Boolean).length;
  const leer={ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]};
  const plaene=['A','B'].reduce((s,t)=>s+Object.values(getLineup(t)||{}).flat().length,0);
  if(!confirm('Wüstensturm für die neue Woche zurücksetzen?\n\n'
    +'· Team-Einteilung ('+belegt+' Spieler) wird geleert\n'
    +'· Aufstellungen beider Teams ('+plaene+' Zuweisungen) werden verworfen\n\n'
    +'Gebäude-Reihenfolge, Gebäude-Slots, Startzeiten und die Mail-Texte bleiben erhalten.'))return;
  APP.teamAssign={};APP.anmeldungClosed=false;
  APP.lineupA={...leer};APP.lineupB={...leer};
  APP.lineupReadyA=false;APP.lineupReadyB=false;
  APP.bldAssign={};APP.bldAssignPh2={};
  APP.selectedChip=null;
  // zurück auf den Stand eines frischen Ladens, sonst dient die Liste der
  // Vorwoche der Auto-Aufstellung weiter als Rückfall-Pool
  APP.accepted=APP.data.players.filter(p=>p.active!==false).map(p=>p.name);
  saveWSState();renderPage();
}
export function saveWSState(){
  const payload={
    savedAt:new Date().toISOString(),
    wsStateWeek:getNextFriday(),
    teamAssign:APP.teamAssign,
    wsTime:APP.wsTime,
    anmeldungClosed:APP.anmeldungClosed,
    lineupA:APP.lineupA,lineupB:APP.lineupB,
    lineupReadyA:APP.lineupReadyA,lineupReadyB:APP.lineupReadyB,
    bldSlotsA:APP.bldSlotsA,bldSlotsB:APP.bldSlotsB,
    buildingOrder:APP.buildingOrder,bldAssign:APP.bldAssign,bldAssignPh2:APP.bldAssignPh2,
    stratCardOpen:APP.stratCardOpen,
    mailText:APP.mailText,
    mailGeneral:APP.mailGeneral,
    teamSide:APP.teamSide,
    infoCardOpen:APP.infoCardOpen,
    wsStrength:APP.wsStrength,
  };
  try{localStorage.setItem(LS_KEY(),JSON.stringify(payload));}catch(e){}
  plannerPush('ws',payload);
}
export function loadWSState(){
  try{
    const s=plannerResolve('ws',LS_KEY());
    if(!s)return;
    if(s.teamSide)APP.teamSide=s.teamSide;
    if(s.infoCardOpen!==undefined)APP.infoCardOpen=s.infoCardOpen;
    if(s.wsStrength==='hero'||s.wsStrength==='t1')APP.wsStrength=s.wsStrength;
    if(s.teamAssign&&typeof s.teamAssign==='object')APP.teamAssign=s.teamAssign;
    // Nur bekannte Werte übernehmen (REG_WERTE): 'A'/'B' gesetzt, 'AE'/'BE' als
    // Ersatz eingeplant, 'C' angemeldet ohne Platz. Alles andere käme aus einem
    // Stand, den es nicht mehr gibt, und fiele erst später als unsichtbar
    // fehlender Spieler auf — dieselbe Regel wie im Schluchtsturm.
    Object.keys(APP.teamAssign).forEach(n=>{
      if(!REG_WERTE.includes(APP.teamAssign[n]))delete APP.teamAssign[n];
    });
    // Nur gültige Zeiten übernehmen — ein alter oder verdorbener Stand darf keine
    // Uhrzeit hinterlassen, für die es keinen Knopf mehr gibt.
    if(s.wsTime&&typeof s.wsTime==='object'){
      ['A','B'].forEach(t=>{if(WS_ZEITEN.includes(s.wsTime[t]))APP.wsTime[t]=s.wsTime[t];});
    }
    if(s.anmeldungClosed!==undefined)APP.anmeldungClosed=s.anmeldungClosed;
    // Auto-Reset: Wenn der gespeicherte WS-Freitag in der Vergangenheit liegt → neue Woche
    {const _today=new Date().toISOString().slice(0,10);if(s.wsStateWeek&&_today>s.wsStateWeek){APP.teamAssign={};APP.anmeldungClosed=false;}}
    if(s.lineupA)APP.lineupA=s.lineupA;
    if(s.lineupB)APP.lineupB=s.lineupB;
    if(s.lineupReadyA!==undefined)APP.lineupReadyA=s.lineupReadyA;
    if(s.lineupReadyB!==undefined)APP.lineupReadyB=s.lineupReadyB;
    // Aktuelle bldSlots-Felder
    if(s.bldSlotsA)APP.bldSlotsA={...APP.bldSlotsA,...s.bldSlotsA};
    if(s.bldSlotsB)APP.bldSlotsB={...APP.bldSlotsB,...s.bldSlotsB};
    // Migration: alte zoneSlotsA/B + arsSlots/soldSlots → bldSlotsA/B
    ['A','B'].forEach(team=>{
      const oldZone=s['zoneSlots'+team];
      const target=APP['bldSlots'+team];
      // Pro Zone Summe → auf primäres Gebäude allokieren, Rest auf sekundäres (gleichmäßig)
      function distribute(z,bldA,bldB){
        if(!oldZone||oldZone[z]===undefined||s.bldSlotsA||s.bldSlotsB)return;
        const total=oldZone[z]||0;
        target[bldA]=Math.ceil(total/2);
        target[bldB]=Math.floor(total/2);
      }
      distribute('z1','oelraf1','infozentrum');
      distribute('z2','laz2','laz4');
      distribute('z3','oelraf2','sciencehub');
      distribute('z4','laz1','laz3');
      if(!s.bldSlotsA&&!s.bldSlotsB){
        if(oldZone&&oldZone.ass!==undefined)target.silo=oldZone.ass;
        if(oldZone&&oldZone.sup!==undefined)target.oelquellen=oldZone.sup;
      }
    });
    if(Array.isArray(s.buildingOrder)&&s.buildingOrder.length)APP.buildingOrder=s.buildingOrder;
    if(s.bldAssign&&typeof s.bldAssign==='object')APP.bldAssign=s.bldAssign;
    if(s.bldAssignPh2&&typeof s.bldAssignPh2==='object')APP.bldAssignPh2=s.bldAssignPh2;
    if(s.stratCardOpen!==undefined)APP.stratCardOpen=s.stratCardOpen;
    // Arsenal- und Söldner-Rolle gibt es nicht mehr. Gespeicherte Stände können beides
    // noch enthalten — ohne die Stepper käme man an die Werte nicht mehr heran, und die
    // betroffenen Spieler wären in keiner Zone mehr sichtbar. Deshalb hier hart auf 0
    // ziehen und die Spieler freigeben: sie tauchen dann unter „Nicht verteilt" auf.
    ['A','B'].forEach(t=>{
      const bs=APP['bldSlots'+t];
      if(bs){bs.arsenal=0;bs.soeldner=0;}
      const L=APP['lineup'+t];
      if(L){L.ars=[];L.sold=[];}
    });
    if(s.mailText)APP.mailText=s.mailText;
    if(typeof s.mailGeneral==='string'){
      // Migration: alten langen Default-Text aus localStorage werfen (begann mit "🏜 Wüstensturm – Taktik")
      APP.mailGeneral=s.mailGeneral.startsWith('🏜 Wüstensturm – Taktik')?'':s.mailGeneral;
    }
    // Einmalige Migration: stale teamAssign-Einträge alter hardcodierter Inaktiv-Spieler entfernen
    if(!localStorage.getItem('ws_mig_v2')){
      ['ChrisPiii','Dani3371','Goramar','Hurikan666','Kogse','Lulllull',
       'MaidenofShadows','saltycereal','Sol Aeternus','StylesX','Vikotnik','xArticulate','xcape']
      .forEach(n=>{delete APP.teamAssign[n];});
      localStorage.setItem('ws_mig_v2','1');
      saveWSState();
    }
  }catch(e){console.warn('loadWSState parse-Fehler — gespeicherter Stand bleibt unverändert:',e);}
}
// `slot` ist einer der fünf Werte aus REG_WERTE oder null (abmelden). Ein
// erneuter Klick auf denselben Knopf meldet ab.
//
// Gesetzt und Ersatz sind hart begrenzt (20 + 10 je Team): ohne die Grenze
// stünden 39 Leute auf „gesetzt" und es wäre nicht mehr zu erkennen, wer den
// Platz tatsächlich hat. Wer keinen bekommt, gehört auf 'C' — das ist
// unbegrenzt und füttert die Prioliste.
export function setTeamAssign(name,slot){
  if(slot&&APP.teamAssign[name]===slot)slot=null;
  if(slot&&!REG_WERTE.includes(slot))return;
  if(slot){
    const meldung=regPlatzPruefen(APP.teamAssign,name,slot,WS_MAX_GESETZT,WS_MAX_ERSATZ);
    if(meldung){alert(meldung);return;}
    APP.teamAssign[name]=slot;
  }
  else delete APP.teamAssign[name];
  saveWSState();
  renderPage();
}
export function toggleAccept(name){
  if(APP.accepted.includes(name))APP.accepted=APP.accepted.filter(n=>n!==name);
  else APP.accepted.push(name);renderPage();}
export function acceptAll(){APP.accepted=APP.data.players.filter(p=>!isInactive(p.name)).map(p=>p.name);renderPage();}
export function rejectAll(){APP.accepted=[];renderPage();}
export function handleSSUp(){alert('Screenshot erkannt!\nOCR-Analyse: Spielernamen werden erkannt und automatisch zugewiesen (folgt in V2).');}

// --- SPIELER (Liste + Profil) ---
export function wsSpieler(){
  if(APP.selectedPlayer)return wsPlayerProfile(APP.selectedPlayer);
  const pl=APP.data.players;
  const sorted=sortPlayers(pl);
  const active=pl.filter(p=>!isInactive(p.name)).length;
  const s=APP.playerSort;

  const SORTS=[
    {k:'t1',l:'T1 ↓'},
    {k:'hero_power',l:'🦸 Heldenkraft'},
    {k:'kills',l:'⚔ Kills'},
    {k:'popularity',l:'❤ Beliebtheit'},
    {k:'profession_level',l:'Beruf-Lvl'},
    {k:'reliability',l:'Quote'},
    {k:'name',l:'A–Z'},
  ];

  function profInfo(p){
    const prof=p.profession||'Ingenieur';
    const isK=prof==='Kriegsführer';
    return{prof,isK,icon:isK?'⚔':'🔧',color:isK?'var(--ass)':'var(--primary)',bg:isK?'var(--ass-l)':'var(--pri-l)'};
  }

  function playerRow(p){
    const inactive=isInactive(p.name);
    const rel=reliability(p.name);
    const {prof,isK,icon,color,bg}=profInfo(p);
    const pRole=inactive?null:(p.role||'R3');
    const lastHist=(APP.playerHistory[p.name]||[])[0];
    const lastUpd=lastHist?.recorded_at?lastHist.recorded_at.slice(0,10):null;
    const updTag=s==='t1'?(lastUpd
      ?`<span style="font-size:10px;color:var(--tx3);white-space:nowrap;font-weight:400">↻ ${lastUpd}</span>`
      :`<span style="font-size:10px;color:#e67e22;white-space:nowrap;font-weight:400">↻ nie</span>`):'';
    const stats=[
      p.t1?`<span style="white-space:nowrap">T1 <strong>${p.t1}M</strong>${updTag}</span>`:'',
      hqBadge(p),
      p.hero_power?`<span style="white-space:nowrap">🦸 ${fmtK(p.hero_power)}</span>`:'',
      p.kills?`<span style="white-space:nowrap">${icon} ${fmtK(p.kills)}</span>`:'',
      p.popularity?`<span style="white-space:nowrap">❤ ${fmt(p.popularity)}</span>`:'',
      p.profession_level?`<span style="white-space:nowrap;color:${inactive?'#aaa':color}">${prof==='Kriegsführer'?'⚔':'🔧'} Lv.${p.profession_level}</span>`:'',
    ].filter(Boolean).join('<span style="color:var(--bd2);margin:0 1px"> · </span>');
    return`<div class="mi" style="cursor:pointer;${inactive?'opacity:.42;background:#f9f9f9':''}" onclick="APP.selectedPlayer='${p.name.replace(/'/g,"\\'")}';renderPage()">
      ${avatarImg(p.name,38,'border-radius:8px',`<div class="mav" style="background:${inactive?'#eee':bg};color:${inactive?'#bbb':color};font-size:16px">${inactive?'✕':icon}</div>`)}
      <div style="flex:1;min-width:0">
        <div class="mn" style="display:flex;align-items:center;gap:6px;${inactive?'color:var(--tx3);text-decoration:line-through':isK?'color:var(--ass)':''}">
          ${p.name}${genderMark(p)}${pRole?rankBadge(pRole):''}
        </div>
        <div class="mm" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;align-items:center">
          ${inactive?'<span style="color:#e67e22;font-size:11px;font-weight:700">⚠ Ausgetreten</span>':stats||'<span style="color:var(--tx3)">Keine Daten</span>'}
        </div>
      </div>
      <div class="mr" style="flex-shrink:0">
        <span style="font-size:12px;font-weight:700;color:${inactive?'#ccc':relColor(rel)}">${inactive?'–':rel!==null?rel+'%':'Neu'}</span>
        <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--tx3);stroke-width:2;fill:none"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }

  const GROUP_META={R5:{label:'R5 · Präsident',c:'#f39c12'},R4:{label:'R4 · Offiziere',c:'#9b59b6'},R3:{label:'R3 · Mitglieder',c:'#7f8c8d'},inactive:{label:'Ausgetreten',c:'#bdc3c7'}};
  function groupHeader(role){const m=GROUP_META[role]||{label:role,c:'#8892a4'};return`<div style="padding:8px 14px 4px;font-size:11px;font-weight:800;color:${m.c};letter-spacing:.6px;background:${m.c}11;border-bottom:1px solid ${m.c}33">── ${m.label} ──</div>`;}

  let h=``;
  // Sort buttons
  h+=`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
    ${SORTS.map(b=>`<button class="btn btn-sm ${s===b.k?'btn-sol':'btn-out'}" style="padding:5px 10px;font-size:12px" onclick="APP.playerSort='${b.k}';renderPage()">${b.l}</button>`).join('')}
  </div>`;
  // Summary
  h+=`<div class="note info" style="margin-bottom:10px;padding:8px 12px;font-size:12px">
    <strong>${active} aktive Spieler</strong> · ${pl.length-active} ausgetreten · ${pl.length} gesamt · Antippen für Profil
  </div>`;
  // Grouped player list
  let listHtml='';let lastGroup=null;
  sorted.forEach(p=>{
    const g=isInactive(p.name)?'inactive':(p.role||'R3');
    if(g!==lastGroup){listHtml+=groupHeader(g);lastGroup=g;}
    listHtml+=playerRow(p);
  });
  h+=`<div class="card">${listHtml}</div>`;
  return h;
}

export function wsPlayerProfile(name){
  const p=APP.data.players.find(x=>x.name===name);
  if(!p)return`<div class="loader">Spieler nicht gefunden.</div>`;
  // Nur Wüstensturm — Schluchtsturm nutzt dieselbe Tabelle (mode='cs') und hat
  // hier keine eigene Profilansicht.
  const allParts=APP.data.participation.filter(x=>{
    if(x.player_name!==name)return false;
    const ev=APP.data.events.find(e=>e.id===x.event_id);
    return ev&&ev.mode==='ws';
  });
  const allEvts=allParts.map(x=>({...x,ev:APP.data.events.find(e=>e.id===x.event_id)})).filter(x=>x.ev).sort((a,b)=>b.ev.event_date.localeCompare(a.ev.event_date));
  const played=allParts.filter(x=>x.played);
  const missed=allParts.filter(x=>!x.played&&!x.excused);
  const excused=allParts.filter(x=>x.excused);
  const rel=allParts.length?Math.round(played.length/allParts.length*100):null;
  const ap=played.filter(x=>x.individual_pts).reduce((s,x)=>s+(x.individual_pts||0),0);
  const apCount=played.filter(x=>x.individual_pts).length;
  const avgP=apCount?Math.round(ap/apCount):0;
  const evtsWon=allEvts.filter(x=>x.played&&x.ev?.result==='win').length;
  const evtsLost=allEvts.filter(x=>x.played&&x.ev?.result==='loss').length;
  const bestRank=played.filter(x=>x.rank).reduce((m,x)=>x.rank<m?x.rank:m,999);

  const inactive=isInactive(name);
  const canEdit=canAccess('profile_edit');
  const safeName=name.replace(/'/g,"\\'");
  let h=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <button class="btn btn-out btn-sm" onclick="APP.selectedPlayer=null;renderPage()">← Alle Spieler</button>
    ${canEdit&&!inactive?`<button class="btn btn-sol btn-sm" onclick="APP.selectedPlayer=null;APP.allianzPlayer='${safeName}';APP.allianzPlayerEdit=true;APP.allianzParsed=null;APP.allianzParsedSel={};nav('allianz')">✏ Profil bearbeiten</button>`:''}
  </div>`;
  if(inactive)h+=`<div class="note" style="margin-bottom:10px;border-left-color:#e67e22;background:#fef9f0">⚠️ <strong>Nicht mehr in der Allianz</strong> — Historische Daten aus früheren WS-Läufen.${canAccess('admin')?`<button class="btn btn-out btn-sm" style="margin-top:8px;width:100%;color:var(--win);border-color:var(--win)" onclick="apdSetActive('${safeName}')">↩ Spieler reaktivieren</button>`:''}</div>`;
  h+=`<div style="display:flex;align-items:center;gap:13px;margin-bottom:16px;${inactive?'opacity:.7':''}">
    ${avatarImg(name,52,'border-radius:16px',`<div style="width:52px;height:52px;border-radius:16px;background:${inactive?'#ccc':'var(--primary)'};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0">${name.charAt(0)}</div>`)}
    <div><div style="font-size:18px;font-weight:800;${inactive?'color:var(--tx3);text-decoration:line-through':''}">${name}</div>
    <div style="margin-top:4px;display:flex;gap:5px;flex-wrap:wrap">
      ${inactive?`<span style="font-size:11px;font-weight:700;color:#e67e22;background:#fef0e0;padding:3px 8px;border-radius:6px">Ausgetreten</span>`:''}
      ${p.team&&!inactive?badge('Team '+p.team,p.team==='A'?'var(--win)':'#2980b9'):''}
      ${rel!==null?`<span style="font-size:11px;font-weight:700;color:${relColor(rel)};background:${relColor(rel)}22;padding:3px 8px;border-radius:6px">${rel}% Quote</span>`:''}
    </div></div>
  </div>`;

  // Spieler-Info (Beruf, Kills, Beliebtheit)
  const profP=p.profession||'Ingenieur';const isKP=profP==='Kriegsführer';
  if(profP||p.kills||p.popularity||p.profession_level){
    h+=`<div class="card" style="margin-bottom:10px"><div class="ch">Spieler-Info</div><div style="padding:12px"><div class="kk-grid">
      <div class="kk-box" style="${isKP?'border:1.5px solid var(--ass);background:var(--ass-l)':''}"><div class="kk-l">Beruf</div><div class="kk-v" style="font-size:14px;color:${isKP?'var(--ass)':'var(--primary)'}">${isKP?'⚔ Kriegsführer':'🔧 Ingenieur'}</div></div>
      ${p.level?`<div class="kk-box"><div class="kk-l">Basis-Level</div><div class="kk-v">${p.level}</div></div>`:''}
      ${GENDER_SYM[p.gender]?`<div class="kk-box"><div class="kk-l">Geschlecht</div><div class="kk-v" style="color:${GENDER_SYM[p.gender].c}">${GENDER_SYM[p.gender].s} ${GENDER_SYM[p.gender].t}</div></div>`:''}
      ${p.profession_level?`<div class="kk-box"><div class="kk-l">Beruf-Level</div><div class="kk-v">${p.profession_level}</div></div>`:''}
      ${p.kills?`<div class="kk-box"><div class="kk-l">Kills</div><div class="kk-v">${fmtK(p.kills)}</div></div>`:''}
      ${p.popularity?`<div class="kk-box"><div class="kk-l">❤ Beliebtheit</div><div class="kk-v">${fmt(p.popularity)}</div></div>`:''}
    </div></div></div>`;
  }
  // Strength box
  if(p.t1||p.t2||p.t3||p.hero_power){
    h+=`<div class="card" style="margin-bottom:10px"><div class="ch">Truppenstärke</div><div style="padding:12px"><div class="kk-grid">
      ${p.t1?`<div class="kk-box"><div class="kk-l">T1</div><div class="kk-v">${p.t1} M</div></div>`:''}
      ${p.t2?`<div class="kk-box"><div class="kk-l">T2</div><div class="kk-v">${p.t2} M</div></div>`:''}
      ${p.t3?`<div class="kk-box"><div class="kk-l">T3</div><div class="kk-v">${p.t3} M</div></div>`:''}
      ${p.t4?`<div class="kk-box"><div class="kk-l">T4</div><div class="kk-v">${p.t4} M</div></div>`:''}
      ${p.total_power?`<div class="kk-box" style="grid-column:1/-1"><div class="kk-l">Gesamtkampfkraft</div><div class="kk-v" style="font-size:18px">${fmt(p.total_power)}</div></div>`:''}
            ${p.hero_power?`<div class="kk-box" style="grid-column:1/-1;border-color:var(--ass)"><div class="kk-l">🦸 Gesamtkraft der Helden</div><div class="kk-v" style="font-size:18px;color:var(--ass)">${fmtMio(p.hero_power)}</div></div>`:''}
    </div></div></div>`;
  }

  // WS stats
  if(allParts.length){
    h+=`<div class="sg"><div class="sb"><div class="sb-l">Gespielt</div><div class="sb-v" style="color:var(--win)">${played.length}</div><div class="sb-s">von ${allParts.length}</div></div><div class="sb"><div class="sb-l">Siege</div><div class="sb-v" style="color:var(--win)">${evtsWon}</div><div class="sb-s">als aktiver Spieler</div></div><div class="sb"><div class="sb-l">Niederlagen</div><div class="sb-v" style="color:var(--loss)">${evtsLost}</div></div><div class="sb"><div class="sb-l">Ø Punkte</div><div class="sb-v">${fmt(avgP)}</div><div class="sb-s">pro Event</div></div>${missed.length?`<div class="sb"><div class="sb-l">Gefehlt</div><div class="sb-v" style="color:var(--loss)">${missed.length}</div></div>`:''}${excused.length?`<div class="sb"><div class="sb-l">Entschuldigt</div><div class="sb-v" style="color:var(--acc)">${excused.length}</div></div>`:''}</div>`;
  }

  // Event history
  if(allEvts.length){
    h+=`<div class="card"><div class="ch">WS-Verlauf</div>`;
    allEvts.forEach(x=>{
      const ev=x.ev;
      const c=x.played?(ev.result==='win'?'var(--win)':'var(--loss)'):(x.excused?'var(--acc)':'var(--loss)');
      const label=x.played?(ev.result==='win'?'Sieg':'Niederlage'):(x.excused?'Entschuldigt':'Gefehlt');
      h+=`<div class="mi">
        <div style="width:34px;height:34px;border-radius:9px;background:${c}22;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${c};flex-shrink:0">${x.played?(ev.result==='win'?'S':'N'):(x.excused?'E':'F')}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700">${ev.event_date} · Team ${ev.team}</div>
          <div style="font-size:11px;color:var(--tx3)">${ev.opponent||''}${x.zone?' · '+x.zone:''}${x.rank?' · Platz '+x.rank:''}</div>
        </div>
        <div class="mr">
          ${x.individual_pts?`<span style="font-size:13px;font-weight:800">${fmt(x.individual_pts)}</span>`:''}
          ${badge(label,c)}
        </div>
      </div>`;
    });
    h+=`</div>`;
  }else{
    h+=`<div class="note">Noch keine WS-Teilnahme erfasst.</div>`;
  }
  return h;
}

// --- ERGEBNIS ERFASSEN ---
export function wsErfassenView(){
  // Pending Event für dieses Team finden (am nächsten in der Zukunft oder gerade abgelaufen)
  const pendingEvt=[...APP.data.events]
    .filter(e=>e.team===APP.team&&(!e.result||e.result==='pending'))
    .sort((a,b)=>b.event_date.localeCompare(a.event_date))[0]||null;
  // Wer als angemeldet gilt: bei fixiertem Kader die Zeilen aus der Datenbank,
  // sonst wie bisher die aktuelle Aufstellung. Der Unterschied zählt — die
  // Aufstellung ändert sich nach dem Anmeldeschluss noch, der Kader nicht.
  const fixiert=!!(pendingEvt&&pendingEvt.roster_locked_at);
  let regSet;
  if(fixiert){
    regSet=new Set(APP.data.participation.filter(p=>p.event_id===pendingEvt.id&&p.registered!==false).map(p=>p.player_name));
  }else{
    const L=getLineup(APP.team);
    regSet=new Set([...(L.z1||[]),...(L.z2||[]),...(L.z3||[]),...(L.z4||[]),
      ...(L.ass||[]),...(L.ars||[]),...(L.sold||[]),...(L.sup||[])]);
  }
  const defaultDate=pendingEvt?.event_date||new Date().toISOString().split('T')[0];
  const pendingId=pendingEvt?.id||'';
  const players=APP.data.players.filter(p=>!isInactive(p.name)).sort((a,b)=>getT1(b)-getT1(a));
  const pRows=players.map(p=>{
    const safe=p.name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    const isReg=regSet.has(p.name)||regSet.size===0; // wenn kein Kader/Lineup: alle als registriert
    return`<tr style="${isReg?'':'opacity:0.45'}">
      <td style="font-size:13px;font-weight:600">${p.name}</td>
      <td style="text-align:center"><input type="checkbox" id="ef-reg-${safe}" ${isReg?'checked':''} ${fixiert?'disabled title="Kader steht seit dem Anmeldeschluss fest"':''} onchange="efRegChange('${safe}')"></td>
      <td style="text-align:center"><input type="checkbox" id="ef-pld-${safe}"></td>
      <td><input type="number" id="ef-pts-${safe}" class="fi" style="width:110px;text-align:right;padding:3px 6px;font-size:12px;margin:0" placeholder="–" oninput="efPtsInput('${safe}')"></td>
    </tr>`;
  }).join('');
  const pendingNote=pendingEvt?`<div class="note info" style="margin-bottom:12px">Pending Event gefunden: <strong>${pendingEvt.event_date}</strong> · Dieses Event wird mit dem Ergebnis aktualisiert.</div>`:'';
  return`<button class="btn btn-out btn-sm" onclick="APP.wsErfassen=false;renderPage()" style="margin-bottom:12px">← Alle Events</button>
  ${pendingNote}
  <div class="card"><div class="ch">Ergebnis erfassen – Team ${APP.team}</div><div class="cb">
    <input type="hidden" id="ef-pending-id" value="${pendingId}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="fl2"><label>Datum</label><input class="fi" id="ef-date" type="date" value="${defaultDate}"></div>
      <div class="fl2"><label>Gegner</label><input class="fi" id="ef-opp" type="text" placeholder="Allianzname" value="${pendingEvt?.opponent||''}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="fl2"><label>Unsere Punkte</label><input class="fi" id="ef-our" type="number" placeholder="z.B. 327675" oninput="efAutoResult()"></div>
      <div class="fl2"><label>Gegner Punkte</label><input class="fi" id="ef-opp-pts" type="number" placeholder="z.B. 242149" oninput="efAutoResult()"></div>
    </div>
    <div class="fl2"><label>Ergebnis</label>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ok" id="res-win" style="flex:1" onclick="setResult('win')">🏆 Sieg</button>
        <button class="btn btn-no" id="res-loss" style="flex:1" onclick="setResult('loss')">💀 Niederlage</button>
      </div>
    </div>
    <div class="fl2"><label>Screenshots (optional – nur zur Ansicht)</label>
      <input type="file" id="ef-shots" multiple accept="image/*" onchange="efShowPreviews()" style="width:100%;padding:6px 0">
    </div>
    <div id="ef-previews" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
    <div style="font-weight:700;font-size:13px;margin:10px 0 4px;color:var(--tx)">Spieler – Punkte aus Screenshot</div>
    <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Punkte eintragen → Spieler wird automatisch als <strong>Gespielt</strong> markiert. Spieler ohne Punkte aber mit Angem. ✓ → werden als <strong>Abwesend</strong> gespeichert.</div>
    <div class="scroll-x"><table>
      <thead><tr><th>Spieler</th><th style="text-align:center;white-space:nowrap">Angem.</th><th style="text-align:center">Gespielt</th><th style="text-align:right">Punkte</th></tr></thead>
      <tbody>${pRows}</tbody>
    </table></div>
    <button class="btn btn-sol" style="width:100%;margin-top:14px" id="saveRes2" onclick="saveResult2()">Ergebnis speichern</button>
  </div></div>`;
}

export let _resultChoice=null;
export function setResult(r){
  _resultChoice=r;
  document.getElementById('res-win').style.background=r==='win'?'var(--win)':'';
  document.getElementById('res-win').style.color=r==='win'?'#fff':'';
  document.getElementById('res-loss').style.background=r==='loss'?'var(--loss)':'';
  document.getElementById('res-loss').style.color=r==='loss'?'#fff':'';}
export function efAutoResult(){
  const our=parseInt(document.getElementById('ef-our')?.value)||0;
  const opp=parseInt(document.getElementById('ef-opp-pts')?.value)||0;
  if(our&&opp)setResult(our>opp?'win':'loss');
}
export function efShowPreviews(){
  const files=document.getElementById('ef-shots')?.files;
  const box=document.getElementById('ef-previews');
  if(!files||!box)return;
  box.innerHTML='';
  Array.from(files).forEach(f=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=document.createElement('img');
      img.src=e.target.result;
      img.style.cssText='height:200px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer';
      img.onclick=()=>window.open(e.target.result);
      box.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}
export function efRegChange(safe){
  const reg=document.getElementById('ef-reg-'+safe);
  const pld=document.getElementById('ef-pld-'+safe);
  if(reg&&pld&&!reg.checked)pld.checked=false;
}
export function efPtsInput(safe){
  const pts=parseInt(document.getElementById('ef-pts-'+safe)?.value)||0;
  const pld=document.getElementById('ef-pld-'+safe);
  const reg=document.getElementById('ef-reg-'+safe);
  if(pld)pld.checked=pts>0;
  if(pts>0&&reg&&!reg.checked)reg.checked=true; // Punkte eingetragen → automatisch angemeldet+gespielt
}

export async function saveResult2(){
  const date=document.getElementById('ef-date')?.value;
  const opp=document.getElementById('ef-opp')?.value?.trim();
  const our=parseInt(document.getElementById('ef-our')?.value)||null;
  const oppPts=parseInt(document.getElementById('ef-opp-pts')?.value)||null;
  if(!date||!_resultChoice){alert('Bitte Datum und Ergebnis (Sieg/Niederlage) angeben.');return;}
  const btn=document.getElementById('saveRes2');
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    const pendingId=document.getElementById('ef-pending-id')?.value||'';
    let eid;
    if(pendingId){
      // Bestehendes pending Event aktualisieren
      await sbPatch('ws_events','id=eq.'+pendingId,{event_date:date,opponent:opp||null,our_pts:our,opp_pts:oppPts,result:_resultChoice});
      // Früher wurden hier alle Teilnahme-Zeilen gelöscht und neu geschrieben. Das
      // hat den am Donnerstag festgeschriebenen Kader vernichtet: `registered` wurde
      // anschließend aus der *aktuellen* Aufstellung neu abgeleitet, und wer nach dem
      // Anmeldeschluss aus der Aufstellung geflogen ist, galt rückwirkend als nie
      // angemeldet. Jetzt werden bestehende Zeilen aktualisiert statt ersetzt.
      eid=pendingId;
    }else{
      const [newEv]=await sbPostRet('ws_events',{event_date:date,team:APP.team,time_slot:wsZeit(APP.team),opponent:opp||null,our_pts:our,opp_pts:oppPts,result:_resultChoice});
      eid=newEv.id;
    }
    const players=APP.data.players.filter(p=>!isInactive(p.name));
    const ptsArr=[];
    players.forEach(p=>{
      const safe=p.name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const pts=parseInt(document.getElementById('ef-pts-'+safe)?.value)||null;
      if(pts)ptsArr.push({name:p.name,pts});
    });
    ptsArr.sort((a,b)=>b.pts-a.pts);
    const rankMap={};ptsArr.forEach((x,i)=>rankMap[x.name]=i+1);
    const ptsMap=Object.fromEntries(ptsArr.map(x=>[x.name,x.pts]));
    // Bestehende Zeilen holen — sie tragen den fixierten Kader.
    const vorhanden=await sbGet('ws_participation?event_id=eq.'+eid);
    const exMap={};vorhanden.forEach(r=>exMap[r.player_name]=r);
    const evRow=APP.data.events.find(e=>e.id===eid);
    const fixiert=!!(evRow&&evRow.roster_locked_at);
    const neu=[],aend=[];
    players.forEach(p=>{
      const safe=p.name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const reg=document.getElementById('ef-reg-'+safe)?.checked!==false;
      const pts=ptsMap[p.name]||null;
      // Gespielt = Punkte vorhanden ODER Gespielt-Checkbox manuell gesetzt
      const pld=pts>0||!!document.getElementById('ef-pld-'+safe)?.checked;
      const alt=exMap[p.name];
      if(alt){
        const patch={played:pld,individual_pts:pts,rank:rankMap[p.name]||null};
        // Bei fixiertem Kader bleibt `registered` so, wie es zum Anmeldeschluss
        // festgeschrieben wurde — das Ergebnis sagt nur, wer gespielt hat.
        if(!fixiert)patch.registered=reg;
        aend.push({id:alt.id,patch});
      }else{
        // Steht jemand nicht im fixierten Kader, war er nicht angemeldet —
        // auch wenn er mitgespielt hat. Genau diese Fälle sind die interessanten.
        // Bei fixiertem Kader stand der Spieler weder gesetzt noch auf der Bank —
        // sonst hätte er schon eine Zeile. Ohne Fixierung gilt die aktuelle Einteilung.
        // Ersatz/Fest/Warteliste entscheidet ausschließlich das Einfrieren
        // (wsFreezeTeam) — ohne fixierten Kader ist die Rolle schlicht offen.
        neu.push({event_id:eid,player_name:p.name,registered:fixiert?false:reg,played:pld,excused:false,individual_pts:pts,rank:rankMap[p.name]||null,
                  substitute:false});
      }
    });
    for(const a of aend)await sbPatch('ws_participation','id=eq.'+a.id,a.patch);
    for(let i=0;i<neu.length;i+=20)await sbPost('ws_participation',neu.slice(i,i+20));
    alert('✅ Ergebnis gespeichert!');
    _resultChoice=null;
    await loadData();
    APP.wsErfassen=false;APP.wsEventId=eid;
    setWSView('ergebnis');
  }catch(err){
    alert('Fehler: '+err.message);
    const btn=document.getElementById('saveRes2');
    if(btn){btn.textContent='Ergebnis speichern';btn.disabled=false;}
  }
}
