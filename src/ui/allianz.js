import { renderPage } from '../app/render.js';
import { sbDelete, sbPatch, sbPostRet } from '../core/api.js';
import { badge, canAccess, fmt, fmtK, fmtMio, relColor, roleRank } from '../core/helpers.js';
import { GENDER_SYM, avatarImg, avatarUrl, genderMark, isInactive } from '../core/players.js';
import { APP } from '../core/state.js';
import { saveWSState } from './buildings.js';
import { csSaveState } from './cs.js';
import { showHive } from './hive.js';
import { handleStrengthImageApd, histAnzahl, renderHistoryChart, t1StaleInfo } from './profil.js';

// ========== ALLIANZ ==========
export const ROLE_DOT_C={R5:'#f39c12',R4:'#9b59b6',R3:'#7f8c8d'};
export function roleDot(r,inact,name){
  const c=inact?'#bdc3c7':(ROLE_DOT_C[r]||'#7f8c8d');
  // Mit Avatar: Bild im rangfarbenen Ring. Der Rang steht in diesen Listen
  // ohnehin in der Gruppenüberschrift bzw. im Tooltip.
  if(name&&avatarUrl(name))
    return avatarImg(name,32,`border-radius:7px;border:2px solid ${c};box-sizing:border-box`,'')
      .replace('alt=""',`alt="" title="${inact?'Ausgetreten':(r||'R3')}"`);
  return`<div style="width:30px;height:30px;border-radius:50%;background:${c};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff">${inact?'✕':(r||'R3')}</div>`;
}
export function calcGrowthAll(playerName){
  const hist=APP.playerHistory[playerName]||[];
  const calc=field=>{
    const pts=hist.filter(e=>parseFloat(e[field])>0)
      .map(e=>({t:new Date(e.recorded_at).getTime(),v:parseFloat(e[field])}))
      .sort((a,b)=>a.t-b.t);
    if(pts.length<2||pts[pts.length-1].t-pts[0].t<2*86400000)return{rate:0,projected:null};
    const W=7*86400000,n=pts.length;
    const xs=pts.map(p=>p.t/W),ys=pts.map(p=>p.v);
    const xm=xs.reduce((a,b)=>a+b,0)/n,ym=ys.reduce((a,b)=>a+b,0)/n;
    let num=0,den=0;
    for(let i=0;i<n;i++){num+=(xs[i]-xm)*(ys[i]-ym);den+=(xs[i]-xm)**2;}
    if(!den||!ym)return{rate:0,projected:null};
    const slope=num/den;
    const proj=Math.round((slope*(Date.now()/W)+(ym-slope*xm))*10)/10;
    return{rate:Math.round(slope/ym*1000)/10,projected:proj>0?proj:null};
  };
  const t1=calc('t1'),t2=calc('t2'),t3=calc('t3'),t4=calc('t4');
  const rates=[t1,t2,t3,t4].map(x=>x.rate).filter(r=>r!==0);
  const avgRate=rates.length?Math.round(rates.reduce((a,b)=>a+b,0)/rates.length*10)/10:0;
  return{t1,t2,t3,t4,avgRate};
}
export function calcGrowth(playerName){return calcGrowthAll(playerName).t1;}
export function calcGrowthRate(playerName){return calcGrowthAll(playerName).avgRate;}
export function allianzSortPlayers(list){
  const s=APP.allianzSort;
  const f=APP.allianzFilter;
  // Filter by roles
  let filtered=[...list];
  if(f.roles&&f.roles.length)filtered=filtered.filter(p=>{
    if(isInactive(p.name))return f.roles.includes('inaktiv');
    return f.roles.includes(p.role||'R3');
  });
  // Filter by profession
  if(f.profession==='Kriegsführer')filtered=filtered.filter(p=>p.profession==='Kriegsführer');
  if(f.profession==='Ingenieur')filtered=filtered.filter(p=>!p.profession||p.profession==='Ingenieur');
  // Filter by min T1
  if(f.minT1>0)filtered=filtered.filter(p=>isInactive(p.name)||(parseFloat(p.t1)||0)>=f.minT1);
  // Search
  const q=(APP.allianzSearch||'').toLowerCase().trim();
  if(q)filtered=filtered.filter(p=>p.name.toLowerCase().includes(q));
  // Sort
  filtered.sort((a,b)=>{
    const ai=isInactive(a.name),bi=isInactive(b.name);
    if(ai!==bi)return ai?1:-1;
    if(s==='role'){const rr=roleRank(b.role)-roleRank(a.role);return rr!==0?rr:a.name.localeCompare(b.name);}
    if(s==='t1')return(parseFloat(b.t1)||0)-(parseFloat(a.t1)||0);
    if(s==='hero_power')return(b.hero_power||0)-(a.hero_power||0);
    if(s==='kills')return(b.kills||0)-(a.kills||0);
    if(s==='popularity')return(b.popularity||0)-(a.popularity||0);
    if(s==='profession_level')return(b.profession_level||0)-(a.profession_level||0);
    if(s==='profession')return(a.profession||'').localeCompare(b.profession||'');
    if(s==='growth')return calcGrowthRate(b.name)-calcGrowthRate(a.name);
    if(s==='growth_t1')return calcGrowthAll(b.name).t1.rate-calcGrowthAll(a.name).t1.rate;
    if(s==='growth_t2')return calcGrowthAll(b.name).t2.rate-calcGrowthAll(a.name).t2.rate;
    if(s==='growth_t3')return calcGrowthAll(b.name).t3.rate-calcGrowthAll(a.name).t3.rate;
    if(s==='growth_t4')return calcGrowthAll(b.name).t4.rate-calcGrowthAll(a.name).t4.rate;
    if(s==='t1_stale'){const au=a.t1_updated_at?new Date(a.t1_updated_at).getTime():0;const bu=b.t1_updated_at?new Date(b.t1_updated_at).getTime():0;return au-bu;}
    return a.name.localeCompare(b.name);
  });
  return filtered;
}
export function pageAllianz(){
  if(!canAccess('allianz'))return`<div class="loader" style="color:var(--tx3)">Nur für R4 und höher.</div>`;
  // Drill-down: Spieler-Detail
  if(APP.allianzPlayer)return allianzPlayerDetail(APP.allianzPlayer);
  const pl=APP.data.players;const isAdmin=canAccess('admin');
  const active=pl.filter(p=>!isInactive(p.name));
  const inactive=pl.filter(p=>isInactive(p.name));
  const s=APP.allianzSort;
  const f=APP.allianzFilter;
  const sorted=allianzSortPlayers(pl);
  const isRoleSort=s==='role';
  const GM={R5:{label:'R5 · Präsident',c:'#f39c12'},R4:{label:'R4 · Offiziere',c:'#9b59b6'},R3:{label:'R3 · Mitglieder',c:'#7f8c8d'},inaktiv:{label:'Ausgetreten',c:'#bdc3c7'}};
  const SORTS=[
    {k:'role',l:'Rang'},
    {k:'t1',l:'T1'},
    {k:'hero_power',l:'🦸 Heldenkraft'},
    {k:'kills',l:'Kills'},
    {k:'popularity',l:'Beliebtheit'},
    {k:'profession_level',l:'Beruf-Lvl'},
    {k:'profession',l:'Beruf'},
    {k:'name',l:'A–Z'},
    {k:'growth',l:'📈 ∅ Wachstum'},
    {k:'growth_t1',l:'📈 T1'},
    {k:'growth_t2',l:'📈 T2'},
    {k:'growth_t3',l:'📈 T3'},
    {k:'growth_t4',l:'📈 T4'},
    {k:'t1_stale',l:'⏰ Veraltet'},
  ];
  const ROLE_FILTERS=['R5','R4','R3','inaktiv'];

  function allianzRow(p,num){
    const inact=isInactive(p.name);
    const r=inact?null:(p.role||'R3');
    const staleInfo=!inact?t1StaleInfo(p):null;
    const subParts=[
      p.t1?`T1 <strong>${p.t1}M</strong>`:'',
      p.level?`HQ <strong>${p.level}</strong>`:'',
      p.kills?`⚔ ${fmtK(p.kills)}`:'',
      p.popularity?`❤ ${fmt(p.popularity)}`:'',
      p.profession_level?`${p.profession==='Kriegsführer'?'⚔':'🔧'} Lv.${p.profession_level}`:'',
      s==='t1_stale'&&staleInfo?`<span style="color:${staleInfo.color};font-weight:700">⏰ ${staleInfo.label}</span>`:'',
    ].filter(Boolean).join(' · ');
    const safeName=p.name.replace(/'/g,"\\'");
    const numCell=`<span style="font-size:11px;color:var(--tx3);font-variant-numeric:tabular-nums;min-width:24px;text-align:right;flex-shrink:0">${num?num+'.':''}</span>`;
    // Rechts steht allein die Gesamtkraft der Helden. Vorher hing dort ein Block
    // mit T1–T4: Hochrechnung und Wachstumsrate je Truppenstufe — vier Zeilen pro
    // Spieler für eine Zahl, die schon links in der Zeile steht. Die Wachstumsraten
    // gibt es weiterhin im Spieler-Detail und über die 📈-Sortierung.
    const hpBadge=(!inact&&p.hero_power)?`<div style="display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-right:6px;line-height:1.25;min-width:62px">
      <span style="font-size:10px;color:var(--tx3);font-weight:700">🦸 Helden</span>
      <span style="font-size:13px;font-weight:800;color:var(--ass);font-variant-numeric:tabular-nums">${fmtMio(p.hero_power)}</span>
    </div>`:'';
    return`<div class="mi" style="cursor:${inact?'default':'pointer'};${inact?'opacity:.42':''}" onclick="${inact?'':'APP.allianzPlayer=\''+safeName+'\';renderPage()'}">
      ${numCell}
      ${roleDot(r,inact,p.name)}
      <div style="flex:1;min-width:0">
        <div class="mn" style="display:flex;align-items:center;gap:5px;${inact?'color:var(--tx3);text-decoration:line-through':''}">${p.name}${genderMark(p)}</div>
        <div class="mm" style="font-size:11px;color:var(--tx3);margin-top:2px">${inact?'Ausgetreten':subParts||'Keine Daten'}</div>
      </div>
      ${hpBadge}
      ${!inact?`<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--tx3);stroke-width:2;fill:none;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>`:''}
    </div>`;
  }

  let rows='';
  let activeCount=0;
  if(isRoleSort){
    let lastGroup=null;
    sorted.forEach(p=>{
      const g=isInactive(p.name)?'inaktiv':(p.role||'R3');
      if(g!==lastGroup){const m=GM[g]||{label:g,c:'#8892a4'};rows+=`<div style="padding:8px 14px 4px;font-size:11px;font-weight:800;color:${m.c};letter-spacing:.6px;background:${m.c}11;border-bottom:1px solid ${m.c}33">── ${m.label} ──</div>`;lastGroup=g;}
      const num=isInactive(p.name)?null:(++activeCount);
      rows+=allianzRow(p,num);
    });
  }else{
    sorted.forEach(p=>{
      const num=isInactive(p.name)?null:(++activeCount);
      rows+=allianzRow(p,num);
    });
  }

  const activeF=f.roles&&f.roles.length||f.profession||f.minT1>0;
  return`
    <!-- SUCHE -->
    <div style="position:relative;margin-bottom:8px">
      <svg viewBox="0 0 24 24" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--tx3);stroke-width:2;fill:none;pointer-events:none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Spieler suchen…" value="${APP.allianzSearch||''}"
        style="width:100%;padding:9px 32px 9px 32px;border:1.5px solid ${APP.allianzSearch?'var(--primary)':'var(--bd)'};border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:#fff"
        oninput="APP.allianzSearch=this.value;renderPage()">
      ${APP.allianzSearch?`<button onclick="APP.allianzSearch='';renderPage()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--tx3);font-size:16px;line-height:1">✕</button>`:''}
    </div>
    <!-- SORT -->
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
      ${SORTS.map(b=>`<button class="btn btn-sm ${s===b.k?'btn-sol':'btn-out'}" style="padding:5px 10px;font-size:12px" onclick="APP.allianzSort='${b.k}';renderPage()">${b.l}</button>`).join('')}
    </div>
    <!-- FILTER -->
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      <span style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em">Filter:</span>
      ${ROLE_FILTERS.map(r=>{const on=f.roles&&f.roles.includes(r);const c=ROLE_DOT_C[r]||'#bdc3c7';return`<button class="btn btn-sm" style="padding:4px 10px;font-size:12px;border:1.5px solid ${on?c:' var(--bd)'};background:${on?c+'22':'#fff'};color:${on?c:'var(--tx3)'}; font-weight:${on?'800':'600'}" onclick="allianzToggleRole('${r}')">${r}</button>`;}).join('')}
      <button class="btn btn-sm" style="padding:4px 10px;font-size:12px;border:1.5px solid ${f.profession==='Kriegsführer'?'var(--ass)':'var(--bd)'};background:${f.profession==='Kriegsführer'?'var(--ass-l)':'#fff'};color:${f.profession==='Kriegsführer'?'var(--ass)':'var(--tx3)'}" onclick="allianzToggleProf('Kriegsführer')">⚔ Kriegsführer</button>
      <button class="btn btn-sm" style="padding:4px 10px;font-size:12px;border:1.5px solid ${f.profession==='Ingenieur'?'var(--primary)':'var(--bd)'};background:${f.profession==='Ingenieur'?'var(--pri-l)':'#fff'};color:${f.profession==='Ingenieur'?'var(--primary)':'var(--tx3)'}" onclick="allianzToggleProf('Ingenieur')">🔧 Ingenieur</button>
      <span style="display:flex;align-items:center;gap:4px;margin-left:4px">
        <span style="font-size:11px;color:var(--tx3);font-weight:700;white-space:nowrap">T1 ≥</span>
        <input type="number" min="0" step="0.1" value="${f.minT1||''}" placeholder="0"
          style="width:62px;padding:4px 7px;font-size:12px;border:1.5px solid ${f.minT1>0?'var(--primary)':'var(--bd)'};border-radius:7px;background:${f.minT1>0?'var(--pri-l)':'#fff'};font-family:inherit;outline:none"
          oninput="APP.allianzFilter.minT1=parseFloat(this.value)||0;renderPage()">
        <span style="font-size:11px;color:var(--tx3)">M</span>
      </span>
      ${activeF?`<button class="btn btn-sm btn-out" style="padding:4px 8px;font-size:12px;color:var(--loss)" onclick="APP.allianzFilter={roles:[],profession:'',minT1:0};renderPage()">✕ Reset</button>`:''}
    </div>
    <!-- SUMMARY -->
    <div class="note info" style="margin-bottom:10px;padding:8px 12px;font-size:12px">
      <strong>${sorted.filter(p=>!isInactive(p.name)).length} aktive</strong> Spieler angezeigt · ${active.length} gesamt aktiv · ${inactive.length} ausgetreten · Antippen für Details
    </div>
    <!-- HIVE -->
    <button class="btn btn-out" style="width:100%;margin-bottom:10px" onclick="showHive()">🐝 Hive-Aufstellung bauen</button>
    <!-- LIST -->
    <div class="card">${rows||'<div style="padding:20px;text-align:center;color:var(--tx3);font-size:13px">Keine Spieler entsprechen dem Filter.</div>'}</div>
    <!-- EINLADUNGEN -->
    <div class="card"><div class="ch">Einladungen</div><div class="cb">
      <div class="note info">Einmalpasswörter aktuell von Ben (Admin) generiert. Automatisierung in V2.</div>
      <button class="btn btn-out" style="width:100%" onclick="alert('Funktion folgt in V2')">+ Einladung erstellen</button>
    </div></div>
    ${isAdmin?`<div class="card"><div class="ch">Neue Allianz anfragen</div><div class="cb">
      <div class="fl2"><label>Allianzname</label><input class="fi" id="aName" placeholder="z.B. AR1S"></div>
      <div class="fl2"><label>Server-ID</label><input class="fi" id="aServer" placeholder="z.B. #1668"></div>
      <div class="fl2"><label>Allianz-Tag</label><input class="fi" id="aTag" placeholder="z.B. AR1S"></div>
      <button class="btn btn-sol" style="width:100%" onclick="requestAllianz()">Anfrage stellen</button>
    </div></div>`:''}`;
}
export function allianzToggleRole(r){
  if(!APP.allianzFilter.roles)APP.allianzFilter.roles=[];
  const idx=APP.allianzFilter.roles.indexOf(r);
  if(idx>=0)APP.allianzFilter.roles.splice(idx,1);
  else APP.allianzFilter.roles.push(r);
  renderPage();
}
export function allianzToggleProf(p){
  APP.allianzFilter.profession=APP.allianzFilter.profession===p?'':p;
  renderPage();
}
export function allianzPlayerDetail(name){
  const p=APP.data.players.find(x=>x.name===name);
  if(!p)return`<button class="btn btn-out btn-sm" onclick="APP.allianzPlayer=null;renderPage()" style="margin-bottom:12px">← Mitglieder</button><div class="loader">Spieler nicht gefunden.</div>`;
  const inactive=isInactive(name);
  const r=inactive?null:(p.role||'R3');
  const rc=ROLE_DOT_C[r]||'#7f8c8d';
  const allParts=APP.data.participation.filter(x=>x.player_name===name);
  const allEvts=allParts.map(x=>({...x,ev:APP.data.events.find(e=>e.id===x.event_id)})).filter(x=>x.ev).sort((a,b)=>b.ev.event_date.localeCompare(a.ev.event_date));
  const played=allParts.filter(x=>x.played);
  const rel=allParts.length?Math.round(played.length/allParts.length*100):null;
  const canEdit=APP.user&&['superadmin','r5','r4'].includes(APP.user.role);
  const tab=APP.allianzPlayerTab||'daten';
  const editMode=APP.allianzPlayerEdit||false;
  const parsed=APP.allianzParsed||null;
  const sel=APP.allianzParsedSel||{};

  // Header
  let h=`<button class="btn btn-out btn-sm" onclick="APP.allianzPlayer=null;APP.allianzPlayerEdit=false;APP.allianzParsed=null;APP.allianzParsedSel={};renderPage()" style="margin-bottom:12px">← Mitglieder</button>`;
  if(inactive)h+=`<div class="note" style="margin-bottom:10px;border-left-color:#e67e22;background:#fef9f0">⚠️ <strong>Nicht mehr in der Allianz</strong>${canAccess('admin')?`<button class="btn btn-out btn-sm" style="margin-top:8px;width:100%;color:var(--win);border-color:var(--win)" onclick="apdSetActive('${name.replace(/'/g,"\\'")}')">↩ Spieler reaktivieren</button>`:''}</div>`;
  h+=`<div style="display:flex;align-items:center;gap:13px;margin-bottom:14px">
    ${roleDot(r,inactive,name)}
    <div style="flex:1;min-width:0">
      <div style="font-size:18px;font-weight:800;${inactive?'color:var(--tx3);text-decoration:line-through':''}">${name}</div>
      <div style="margin-top:4px;display:flex;gap:5px;flex-wrap:wrap">
        ${r?`<span style="font-size:11px;font-weight:800;color:${rc};background:${rc}22;padding:3px 8px;border-radius:6px">${r}</span>`:''}
        ${rel!==null?`<span style="font-size:11px;font-weight:700;color:${relColor(rel)};background:${relColor(rel)}22;padding:3px 8px;border-radius:6px">${rel}% Quote</span>`:''}
      </div>
    </div>
    ${canEdit&&!editMode?`<button class="btn btn-sm btn-out" style="flex-shrink:0" onclick="APP.allianzPlayerEdit=true;APP.allianzParsed=null;APP.allianzParsedSel={};renderPage()">✏ Bearbeiten</button>`:''}
    ${editMode?`<button class="btn btn-sm btn-out" style="flex-shrink:0;color:var(--tx3)" onclick="APP.allianzPlayerEdit=false;APP.allianzParsed=null;APP.allianzParsedSel={};renderPage()">✕ Abbrechen</button>`:''}
  </div>`;

  // Tabs
  h+=`<div class="stabs" style="margin-bottom:14px">
    <button class="stab${tab==='daten'?' on':''}" onclick="APP.allianzPlayerTab='daten';renderPage()">Spieler-Daten</button>
    <button class="stab${tab==='ws'?' on':''}" onclick="APP.allianzPlayerTab='ws';renderPage()">Wüstensturm</button>
  </div>`;

  // ── TAB: SPIELER-DATEN ──
  if(tab==='daten'){
    if(!editMode){
      // VIEW: nur befüllte Felder
      const profP=p.profession||'Ingenieur';const isKP=profP==='Kriegsführer';
      const hasInfo=profP||p.kills||p.popularity||p.profession_level;
      const hasTruppe=p.t1||p.t2||p.t3||p.t4||p.total_power||p.hero_power;
      if(hasInfo){
        h+=`<div class="card" style="margin-bottom:10px"><div class="ch">Spieler-Info</div><div style="padding:12px"><div class="kk-grid">
          <div class="kk-box" style="${isKP?'border:1.5px solid var(--ass);background:var(--ass-l)':''}"><div class="kk-l">Beruf</div><div class="kk-v" style="font-size:14px;color:${isKP?'var(--ass)':'var(--primary)'}">${isKP?'⚔ Kriegsführer':'🔧 Ingenieur'}</div></div>
          ${p.level?`<div class="kk-box"><div class="kk-l">Basis-Level</div><div class="kk-v">${p.level}</div></div>`:''}
          ${GENDER_SYM[p.gender]?`<div class="kk-box"><div class="kk-l">Geschlecht</div><div class="kk-v" style="color:${GENDER_SYM[p.gender].c}">${GENDER_SYM[p.gender].s} ${GENDER_SYM[p.gender].t}</div></div>`:''}
          ${p.profession_level?`<div class="kk-box"><div class="kk-l">Beruf-Level</div><div class="kk-v">${p.profession_level}</div></div>`:''}
          ${p.kills?`<div class="kk-box"><div class="kk-l">⚔ Kills</div><div class="kk-v">${fmtK(p.kills)}</div></div>`:''}
          ${p.popularity?`<div class="kk-box"><div class="kk-l">❤ Beliebtheit</div><div class="kk-v">${fmt(p.popularity)}</div></div>`:''}
        </div></div></div>`;
      }
      if(hasTruppe){
        const st=t1StaleInfo(p);const sc=st?.color||'var(--tx3)';
        h+=`<div class="card" style="margin-bottom:10px${st?.stale?';border-color:var(--loss)':''}">
          <div class="ch">Truppenstärke ${st?`<span style="font-size:11px;font-weight:700;color:${sc};background:${sc}22;padding:2px 8px;border-radius:5px">${st.label}</span>`:''}</div>
          <div style="padding:12px"><div class="kk-grid">
            ${p.t1?`<div class="kk-box"><div class="kk-l">T1</div><div class="kk-v">${p.t1} M</div></div>`:''}
            ${p.t2?`<div class="kk-box"><div class="kk-l">T2</div><div class="kk-v">${p.t2} M</div></div>`:''}
            ${p.t3?`<div class="kk-box"><div class="kk-l">T3</div><div class="kk-v">${p.t3} M</div></div>`:''}
            ${p.t4?`<div class="kk-box"><div class="kk-l">T4</div><div class="kk-v">${p.t4} M</div></div>`:''}
            ${p.total_power?`<div class="kk-box" style="grid-column:1/-1"><div class="kk-l">Gesamtkampfkraft</div><div class="kk-v" style="font-size:18px">${fmt(p.total_power)}</div></div>`:''}
            ${p.hero_power?`<div class="kk-box" style="grid-column:1/-1;border-color:var(--ass)"><div class="kk-l">🦸 Gesamtkraft der Helden</div><div class="kk-v" style="font-size:18px;color:var(--ass)">${fmtMio(p.hero_power)}</div></div>`:''}
          </div></div>
        </div>`;
        const phist=APP.playerHistory[name]||[];
        if(phist.length>=2){h+=`<div class="card" style="margin-bottom:10px"><div class="ch">Verlauf <span class="ch-sub">${phist.length} Einträge</span></div>${renderHistoryChart(name,'truppen')}</div>`;}
        // Helden-Verlauf getrennt: andere Größenordnung, eigene Skala (HIST_MODI).
        if(histAnzahl(name,'helden')>=2){h+=`<div class="card" style="margin-bottom:10px;border-color:var(--ass)44"><div class="ch">🦸 Helden-Verlauf <span class="ch-sub">${histAnzahl(name,'helden')} Einträge</span></div>${renderHistoryChart(name,'helden')}</div>`;}
        if(phist.length&&canEdit){
          h+=`<div class="card" style="margin-bottom:10px">
            <div class="ch">Verlaufs-Einträge <span class="ch-sub">Eintrag korrigieren oder neu erfassen</span></div>
            <div style="padding:0 0 6px">`;
          phist.forEach(e=>{
            const d=e.recorded_at?e.recorded_at.slice(0,10):'–';
            const vals=[e.t1?'T1 '+e.t1:'',e.t2?'T2 '+e.t2:'',e.t3?'T3 '+e.t3:'',e.t4?'T4 '+e.t4:'',e.hero_power?'🦸 '+fmtK(e.hero_power):''].filter(Boolean).join(' · ');
            const safeEntry=encodeURIComponent(JSON.stringify({id:e.id,t1:e.t1,t2:e.t2,t3:e.t3,t4:e.t4,total_power:e.total_power,hero_power:e.hero_power}));
            const safeName=name.replace(/'/g,"\\'");
            h+=`<div class="mi" style="padding:8px 14px">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:700">${d}${e.changed_by?` <span style="font-size:10px;color:var(--tx3)">von ${e.changed_by}</span>`:''}</div>
                <div style="font-size:11px;color:var(--tx3);margin-top:1px">${vals||'–'}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-sm btn-out" style="font-size:11px" onclick="APP.historyEditId='${e.id}';APP.historyEditPrefill=JSON.parse(decodeURIComponent('${safeEntry}'));APP.allianzPlayerEdit=true;APP.allianzParsed=null;APP.allianzParsedSel={};renderPage()">✏ Korrigieren</button>
                <button class="btn btn-sm" style="font-size:11px;background:var(--loss);color:#fff;border-color:var(--loss)" onclick="deleteHistoryEntry('${e.id}','${safeName}')">✕ Löschen</button>
              </div>
            </div>`;
          });
          h+=`</div></div>`;
        }
      }
      if(!hasInfo&&!hasTruppe){
        h+=`<div class="note" style="margin-bottom:10px">Noch keine Spieler-Daten vorhanden.${canEdit?' Bearbeiten um Daten einzutragen.':''}</div>`;
      }
    } else {
      // EDIT MODE
      h+=`<div class="card" style="margin-bottom:10px">
        <div class="ch">Screenshot hochladen <span class="ch-sub">OCR liest Werte automatisch (V2)</span></div>
        <div class="cb">
          <div class="upl" onclick="document.getElementById('apd-ss').click()" style="padding:14px;text-align:center;border:2px dashed var(--bd);border-radius:10px;cursor:pointer">
            <svg viewBox="0 0 24 24" style="width:28px;height:28px;stroke:var(--tx3);stroke-width:1.5;fill:none;margin:0 auto 6px;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div style="font-size:13px;font-weight:600;color:var(--tx2)">Screenshot Spielerprofil</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:3px">Truppenstärke, Kills, Beliebtheit werden erkannt</div>
            <input type="file" id="apd-ss" accept="image/*" style="display:none" onchange="alert('OCR-Analyse folgt in V2 — bitte Werte manuell eintragen.')">
          </div>
        </div>
      </div>`;

      // Truppenstärke Textpaste
      h+=`<div class="card" style="margin-bottom:10px">
        <div class="ch">Truppenstärke — Text einfügen</div>
        <div class="cb">
          <div style="font-size:12px;color:var(--tx3);margin-bottom:8px">Format: <code style="background:#f0f0f0;padding:2px 5px;border-radius:4px">T1: 26.3 T2: 24.2 Helden: 167,2</code> (beliebige Reihenfolge)</div>
          <textarea id="apd-paste" rows="2" placeholder="T1: 26.3 T2: 24.2 T3: 20.2 T4: 5.1 Helden: 167,2"
            style="width:100%;padding:10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;outline:none"
            oninput="parseTruppenText(this.value)">${''}</textarea>
          <button class="btn btn-out" style="margin-top:8px;width:100%" onclick="parseTruppenText(document.getElementById('apd-paste')?.value||'')">Auswerten</button>
        </div>
      </div>`;

      // Parsed preview with checkboxes
      if(parsed&&Object.keys(parsed).length){
        const fields=[['t1','T1'],['t2','T2'],['t3','T3'],['t4','T4'],['total_power','Gesamtkampfkraft'],['hero_power','🦸 Gesamtkraft der Helden']];
        const isMio=k=>k==='t1'||k==='t2'||k==='t3'||k==='t4';
        const fmtPrev=(k,v)=>isMio(k)?v+' M':(k==='hero_power'?fmtMio(v):fmt(v));
        const changes=fields.filter(([k])=>parsed[k]!==undefined&&String(parsed[k])!==String(p[k]||''));
        if(changes.length){
          h+=`<div class="card" style="margin-bottom:10px;border:1.5px solid var(--win)">
            <div class="ch" style="color:var(--win)">Erkannte Änderungen <span class="ch-sub">Auswahl zum Übernehmen</span></div>
            <div class="cb" style="padding:10px 14px">`;
          changes.forEach(([k,label])=>{
            const isChecked=sel[k]!==false;
            h+=`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bd)">
              <input type="checkbox" id="psel-${k}" ${isChecked?'checked':''} onchange="APP.allianzParsedSel['${k}']=this.checked;renderPage()" style="width:17px;height:17px;cursor:pointer;flex-shrink:0">
              <label for="psel-${k}" style="flex:1;cursor:pointer;font-size:13px;font-weight:600">${label}</label>
              <span style="color:var(--tx3);font-size:12px;text-decoration:line-through">${p[k]?fmtPrev(k,p[k]):'–'}</span>
              <span style="color:var(--win);font-weight:800;font-size:13px">→ ${fmtPrev(k,parsed[k])}</span>
            </div>`;
          });
          const allChecked=changes.every(([k])=>sel[k]!==false);
          h+=`<div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-sm btn-out" style="flex:1" onclick="const c=${JSON.stringify(changes.map(x=>x[0]))};c.forEach(k=>APP.allianzParsedSel[k]=true);renderPage()">${allChecked?'Alle gewählt':'Alle auswählen'}</button>
            <button class="btn btn-sol" style="flex:2" onclick="applyParsedTruppen('${name.replace(/'/g,"\\'")}')">Ausgewählte speichern</button>
          </div>`;
          h+=`</div></div>`;
        } else {
          h+=`<div class="note info" style="margin-bottom:10px">Keine Änderungen erkannt — Werte sind identisch mit aktuellen Daten.</div>`;
        }
      }

      // Manual fields — prefill from history entry if correcting, else from player
      const hEd=APP.historyEditId?APP.historyEditPrefill:{};
      const pf=(field)=>hEd[field]!==undefined&&hEd[field]!==null?hEd[field]:(p[field]||'');
      const isCorrection=!!APP.historyEditId;
      h+=`<div class="card" style="margin-bottom:10px;${isCorrection?'border:2px solid var(--acc)':''}">
        <div class="ch">${isCorrection?`<span style="color:var(--acc)">Eintrag korrigieren</span> <span class="ch-sub">ID ${APP.historyEditId}</span>`:'Manuell bearbeiten'}</div>
        <div class="cb">
          ${isCorrection?`<div class="note" style="margin-bottom:10px;background:#fef9f0;border-left-color:var(--acc)">⚠ Du korrigierst einen bestehenden Verlaufseintrag. Der Spieler-Datensatz wird ebenfalls aktualisiert.</div>`:''}
          ${!isCorrection?`<div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Spielername</div>
          <div style="display:flex;gap:6px;margin-bottom:14px">
            <input class="fi" id="apd-name" type="text" value="${(p.name||'').replace(/"/g,'&quot;')}" style="flex:1;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
            <button class="btn btn-out btn-sm" id="apd-rename" onclick="apdRename('${name.replace(/'/g,"\\'")}')">✎ Umbenennen</button>
          </div>`:''}
          ${!isCorrection&&canAccess('admin')?`<div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Rang</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
            ${['R1','R2','R3','R4','R5'].map(rk=>{const cur=(p.role||'r3').toUpperCase();const sel=cur===rk;const rc={R5:'#f39c12',R4:'#9b59b6',R3:'#7f8c8d',R2:'#95a5a6',R1:'#bdc3c7'}[rk];return`<button class="btn btn-sm" id="rank-btn-${rk}" style="flex:1;${sel?`background:${rc};color:#fff;border-color:${rc}`:`color:${rc};border-color:${rc}`}" onclick="apdSetRank('${name.replace(/'/g,"\\'")}','${rk}')">${rk}</button>`;}).join('')}
          </div>`:''}
          ${!isCorrection?`<div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Spieler-Info</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div style="grid-column:1/-1"><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">Beruf</label>
              <div style="display:flex;gap:8px">
                <button class="btn btn-sm ${(!p.profession||p.profession==='Ingenieur')?'btn-sol':'btn-out'}" style="flex:1" id="prof-ing" onclick="apd_setProfession('${name.replace(/'/g,"\\'")}','Ingenieur')">🔧 Ingenieur</button>
                <button class="btn btn-sm ${p.profession==='Kriegsführer'?'btn-sol':'btn-out'}" style="flex:1;${p.profession==='Kriegsführer'?'background:var(--ass);':'color:var(--ass);border-color:var(--ass)'}" id="prof-krieg" onclick="apd_setProfession('${name.replace(/'/g,"\\'")}','Kriegsführer')">⚔ Kriegsführer</button>
              </div>
            </div>
            <div style="grid-column:1/-1"><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">Geschlecht</label>
              <div style="display:flex;gap:8px">
                ${[['m','♂ Männlich','#3498db'],['w','♀ Weiblich','#e91e8c'],['','– Keine Angabe','#95a5a6']].map(([g,lbl,c])=>{
                  const sel=(p.gender||'')===g;
                  return`<button class="btn btn-sm ${sel?'btn-sol':'btn-out'}" style="flex:1;${sel?`background:${c};border-color:${c}`:`color:${c};border-color:${c}`}" onclick="apdSetGender('${name.replace(/'/g,"\\'")}','${g}')">${lbl}</button>`;
                }).join('')}
              </div>
            </div>
            ${[['apd-lvl','Basis-Level (HQ)',p.level||'','number'],['apd-pl','Beruf-Level',p.profession_level||'','number'],['apd-kills','Kills',p.kills||'','number'],['apd-pop','Beliebtheit',p.popularity||'','number']].map(([id,lbl,val,type])=>`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">${lbl}</label><input class="fi" id="${id}" type="${type}" value="${val}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`).join('')}
          </div>`:''}
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px dashed var(--bd);border-radius:8px;cursor:pointer;background:var(--bg);margin-bottom:10px">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;flex-shrink:0;fill:none;stroke:var(--tx3);stroke-width:2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span id="apdImgLabel" style="font-size:12px;color:var(--tx3);flex:1">Screenshot hochladen (Truppenstärke)</span>
            <input type="file" accept="image/*" style="display:none" onchange="handleStrengthImageApd(this.files[0])">
          </label>
          <div id="apdImgResult" style="display:none;margin-bottom:10px;padding:9px 12px;border-radius:8px;font-size:12px;border:1px solid var(--bd);background:var(--bg)"></div>
          <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Truppenstärke (Mio.)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            ${[['apd-t1','T1',pf('t1')],['apd-t2','T2',pf('t2')],['apd-t3','T3',pf('t3')],['apd-t4','T4',pf('t4')]].map(([id,lbl,val])=>`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">${lbl}</label><input class="fi" id="${id}" type="number" step="0.01" value="${val}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`).join('')}
            <div style="grid-column:1/-1"><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">Gesamtkampfkraft</label><input class="fi" id="apd-gkk" type="number" value="${pf('total_power')}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>
            <div style="grid-column:1/-1"><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">🦸 Gesamtkraft der Helden (Mio.)</label><input class="fi" id="apd-hp" type="number" step="0.1" value="${pf('hero_power')?(pf('hero_power')/1e6):''}" style="padding:8px 10px;width:100%;border:1.5px solid var(--ass);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>
          </div>
          <div style="display:flex;gap:8px">
            ${isCorrection?`<button class="btn btn-out" style="flex:1" onclick="APP.historyEditId=null;APP.historyEditPrefill={};renderPage()">Abbrechen</button>`:''}
            <button class="btn btn-sol${isCorrection?'':''}" id="apd-save" style="flex:2" onclick="apdSaveManual('${name.replace(/'/g,"\\'")}')">
              ${isCorrection?'✓ Eintrag korrigieren':'Speichern'}
            </button>
          </div>
          ${!isCorrection&&canAccess('admin')?`<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--bd)">
            <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${inactive?'Mitgliedschaft':'Gefahrenzone'}</div>
            ${inactive
              ?`<button class="btn btn-out" style="width:100%;color:var(--win);border-color:var(--win)" onclick="apdSetActive('${name.replace(/'/g,"\\'")}')">
              ↩ Spieler reaktivieren (zurück in der Allianz)
            </button>`
              :`<button class="btn btn-out" style="width:100%;color:var(--loss);border-color:var(--loss)" onclick="apdSetInactive('${name.replace(/'/g,"\\'")}')">
              Spieler inaktiv setzen (Allianz verlassen)
            </button>`}
          </div>`:''}
        </div>
      </div>`;
    }
  }

  // ── TAB: WÜSTENSTURM ──
  if(tab==='ws'){
    const missed=allParts.filter(x=>!x.played&&!x.excused);
    const excused=allParts.filter(x=>x.excused);
    const ap=played.filter(x=>x.individual_pts).reduce((s,x)=>s+(x.individual_pts||0),0);
    const apCount=played.filter(x=>x.individual_pts).length;
    const avgP=apCount?Math.round(ap/apCount):0;
    const evtsWon=allEvts.filter(x=>x.played&&x.ev?.result==='win').length;
    const evtsLost=allEvts.filter(x=>x.played&&x.ev?.result==='loss').length;
    if(allParts.length){
      h+=`<div class="sg">
        <div class="sb"><div class="sb-l">Gespielt</div><div class="sb-v" style="color:var(--win)">${played.length}</div><div class="sb-s">von ${allParts.length}</div></div>
        <div class="sb"><div class="sb-l">Quote</div><div class="sb-v" style="color:${relColor(rel)}">${rel!==null?rel+'%':'–'}</div></div>
        <div class="sb"><div class="sb-l">Siege</div><div class="sb-v" style="color:var(--win)">${evtsWon}</div></div>
        <div class="sb"><div class="sb-l">Niederlagen</div><div class="sb-v" style="color:var(--loss)">${evtsLost}</div></div>
        <div class="sb"><div class="sb-l">Ø Punkte</div><div class="sb-v">${fmt(avgP)}</div></div>
        ${missed.length?`<div class="sb"><div class="sb-l">Gefehlt</div><div class="sb-v" style="color:var(--loss)">${missed.length}</div></div>`:''}
        ${excused.length?`<div class="sb"><div class="sb-l">Entschuldigt</div><div class="sb-v" style="color:var(--acc)">${excused.length}</div></div>`:''}
      </div>`;
    }
    if(allEvts.length){
      h+=`<div class="card"><div class="ch">WS-Verlauf</div>`;
      allEvts.forEach(x=>{
        const ev=x.ev;
        const c=x.played?(ev.result==='win'?'var(--win)':'var(--loss)'):(x.excused?'var(--acc)':'var(--loss)');
        const label=x.played?(ev.result==='win'?'Sieg':'Niederlage'):(x.excused?'Entschuldigt':'Gefehlt');
        h+=`<div class="mi">
          <div style="width:34px;height:34px;border-radius:9px;background:${c}22;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${c};flex-shrink:0">${x.played?(ev.result==='win'?'S':'N'):(x.excused?'E':'F')}</div>
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">${ev.event_date} · Team ${ev.team}</div><div style="font-size:11px;color:var(--tx3)">${ev.opponent||''}${x.zone?' · '+x.zone:''}${x.rank?' · Platz '+x.rank:''}</div></div>
          <div class="mr">${x.individual_pts?`<span style="font-size:13px;font-weight:800">${fmt(x.individual_pts)}</span>`:''}${badge(label,c)}</div>
        </div>`;
      });
      h+=`</div>`;
    } else {
      h+=`<div class="note">Noch keine WS-Teilnahme erfasst.</div>`;
    }
  }
  return h;
}

// ── ALLIANZ PLAYER DETAIL HELPERS ──
// Ganzzahl aus dem Spiel: „1.234.567", „1,234,567" und „1234567" meinen
// alle dieselbe Zahl. parseFloat allein macht aus „1.234.567" eine 1,234.
export function parseBigInt(str){
  const s=String(str).trim();
  if(/^\d{1,3}([.,]\d{3})+$/.test(s))return parseInt(s.replace(/[.,]/g,''),10);
  const v=parseFloat(s.replace(',','.'));
  return isNaN(v)?null:Math.round(v);
}
export function parseTruppenText(txt){
  if(!txt||!txt.trim()){APP.allianzParsed=null;APP.allianzParsedSel={};renderPage();return;}
  const res={};
  // Helden zuerst — und den Treffer aus dem Text schneiden, sonst greift die
  // lockere „gesamt"-Regel weiter unten auf „Gesamtkraft der Helden" zu und
  // schreibt die Heldenkraft in die Gesamtkampfkraft.
  let rest=txt;
  const heroRe=/(?:gesamtkraft\s*(?:der\s*)?helden|heldenkraft|helden|total\s*hero\s*power|hero\s*power)\s*[:=]?\s*([\d.,]+)/i;
  const hm=rest.match(heroRe);
  if(hm){
    let v=parseBigInt(hm[1]);
    // Im Spiel steht die Heldenkraft in Millionen („167,2"). Gespeichert wird
    // der absolute Wert. Alles unter 10.000 ist deshalb sicher eine
    // Millionen-Angabe — echte Heldenkräfte liegen bei zig Millionen.
    if(v!==null&&v<10000){const f=parseFloat(String(hm[1]).replace(',','.'));if(!isNaN(f))v=Math.round(f*1e6);}
    if(v!==null&&v>0)res.hero_power=v;
    rest=rest.replace(heroRe,' ');
  }
  const patterns=[['t1',/T1\s*[:=]\s*([\d.,]+)/i],['t2',/T2\s*[:=]\s*([\d.,]+)/i],['t3',/T3\s*[:=]\s*([\d.,]+)/i],['t4',/T4\s*[:=]\s*([\d.,]+)/i],['total_power',/(?:gesamt|total|ges\.?)\s*[:=]?\s*([\d.,]+)/i]];
  patterns.forEach(([k,re])=>{const m=rest.match(re);if(m){if(k==='total_power'){const v=parseBigInt(m[1]);if(v!==null)res[k]=v;}else{const v=parseFloat(m[1].replace(',','.'));if(!isNaN(v))res[k]=v;}}});
  APP.allianzParsed=Object.keys(res).length?res:null;
  // default all checked
  if(APP.allianzParsed)Object.keys(APP.allianzParsed).forEach(k=>{if(APP.allianzParsedSel[k]===undefined)APP.allianzParsedSel[k]=true;});
  renderPage();
}
export async function savePlayerHistory(name, fields){
  // fields: object with any of {t1,t2,t3,t4,total_power,hero_power}
  const hasTruppe=fields.t1||fields.t2||fields.t3||fields.t4||fields.total_power||fields.hero_power;
  if(!hasTruppe)return;
  const pl=APP.data.players.find(x=>x.name===name);
  const hist={
    player_name:name,
    t1:fields.t1??pl?.t1??null,
    t2:fields.t2??pl?.t2??null,
    t3:fields.t3??pl?.t3??null,
    t4:fields.t4??pl?.t4??null,
    total_power:fields.total_power??pl?.total_power??null,
    hero_power:fields.hero_power??pl?.hero_power??null,
  };
  try{
    const _payload=[{...hist,changed_by:APP.user?.playerName||APP.user?.username||'unknown'}];
    const _inserted=(await sbPostRet('ws_player_history',_payload))[0]||{};
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{t1_updated_at:new Date().toISOString()});
    // update local
    if(pl)pl.t1_updated_at=new Date().toISOString();
    if(!APP.playerHistory[name])APP.playerHistory[name]=[];
    APP.playerHistory[name].unshift({...hist,id:_inserted.id,recorded_at:_inserted.recorded_at||new Date().toISOString()});
  }catch(e){console.warn('History save failed:',e.message);}
}
export async function applyParsedTruppen(name){
  const parsed=APP.allianzParsed;const sel=APP.allianzParsedSel;
  if(!parsed)return;
  const upd={};
  Object.entries(parsed).forEach(([k,v])=>{if(sel[k]!==false)upd[k]=v;});
  if(!Object.keys(upd).length){alert('Keine Felder ausgewählt.');return;}
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),upd);
    const pl=APP.data.players.find(x=>x.name===name);
    if(pl)Object.assign(pl,upd);
    await savePlayerHistory(name,upd);
    APP.allianzParsed=null;APP.allianzParsedSel={};APP.allianzPlayerEdit=false;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function apdSaveManual(name){
  const v=k=>document.getElementById(k)?.value;
  const upd={};
  const t1=parseFloat(v('apd-t1'));if(!isNaN(t1)&&t1>0)upd.t1=t1;
  const t2=parseFloat(v('apd-t2'));if(!isNaN(t2)&&t2>0)upd.t2=t2;
  const t3=parseFloat(v('apd-t3'));if(!isNaN(t3)&&t3>0)upd.t3=t3;
  const t4=parseFloat(v('apd-t4'));if(!isNaN(t4)&&t4>0)upd.t4=t4;
  const gkk=parseInt(v('apd-gkk'));if(!isNaN(gkk)&&gkk>0)upd.total_power=gkk;
  const hp=parseFloat(v('apd-hp'));if(!isNaN(hp)&&hp>0)upd.hero_power=Math.round(hp*1e6);
  const isCorrection=!!APP.historyEditId;
  if(!isCorrection){
    const lvl=parseInt(v('apd-lvl'));if(!isNaN(lvl)&&lvl>0)upd.level=lvl;
    const pl_val=parseInt(v('apd-pl'));if(!isNaN(pl_val)&&pl_val>0)upd.profession_level=pl_val;
    const kills=parseInt(v('apd-kills'));if(!isNaN(kills)&&kills>0)upd.kills=kills;
    const pop=parseInt(v('apd-pop'));if(!isNaN(pop)&&pop>0)upd.popularity=pop;
  }
  if(!Object.keys(upd).length){alert('Keine Werte eingetragen.');return;}
  const btn=document.getElementById('apd-save');if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    if(isCorrection){
      // Beim Korrigieren: nur explizit eingetragene Felder überschreiben,
      // nicht eingetragene Felder behalten den Originalwert aus historyEditPrefill
      const pref=APP.historyEditPrefill||{};
      const keep=f=>upd[f]!==undefined?upd[f]:(pref[f]>0?pref[f]:null);
      const histFields={t1:keep('t1'),t2:keep('t2'),t3:keep('t3'),t4:keep('t4'),total_power:keep('total_power'),hero_power:keep('hero_power')};
      if(!APP.historyEditId||APP.historyEditId==='undefined'){throw new Error('History-Eintrag hat keine ID — Seite neu laden und erneut versuchen.');}
      await sbPatch('ws_player_history','id=eq.'+encodeURIComponent(APP.historyEditId),histFields);
      // ws_players nur mit explizit eingetragenen Werten aktualisieren
      await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),upd);
      // Update local cache
      const pl=APP.data.players.find(x=>x.name===name);
      if(pl)Object.assign(pl,upd);
      const entry=APP.playerHistory[name]?.find(e=>e.id===APP.historyEditId);
      if(entry)Object.assign(entry,histFields);
      APP.historyEditId=null;APP.historyEditPrefill={};
    } else {
      await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),upd);
      const pl=APP.data.players.find(x=>x.name===name);
      if(pl)Object.assign(pl,upd);
      await savePlayerHistory(name,upd);
    }
    APP.allianzPlayerEdit=false;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);if(btn){btn.textContent='Speichern';btn.disabled=false;}}
}
export async function apdRename(oldName){
  const inp=document.getElementById('apd-name');
  const newName=(inp?.value||'').trim();
  if(!newName||newName===oldName){alert('Bitte einen neuen Namen eingeben.');return;}
  if(APP.data.players.some(p=>p.name===newName)){alert(`„${newName}" existiert bereits — Spieler stattdessen zusammenführen.`);return;}
  if(!confirm(`„${oldName}" in „${newName}" umbenennen?\n\nName wird in allen Tabellen aktualisiert (Spieler, History, Teilnahmen, VS-Einträge).`))return;
  const btn=document.getElementById('apd-rename');if(btn){btn.textContent='Läuft…';btn.disabled=true;}
  try{
    const srcE=encodeURIComponent(oldName);
    await sbPatch('ws_participation','player_name=eq.'+srcE,{player_name:newName});
    await sbPatch('ws_player_history','player_name=eq.'+srcE,{player_name:newName});
    for(const tbl of ['vs_entries','ws_player_coords','ws_poll_votes','ws_rankings','ws_versammlungen']){
      try{await sbPatch(tbl,'player_name=eq.'+srcE,{player_name:newName});}catch(e){console.warn(tbl+' rename übersprungen:',e.message);}
    }
    await sbPatch('ws_players','name=eq.'+srcE,{name:newName});
    // Local cache
    const pl=APP.data.players.find(p=>p.name===oldName);if(pl)pl.name=newName;
    if(APP.playerHistory[oldName]){APP.playerHistory[newName]=APP.playerHistory[oldName];delete APP.playerHistory[oldName];APP.playerHistory[newName].forEach(h=>h.player_name=newName);}
    APP.data.participation.forEach(p=>{if(p.player_name===oldName)p.player_name=newName;});
    // WS-State (lineup/teamAssign/accepted/bldAssign)
    if(APP.teamAssign[oldName]){APP.teamAssign[newName]=APP.teamAssign[oldName];delete APP.teamAssign[oldName];}
    if(APP.csTeamAssign[oldName]){APP.csTeamAssign[newName]=APP.csTeamAssign[oldName];delete APP.csTeamAssign[oldName];}
    if(APP.csPlanA&&APP.csPlanA[oldName]){APP.csPlanA[newName]=APP.csPlanA[oldName];delete APP.csPlanA[oldName];}
    if(APP.csPlanB&&APP.csPlanB[oldName]){APP.csPlanB[newName]=APP.csPlanB[oldName];delete APP.csPlanB[oldName];}
    csSaveState();
    APP.accepted=APP.accepted.map(n=>n===oldName?newName:n);
    ['lineupA','lineupB'].forEach(k=>{const L=APP[k];Object.keys(L||{}).forEach(z=>{L[z]=(L[z]||[]).map(n=>n===oldName?newName:n);});});
    ['bldAssign','bldAssignPh2'].forEach(k=>{if(APP[k]?.[oldName]){APP[k][newName]=APP[k][oldName];delete APP[k][oldName];}});
    if(APP.selectedPlayer===oldName)APP.selectedPlayer=newName;
    saveWSState();
    APP.allianzPlayerEdit=false;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);if(btn){btn.textContent='✎ Umbenennen';btn.disabled=false;}}
}
export async function apd_setProfession(name,prof){
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{profession:prof});
    const pl=APP.data.players.find(x=>x.name===name);
    if(pl)pl.profession=prof;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function apdSetGender(name,g){
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{gender:g||null});
    const pl=APP.data.players.find(x=>x.name===name);
    if(pl)pl.gender=g||null;
    renderPage();
  }catch(e){alert('Fehler beim Speichern des Geschlechts: '+e.message);}
}
export async function apdSetRank(name,rank){
  // rank is 'R1'..'R5' (DB format uppercase)
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{role:rank});
    const pl=APP.data.players.find(x=>x.name===name);
    // Groß geschrieben wie in der Datenbank. Ein kleingeschriebenes 'r3' bildete
    // bis zum nächsten Laden eine eigene Gruppe in der Mitgliederliste, und
    // roleRank() kennt es nicht — der Spieler rutschte auf den Rückfallwert und
    // damit zwischen die R2.
    if(pl)pl.role=rank;
    renderPage();
  }catch(e){alert('Fehler beim Rang-Speichern: '+e.message);}
}
export async function apdSetInactive(name){
  if(!confirm(`„${name}" als inaktiv markieren (Allianz verlassen)?\n\nDer Spieler bleibt in der Datenbank, wird aber aus allen aktiven Listen ausgeblendet.`))return;
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{active:false});
    const pl=APP.data.players.find(x=>x.name===name);
    if(pl)pl.active=false;
    delete APP.teamAssign[name];
    delete APP.csTeamAssign[name];
    saveWSState();csSaveState();
    APP.allianzPlayer=null;APP.allianzPlayerEdit=false;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function apdSetActive(name){
  if(!confirm(`„${name}" wieder als aktives Mitglied führen?\n\nDer Spieler taucht danach wieder in allen Listen, Aufstellungen und Auswertungen auf.`))return;
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{active:true});
    const pl=APP.data.players.find(x=>x.name===name);
    if(pl)pl.active=true;
    APP.allianzPlayerEdit=false;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function deleteHistoryEntry(id,name){
  if(!confirm('Eintrag wirklich löschen?'))return;
  try{
    await sbDelete('ws_player_history','id=eq.'+encodeURIComponent(id));
    if(APP.playerHistory[name])APP.playerHistory[name]=APP.playerHistory[name].filter(e=>String(e.id)!==String(id));
    renderPage();
  }catch(e){alert('Fehler beim Löschen: '+e.message);}
}
export function requestAllianz(){const n=document.getElementById('aName')?.value;if(!n){alert('Bitte Allianzname eingeben.');return;}alert(`Anfrage für "${n}" würde gespeichert (alliances-Tabelle in V2).`);}
