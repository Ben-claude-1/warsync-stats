import { renderPage } from '../app/render.js';
import { sbDelete, sbGet, sbUpsert } from '../core/api.js';
import { badge, canAccess, roleRank } from '../core/helpers.js';
import { LANG, trs } from '../core/i18n.js';
import { APP } from '../core/state.js';
import { allianceLabel } from '../core/tenant.js';
import { roleDot } from './allianz.js';

// ========== ZUGFAHRT ==========
// Eine Zeile pro Tag in zug_rides (Single-Alliance): driver_name (Zugführer) + vip_name.
// Mo/Mi/Fr = Zugführer-Tage → Auto-Vorschlag aus R4/R5. Andere Tage → restliche Spieler (R3 u.).
// Faire Rotation: wenigste Fahrten zuerst, dann älteste letzte Fahrt. R4/R5 können alles überschreiben.
export function zugISO(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
export function zugFmtISO(iso){if(!iso)return'–';const p=iso.split('-');return p[2]+'.'+p[1]+'.'+p[0];}
export function zugDaysAgo(iso){if(!iso)return null;const a=new Date(iso+'T00:00:00'),b=new Date();b.setHours(0,0,0,0);return Math.round((b-a)/86400000);}
export const ZUG_WD=LANG==='en'?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['So','Mo','Di','Mi','Do','Fr','Sa'];
export const ZUG_WD_LONG=LANG==='en'
  ?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  :['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

export function zugStats(){
  const rides=APP.data.zugRides||[];const today=zugISO(new Date());
  const drvPast={},lastDrv={},vipPast={},lastVip={},drvAll={},vipAll={};
  rides.forEach(r=>{
    if(r.driver_name){drvAll[r.driver_name]=(drvAll[r.driver_name]||0)+1;
      if(r.ride_date<=today){drvPast[r.driver_name]=(drvPast[r.driver_name]||0)+1;
        if(!lastDrv[r.driver_name]||r.ride_date>lastDrv[r.driver_name])lastDrv[r.driver_name]=r.ride_date;}}
    if(r.vip_name){vipAll[r.vip_name]=(vipAll[r.vip_name]||0)+1;
      if(r.ride_date<=today){vipPast[r.vip_name]=(vipPast[r.vip_name]||0)+1;
        if(!lastVip[r.vip_name]||r.ride_date>lastVip[r.vip_name])lastVip[r.vip_name]=r.ride_date;}}
  });
  return{drvPast,lastDrv,vipPast,lastVip,drvAll,vipAll};
}

// Baut den 7-Tage-Plan: gespeicherte Einteilung + Auto-Vorschläge für freie Slots.
export function zugBuildPlan(){
  const active=APP.data.players.filter(p=>p.active!==false);
  const r45=active.filter(p=>p.role==='R4'||p.role==='R5');
  const reg=active.filter(p=>p.role!=='R4'&&p.role!=='R5');
  const st=zugStats();
  const dCount={...st.drvAll},vCount={...st.vipAll},lastDrv={...st.lastDrv},lastVip={...st.lastVip};
  const pick=(pool,count,last,exclude)=>{
    let best=null;
    pool.forEach(p=>{
      if(exclude&&p.name===exclude)return;
      const c=count[p.name]||0,l=last[p.name]||''; // '' = nie gefahren → ältester
      if(!best||c<best.c||(c===best.c&&l<best.l)||(c===best.c&&l===best.l&&p.name<best.name))best={name:p.name,c,l};
    });
    return best?best.name:'';
  };
  const rows=APP.data.zugRides||[];const base=new Date();base.setHours(0,0,0,0);const plan=[];
  for(let i=0;i<7;i++){
    const d=new Date(base);d.setDate(base.getDate()+i);const iso=zugISO(d);const wd=d.getDay();
    const conductor=(wd===1||wd===3||wd===5);
    const row=rows.find(r=>r.ride_date===iso);
    const driver=row&&row.driver_name?row.driver_name:'';
    const vip=row&&row.vip_name?row.vip_name:'';
    let suggD='',suggV='';
    if(!driver){suggD=pick(conductor?r45:reg,dCount,lastDrv,'');if(suggD){dCount[suggD]=(dCount[suggD]||0)+1;lastDrv[suggD]=iso;}}
    const effDriver=driver||suggD;
    if(!vip){suggV=pick(active,vCount,lastVip,effDriver);if(suggV){vCount[suggV]=(vCount[suggV]||0)+1;lastVip[suggV]=iso;}}
    plan.push({iso,wd,conductor,saved:!!row,auto:row?!!row.auto:false,driver,vip,suggD,suggV,effDriver,effVip:vip||suggV});
  }
  return plan;
}

export function zugPlayerOptions(sel){
  const active=[...APP.data.players.filter(p=>p.active!==false)]
    .sort((a,b)=>(roleRank(b.role)-roleRank(a.role))||a.name.localeCompare(b.name));
  return'<option value="">— niemand —</option>'+active.map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}"${p.name===sel?' selected':''}>${p.name} · ${p.role||'R3'}</option>`).join('');
}

export async function zugReload(){APP.data.zugRides=await sbGet('zug_rides?order=ride_date.asc');}

export async function zugSetField(iso,field,value){
  if(!canAccess('zugfahrt')||APP.zugBusy)return;
  value=value||null;
  const ex=(APP.data.zugRides||[]).find(r=>r.ride_date===iso);
  const driver=field==='driver'?value:(ex?ex.driver_name:null);
  const vip=field==='vip'?value:(ex?ex.vip_name:null);
  APP.zugBusy=true;renderPage();
  try{
    if(!driver&&!vip){if(ex)await sbDelete('zug_rides','ride_date=eq.'+iso);}
    else await sbUpsert('zug_rides',{ride_date:iso,driver_name:driver,vip_name:vip,auto:false,updated_by:APP.user.playerName,updated_at:new Date().toISOString()},'alliance_id,ride_date');
    await zugReload();
  }catch(e){alert('Speichern fehlgeschlagen: '+e.message);}
  APP.zugBusy=false;renderPage();
}

export async function zugAcceptAll(){
  if(!canAccess('zugfahrt')||APP.zugBusy)return;
  const toSave=zugBuildPlan().filter(d=>(!d.driver&&d.suggD)||(!d.vip&&d.suggV))
    .map(d=>({ride_date:d.iso,driver_name:d.effDriver||null,vip_name:d.effVip||null,auto:!d.saved,updated_by:APP.user.playerName,updated_at:new Date().toISOString()}));
  if(!toSave.length){alert('Keine offenen Vorschläge zum Übernehmen.');return;}
  APP.zugBusy=true;renderPage();
  try{await sbUpsert('zug_rides',toSave,'alliance_id,ride_date');await zugReload();}
  catch(e){alert('Speichern fehlgeschlagen: '+e.message);}
  APP.zugBusy=false;renderPage();
}

// Rendert den 7-Tage-Plan als PNG-Canvas (analog WS-Aufstellung).
export function _buildZugCanvas(){
  const plan=zugBuildPlan();
  const roleOf=n=>{const p=APP.data.players.find(x=>x.name===n);return p?(p.role||'R3'):'';};
  const S=2,W=470*S,pad=14*S;
  const titleH=58*S,colHdrH=26*S,rowH=36*S,footH=30*S;
  const totalH=titleH+colHdrH+plan.length*rowH+footH;
  const c=document.createElement('canvas');c.width=W;c.height=totalH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#f8f9fc';ctx.fillRect(0,0,W,totalH);
  const fit=(t,maxW)=>{if(ctx.measureText(t).width<=maxW)return t;let s=t;while(s.length>1&&ctx.measureText(s+'…').width>maxW)s=s.slice(0,-1);return s+'…';};
  // Spalten
  const cx1=pad+6*S, cx2=pad+162*S, cx3=pad+318*S;
  const wDrv=cx3-cx2-10*S, wVip=W-pad-cx3-6*S;
  // Titelband
  ctx.fillStyle='#2c3e6b';ctx.fillRect(0,0,W,titleH);
  ctx.textAlign='left';
  ctx.font=`800 ${17*S}px Arial`;ctx.fillStyle='#fff';
  ctx.fillText(trs('Zugfahrt — Einteilung'),pad,29*S);
  ctx.font=`${11*S}px Arial`;ctx.fillStyle='#c9d3ee';
  const range=zugFmtISO(plan[0].iso).slice(0,6)+' – '+zugFmtISO(plan[plan.length-1].iso);
  ctx.fillText(allianceLabel()+'   ·   '+range,pad,47*S);
  // Spaltenkopf
  let y=titleH;
  ctx.fillStyle='#eef1f8';ctx.fillRect(0,y,W,colHdrH);
  ctx.font=`800 ${10*S}px Arial`;ctx.fillStyle='#5a6278';
  ctx.fillText(trs('TAG'),cx1,y+17*S);ctx.fillText(trs('ZUGFÜHRER'),cx2,y+17*S);ctx.fillText('VIP',cx3,y+17*S);
  y+=colHdrH;
  const WD=ZUG_WD_LONG;
  const drawName=(name,x,maxW)=>{
    if(!name){ctx.font=`${13*S}px Arial`;ctx.fillStyle='#bbb';ctx.fillText('–',x,y+rowH/2+5*S);return;}
    ctx.font=`700 ${12*S}px Arial`;ctx.fillStyle='#1a1d2e';ctx.fillText(fit(name,maxW),x,y+16*S);
    ctx.font=`${9*S}px Arial`;ctx.fillStyle='#8892a4';ctx.fillText(trs(roleOf(name)),x,y+28*S);
  };
  plan.forEach((d,i)=>{
    ctx.fillStyle=i%2?'#ffffff':'#f4f6fb';ctx.fillRect(0,y,W,rowH);
    if(d.conductor){ctx.fillStyle='#c0392b';ctx.fillRect(0,y,4*S,rowH);}
    ctx.font=`800 ${12*S}px Arial`;ctx.fillStyle='#1a1d2e';
    ctx.fillText(WD[d.wd],cx1,y+16*S);
    const wdw=ctx.measureText(WD[d.wd]).width;
    if(d.conductor){ctx.font=`700 ${8*S}px Arial`;ctx.fillStyle='#c0392b';ctx.fillText('R4/R5',cx1+wdw+6*S,y+15*S);}
    ctx.font=`${9*S}px Arial`;ctx.fillStyle='#8892a4';ctx.fillText(zugFmtISO(d.iso),cx1,y+28*S);
    drawName(d.effDriver,cx2,wDrv);
    drawName(d.effVip,cx3,wVip);
    y+=rowH;
  });
  ctx.font=`${9*S}px Arial`;ctx.fillStyle='#8892a4';
  ctx.fillText(trs('Stand ')+zugFmtISO(zugISO(new Date()))+trs('   ·   rot = Zugführer-Tag (Mo/Mi/Fr, R4/R5)'),pad,y+19*S);
  return c;
}
export async function zugDownloadPng(btn){
  const o=btn?btn.textContent:'';if(btn){btn.textContent='⏳';btn.disabled=true;}
  try{
    const c=_buildZugCanvas();const a=document.createElement('a');
    a.href=c.toDataURL('image/png');a.download='zugfahrt_'+zugISO(new Date())+'.png';a.target='_blank';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    if(btn)btn.textContent='✓ Erstellt';
  }catch(e){alert('Fehler: '+e.message);if(btn)btn.textContent=o;}
  if(btn)setTimeout(()=>{btn.textContent=o;btn.disabled=false;},1800);
}
export async function zugSharePng(btn){
  const o=btn?btn.textContent:'';if(btn){btn.textContent='⏳';btn.disabled=true;}
  try{
    const c=_buildZugCanvas();
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    const file=new File([blob],'zugfahrt.png',{type:'image/png'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:'Zugfahrt-Einteilung'});
      if(btn)btn.textContent=o;
    }else{
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      if(btn)btn.textContent='✓ Kopiert';
    }
  }catch(e){if(e&&e.name!=='AbortError')alert('Teilen/Kopieren fehlgeschlagen: '+e.message);if(btn)btn.textContent=o;}
  if(btn)setTimeout(()=>{btn.textContent=o;btn.disabled=false;},1800);
}

export function pageZugfahrt(){
  const canEdit=canAccess('zugfahrt');
  const tab=APP.zugTab||'plan';
  let h=`<div class="stabs">
    <button class="stab${tab==='plan'?' on':''}" onclick="APP.zugTab='plan';renderPage()">Einteilung (7 Tage)</button>
    <button class="stab${tab==='stats'?' on':''}" onclick="APP.zugTab='stats';renderPage()">Spieler-Übersicht</button>
  </div>`;

  if(tab==='plan'){
    const plan=zugBuildPlan();
    const openSugg=plan.filter(d=>(!d.driver&&d.suggD)||(!d.vip&&d.suggV)).length;
    h+=`<div class="note info" style="margin-bottom:10px">🚂 <b>Zugführer-Tage Mo/Mi/Fr</b> → automatisch ein R4/R5. Andere Tage fahren die restlichen Spieler. Vorschläge folgen einer fairen Rotation (wenigste Fahrten zuerst).${canEdit?' Du kannst jede Einteilung überschreiben.':' Nur R4/R5 können ändern.'}</div>`;
    h+=`<div style="display:flex;gap:6px;margin-bottom:10px">
      <button class="btn btn-sol" style="flex:1" onclick="zugDownloadPng(this)">📷 Bild erstellen</button>
      <button class="btn btn-out" style="flex:1" onclick="zugSharePng(this)">📤 Teilen / Kopieren</button>
    </div>`;
    if(canEdit&&openSugg)h+=`<button class="btn btn-sol" style="width:100%;margin-bottom:10px"${APP.zugBusy?' disabled':''} onclick="zugAcceptAll()">${APP.zugBusy?'…':'✓ Alle '+openSugg+' Vorschläge übernehmen'}</button>`;
    h+=plan.map(d=>{
      const dateLbl=`${ZUG_WD_LONG[d.wd]}, ${zugFmtISO(d.iso).slice(0,6)}`;
      const condBadge=d.conductor?badge('Zugführer-Tag','#c0392b'):'';
      const hasOpen=(!d.driver&&d.suggD)||(!d.vip&&d.suggV);
      const statusBadge=!d.saved?badge('Vorschlag','#e8a020'):hasOpen?badge('Teils gesetzt','#e8a020'):d.auto?badge('Auto','#7f8c8d'):badge('Gesetzt','#27ae60');
      let body;
      if(canEdit){
        body=`<div class="sg" style="margin-top:8px">
          <div><div class="sb-l" style="margin-bottom:3px">Zugführer</div>
            <select class="fi" style="width:100%"${APP.zugBusy?' disabled':''} onchange="zugSetField('${d.iso}','driver',this.value)">${zugPlayerOptions(d.effDriver)}</select></div>
          <div><div class="sb-l" style="margin-bottom:3px">VIP</div>
            <select class="fi" style="width:100%"${APP.zugBusy?' disabled':''} onchange="zugSetField('${d.iso}','vip',this.value)">${zugPlayerOptions(d.effVip)}</select></div>
        </div>`;
      }else{
        body=`<div class="sg" style="margin-top:8px">
          <div class="sb"><div class="sb-l">Zugführer</div><div class="sb-v" style="font-size:14px">${d.effDriver||'–'}</div></div>
          <div class="sb"><div class="sb-l">VIP</div><div class="sb-v" style="font-size:14px">${d.effVip||'–'}</div></div>
        </div>`;
      }
      return`<div class="card" style="margin-bottom:8px"><div class="cb">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <div style="font-weight:800;color:var(--tx)">${dateLbl}</div>${condBadge}<div style="margin-left:auto">${statusBadge}</div>
        </div>${body}
      </div></div>`;
    }).join('');
    return h;
  }

  // ===== Spieler-Übersicht =====
  const st=zugStats();
  const sort=APP.zugSort||'count';
  const active=APP.data.players.filter(p=>p.active!==false);
  const rowsData=active.map(p=>({name:p.name,role:p.role||'R3',count:st.drvPast[p.name]||0,last:st.lastDrv[p.name]||'',vip:st.vipPast[p.name]||0}));
  rowsData.sort((a,b)=>{
    if(sort==='name')return a.name.localeCompare(b.name);
    if(sort==='last'){if((b.last||'')!==(a.last||''))return(b.last||'').localeCompare(a.last||'');return b.count-a.count;}
    if(b.count!==a.count)return b.count-a.count; // 'count'
    return(a.last||'').localeCompare(b.last||''); // gleichviel → wer am längsten nicht fuhr zuerst
  });
  const sb=(k,l)=>`<button class="btn btn-sm ${sort===k?'btn-sol':'btn-out'}" onclick="APP.zugSort='${k}';renderPage()">${l}</button>`;
  h+=`<div style="display:flex;gap:5px;margin-bottom:10px">${sb('count','Fahrten')}${sb('last','Letzte Fahrt')}${sb('name','Name')}</div>`;
  h+=`<div class="card"><div class="cb" style="padding:0">${rowsData.map(r=>{
    const ago=zugDaysAgo(r.last);
    const lastTxt=r.last?`${zugFmtISO(r.last)}${ago===0?' · heute':ago===1?' · gestern':ago>1?' · vor '+ago+' T.':''}`:'noch nie';
    return`<div class="mi">${roleDot(r.role,false,r.name)}
      <div style="flex:1;min-width:0"><div class="mn">${r.name}</div><div class="mm">${lastTxt}${r.vip?' · VIP ×'+r.vip:''}</div></div>
      <div style="text-align:right"><div style="font-weight:800;font-size:17px;color:${r.count?'var(--primary)':'var(--tx3)'}">${r.count}</div><div class="mm">Fahrten</div></div>
    </div>`;
  }).join('')||'<div class="cb" style="color:var(--tx3)">Keine Spieler.</div>'}</div></div>`;
  return h;
}
