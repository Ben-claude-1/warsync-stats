import { renderPage, setTeam, setWSView } from '../app/render.js';
import { sbDelete, sbGet, sbPatch, sbPost, sbPostRet } from '../core/api.js';
import { VISION_URL, VS_TARGET, visionErr } from '../core/config.js';
import { badge, canAccess, fmt, fmtMio, getBldSlots, getLineup, getLineupReady, getZoneSlots, powerTag, setLineup, setLineupReady, setWsStrength, strengthPicker, wsPower, zeitLang } from '../core/helpers.js';
import { avatarImg, isInactive } from '../core/players.js';
import { APP } from '../core/state.js';
import { BLD_META, _bldShort, _zoneBlds, autoAssign, autoAssignBld, changeBldSlot, cycleBldAssign, renderStrategyCard, resetLineup, saveWSState } from './buildings.js';
import { showWSAufstellungKarte } from './karte.js';
import { openPlayer } from './overlay.js';
import { _startAnalysisProgress, wsIstErsatz, wsPoolSort, wsTeamPool, wsZeit, wsZeitPicker } from './ws.js';

// Zwischenstand der Ergebnis-Erfassung — lebt nur, solange die VS-Seite offen ist.
let _vsResultData=[];

// ====== VS-DUELL ======
export function getKW(dateStr){
  const d=new Date(dateStr+'T12:00:00');
  const jan4=new Date(d.getFullYear(),0,4);
  const startOfWeek1=new Date(jan4);
  startOfWeek1.setDate(jan4.getDate()-(jan4.getDay()||7)+1);
  return Math.floor((d-startOfWeek1)/604800000)+1;
}
export function pageVS(){
  const sub=APP.vsView||'ranking';
  const canW=canAccess('ws');
  let h=`<div class="hd"><div class="ht">VS-Duell</div></div>`;
  h+=`<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
    <button class="btn btn-sm ${sub==='ranking'?'btn-sol':'btn-out'}" onclick="APP.vsView='ranking';renderPage()">📊 Woche</button>
    <button class="btn btn-sm ${sub==='overall'?'btn-sol':'btn-out'}" onclick="APP.vsView='overall';renderPage()">🏆 Gesamt</button>
    ${canW?`<button class="btn btn-sm ${sub==='upload'?'btn-sol':'btn-out'}" onclick="APP.vsView='upload';renderPage()">📷 Hochladen</button>`:''}
  </div>`;
  if(sub==='upload'&&canW)h+=vsUploadSection();
  else if(sub==='overall')h+=vsOverallSection();
  else h+=vsWeekSection();
  return h;
}

export function vsWeekSection(){
  const weeks=APP.data.vsWeeks||[];
  if(!weeks.length)return'<div class="note">Noch keine Daten — bitte Screenshots hochladen (📷 Hochladen).</div>';
  const selId=APP.vsWeekId||weeks[0]?.id;
  const week=weeks.find(w=>w.id===selId)||weeks[0];
  const entries=(APP.data.vsEntries||[]).filter(e=>e.week_id===week?.id);
  const weekOpts=weeks.map(w=>`<option value="${w.id}"${w.id===selId?' selected':''}>KW${getKW(w.week_start)} · ${w.week_start}</option>`).join('');
  let h=`<div style="margin-bottom:14px">
    <select class="fi" onchange="APP.vsWeekId=this.value;renderPage()">${weekOpts}</select>
  </div>`;
  if(!entries.length)return h+'<div class="note">Keine Einträge für diese Woche.</div>';
  h+=vsStatCards(entries,1);
  h+=vsRankTable(entries,VS_TARGET,1,false);
  return h;
}

export function vsOverallSection(){
  const weeks=APP.data.vsWeeks||[];
  const allEntries=APP.data.vsEntries||[];
  if(!weeks.length)return'<div class="note">Noch keine Daten.</div>';
  const from=APP.vsFromDate||weeks[weeks.length-1]?.week_start||'';
  const to=APP.vsToDate||weeks[0]?.week_start||'';
  const filtIds=new Set(weeks.filter(w=>w.week_start>=from&&w.week_start<=to).map(w=>w.id));
  const inactiveNames=new Set((APP.data.players||[]).filter(p=>p.active===false).map(p=>p.name));
  const filtEntries=allEntries.filter(e=>filtIds.has(e.week_id)&&!inactiveNames.has(e.player_name));
  const weekCount=filtIds.size;
  const byPl={};
  filtEntries.forEach(e=>{
    if(!byPl[e.player_name])byPl[e.player_name]={player_name:e.player_name,pts:0,weeks:0,belowTarget:0};
    byPl[e.player_name].pts+=e.pts;
    byPl[e.player_name].weeks++;
    if(e.pts<VS_TARGET)byPl[e.player_name].belowTarget++;
  });
  const agg=Object.values(byPl);
  let h=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
    <div class="fl2"><label style="font-size:11px">Von (Montag)</label><input type="date" class="fi" value="${from}" onchange="APP.vsFromDate=this.value;renderPage()"></div>
    <div class="fl2"><label style="font-size:11px">Bis (Montag)</label><input type="date" class="fi" value="${to}" onchange="APP.vsToDate=this.value;renderPage()"></div>
  </div>`;
  if(!agg.length)return h+'<div class="note">Keine Daten im gewählten Zeitraum.</div>';
  h+=vsStatCards(agg,weekCount);
  h+=vsRankTable(agg,VS_TARGET*weekCount,weekCount,true);
  return h;
}

export function vsStatCards(entries,weekCount){
  const total=entries.reduce((s,e)=>s+e.pts,0);
  const avg=entries.length?Math.round(total/entries.length):0;
  const target=VS_TARGET*weekCount;
  const above=entries.filter(e=>e.pts>=target).length;
  return`<div class="sg" style="margin-bottom:12px">
    <div class="sb"><div class="sb-l">Spieler</div><div class="sb-v">${entries.length}</div></div>
    <div class="sb"><div class="sb-l">Gesamt</div><div class="sb-v" style="font-size:13px">${fmtMio(total)}</div></div>
    <div class="sb"><div class="sb-l">Ziel erreicht</div><div class="sb-v" style="color:var(--win)">${above}/${entries.length}</div></div>
    <div class="sb"><div class="sb-l">Ø/Spieler</div><div class="sb-v" style="font-size:13px">${fmtMio(avg)}</div></div>
  </div>`;
}

export function vsRankTable(entries,target,weekCount,showMissed){
  const sorted=[...entries].sort((a,b)=>b.pts-a.pts);
  const medals=['🥇','🥈','🥉'];
  const rowBg=['background:rgba(255,215,0,.12)','background:rgba(192,192,192,.12)','background:rgba(205,127,50,.12)'];
  const rows=sorted.map((e,i)=>{
    const rank=i+1;
    const medal=rank<=3?`<span style="font-size:${rank===1?22:18}px">${medals[rank-1]}</span>`:`<span style="font-size:14px;color:var(--tx3)">${rank}</span>`;
    const bg=rank<=3?rowBg[rank-1]:'';
    const playerWeeks=showMissed?(e.weeks||1):1;
    const playerTarget=VS_TARGET*playerWeeks;
    const pct=playerTarget?Math.min(Math.round(e.pts/playerTarget*100),999):0;
    const barW=Math.min(pct,100);
    const barColor=pct>=100?'var(--win)':pct>=80?'var(--acc)':'var(--loss)';
    const isLow=showMissed?(e.belowTarget||0)>playerWeeks*0.5:(target&&e.pts<target);
    const lowBadge=isLow?`<span style="font-size:9px;background:var(--loss);color:#fff;border-radius:4px;padding:1px 5px;margin-left:5px;vertical-align:middle">unter Ziel</span>`:'';
    const ap=APP.data.players.find(p=>p.name===e.player_name);
    const safeN=(e.player_name||'').replace(/'/g,"\\'");
    const nameHtml=ap?`<span style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${safeN}')">${e.player_name}</span>`:
      `<span style="color:var(--loss)" title="Kein Allianz-Spieler gefunden">${e.player_name}</span>`;
    const teilCol=weekCount>1?`<td style="text-align:center;white-space:nowrap;padding:6px 4px;font-size:12px;color:var(--tx3)">${e.weeks||1}<span style="font-size:10px">/${weekCount}</span></td>`:'';
    return`<tr style="${bg}">
      <td style="text-align:center;padding:6px 4px">${medal}</td>
      <td style="font-weight:700;font-size:13px;padding:6px 4px">${nameHtml}${lowBadge}</td>
      ${teilCol}
      <td style="text-align:right;font-weight:800;white-space:nowrap;padding:6px 4px">${fmtMio(e.pts)}</td>
      <td style="min-width:90px;padding:6px 4px">
        <div style="background:var(--bg);border-radius:4px;height:6px;overflow:hidden;margin-bottom:2px">
          <div style="height:100%;width:${barW}%;background:${barColor};border-radius:4px"></div>
        </div>
        <div style="font-size:10px;color:${barColor};text-align:right;font-weight:700">${pct}%</div>
      </td>
    </tr>`;
  }).join('');
  const targetLabel=weekCount>1?`${weekCount} Wochen × ${fmtMio(VS_TARGET)}`:`Wochenziel: ${fmtMio(VS_TARGET)}`;
  const teilHead=weekCount>1?`<th style="text-align:center;white-space:nowrap">Teiln.</th>`:'';
  return`<div class="card"><div class="ch">${weekCount>1?'Gesamt-Ranking':'Wochen-Ranking'} <span class="ch-sub">${targetLabel}</span></div><div class="scroll-x"><table><thead><tr><th style="width:36px">#</th><th>Spieler</th>${teilHead}<th style="text-align:right">Punkte</th><th>Zielquote</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

export function vsUploadSection(){
  const now=new Date();
  const day=now.getDay();
  const diff=day===0?-6:1-day;
  const mon=new Date(now);mon.setDate(now.getDate()+diff);
  const monStr=`${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  const weeks=APP.data.vsWeeks||[];
  const wOpts=weeks.map(w=>`<option value="${w.id}">KW${getKW(w.week_start)} · ${w.week_start}</option>`).join('');
  return`<div class="card"><div class="ch">Screenshots hochladen <span class="ch-sub">Wochen-Rang aus dem Spiel</span></div><div class="cb">
    <div class="fl2" style="margin-bottom:10px">
      <label>Wochenbeginn (Montag dieser Woche)</label>
      <input type="date" class="fi" id="vs-week-date" value="${monStr}">
    </div>
    <div class="fl2" style="margin-bottom:8px">
      <label>Screenshots (Wochen-Rang – mehrere möglich wenn nicht alle sichtbar)</label>
      <input type="file" id="vs-shots" multiple accept="image/*" onchange="vsShowPreviews()" style="width:100%;padding:6px 0">
    </div>
    <div id="vs-previews" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
      <button class="btn btn-sol" id="vs-analyze-btn" onclick="vsAnalyze()">🔍 Analysieren</button>
      <span id="vs-analyze-status" style="font-size:12px;color:var(--tx3)"></span>
    </div>
    <div id="vs-result-section" style="display:none">
      <hr style="border:none;border-top:1px solid var(--bd);margin:12px 0">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">Erkannte Spieler <span style="font-size:11px;font-weight:400;color:var(--tx3)">– Name/Punkte korrigierbar</span></div>
      <div class="scroll-x" id="vs-result-table"></div>
      <button class="btn btn-sol" style="width:100%;margin-top:12px" id="vs-save-btn" onclick="vsSave()">Speichern</button>
    </div>
    ${weeks.length?`<hr style="border:none;border-top:1px solid var(--bd);margin:16px 0"><div style="font-size:12px;color:var(--tx3);font-weight:600;margin-bottom:8px">Bestehende Wochen (zum Überschreiben Datum wählen)</div><div style="font-size:12px;color:var(--tx3)">${weeks.map(w=>`KW${getKW(w.week_start)} · ${w.week_start}`).join(' · ')}</div>`:''}
    ${(()=>{
      const allianceSet=new Set(APP.data.players.map(p=>p.name));
      const unmatched=[...new Set((APP.data.vsEntries||[]).map(e=>e.player_name))].filter(n=>!allianceSet.has(n)).sort();
      if(!unmatched.length)return'';
      const activePlayers=APP.data.players.filter(p=>!isInactive(p.name)).map(p=>p.name).sort((a,b)=>a.localeCompare(b));
      const rows=unmatched.map((n,i)=>{
        const m=_bestVsMatch(n);
        const opts='<option value="">– Allianz-Spieler wählen –</option>'+activePlayers.map(an=>`<option value="${an.replace(/"/g,'&quot;')}"${an===m?.player.name?' selected':''}>${an}</option>`).join('');
        return`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bd);flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;flex:1;min-width:100px;color:var(--loss)">${n}</span>
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;flex-shrink:0;fill:none;stroke:var(--tx3);stroke-width:2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          <select id="vs-fix-${i}" class="fi" style="flex:2;min-width:140px;padding:4px 8px;font-size:12px">${opts}</select>
          <button class="btn btn-sm btn-sol" onclick="vsApplyFix('${n.replace(/'/g,"\\'")}','${i}')">Korrigieren</button>
        </div>`;
      }).join('');
      return`<hr style="border:none;border-top:1px solid var(--bd);margin:16px 0">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:var(--loss)">⚠ Bestehende Zuordnungen prüfen (${unmatched.length})</div>
        <div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Diese Namen aus vorhandenen VS-Daten stimmen mit keinem Allianz-Spieler überein.</div>
        ${rows}`;
    })()}
  </div></div>`;
}

export function vsShowPreviews(){
  const files=document.getElementById('vs-shots')?.files;
  const box=document.getElementById('vs-previews');
  if(!files||!box)return;
  box.innerHTML='';
  Array.from(files).forEach(f=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=document.createElement('img');
      img.src=e.target.result;
      img.style.cssText='height:120px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer';
      img.onclick=()=>window.open(e.target.result);
      box.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}

export function _nameSimilarity(a,b){
  a=(a||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  b=(b||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(!a||!b)return 0;if(a===b)return 1;
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return 1-dp[m][n]/Math.max(m,n);
}
export function _bestVsMatch(name){
  let best=null,bestScore=0;
  for(const kp of APP.data.players){
    const s=_nameSimilarity(name,kp.name);
    if(s>bestScore){best=kp;bestScore=s;}
  }
  if(bestScore>=0.72)return{player:best,score:bestScore,status:bestScore>=0.999?'exact':'fuzzy'};
  return null;
}
export let _vsMatchData=[];
export function vsResultTableHtml(players){
  _vsResultData=[...players].sort((a,b)=>(a.rank||999)-(b.rank||999));
  _vsMatchData=_vsResultData.map(p=>{
    const m=_bestVsMatch(p.name);
    return{recognized:p.name,dbName:m?m.player.name:null,pts:p.pts,rank:p.rank,status:m?m.status:'none'};
  });
  const counts={exact:0,fuzzy:0,none:0};
  _vsMatchData.forEach(m=>counts[m.status=(m.status||'none')]++);
  const bgColor={exact:'#f0fff4',fuzzy:'#fffde7',none:'#fff8f0'};
  const badgeHtml={exact:'<span style="color:var(--win);font-weight:700;font-size:14px">✓</span>',fuzzy:'<span style="color:#e67e22;font-weight:700;font-size:14px">≈</span>',none:'<span style="color:var(--loss);font-weight:700;font-size:14px">?</span>'};
  const activePlayers=APP.data.players.filter(p=>!isInactive(p.name)).map(p=>p.name).sort((a,b)=>a.localeCompare(b));
  const makeOpts=(preselect)=>'<option value="">– Allianz-Spieler wählen –</option>'+activePlayers.map(n=>`<option value="${n.replace(/"/g,'&quot;')}"${n===preselect?' selected':''}>${n}</option>`).join('');
  const rows=_vsMatchData.map((m,i)=>{
    let nameCell;
    if(m.status==='exact'){
      nameCell=`<span style="font-weight:600;font-size:13px">${m.dbName}</span><input type="hidden" id="vsr-link-${i}" value="${(m.dbName||'').replace(/"/g,'&quot;')}">`;
    }else if(m.status==='fuzzy'){
      nameCell=`<div style="font-size:10px;color:var(--tx3);margin-bottom:4px">Screenshot: <b>${m.recognized}</b></div>
        <select id="vsr-link-${i}" class="fi" style="width:100%;padding:3px 6px;font-size:12px;margin:0">${makeOpts(m.dbName)}</select>`;
    }else{
      nameCell=`<div style="font-size:10px;color:var(--tx3);margin-bottom:4px">Nicht erkannt: <b>${m.recognized}</b></div>
        <select id="vsr-link-${i}" class="fi" style="width:100%;padding:3px 6px;font-size:12px;margin:0;border-color:var(--loss)">${makeOpts('')}</select>`;
    }
    return`<tr style="background:${bgColor[m.status]}">
      <td style="text-align:center;font-size:11px;color:var(--tx3);padding:4px;white-space:nowrap">${m.rank||i+1}</td>
      <td style="text-align:center;padding:4px">${badgeHtml[m.status]}</td>
      <td style="padding:4px 8px">${nameCell}</td>
      <td style="text-align:right;padding:4px;white-space:nowrap"><input type="number" class="fi" id="vsr-pts-${i}" value="${m.pts||''}" style="width:100px;text-align:right;padding:3px 6px;font-size:12px;margin:0"></td>
    </tr>`;
  }).join('');
  return`<div style="display:flex;gap:16px;margin-bottom:8px;font-size:12px;flex-wrap:wrap">
    <span style="color:var(--win)">✓ ${counts.exact} exakt</span>
    <span style="color:#e67e22">≈ ${counts.fuzzy} bitte bestätigen</span>
    <span style="color:var(--loss)">? ${counts.none} manuell zuordnen</span>
    <span style="color:var(--tx3)">${_vsMatchData.length} gesamt</span>
  </div>
  <div style="max-height:500px;overflow-y:auto">
  <table style="width:100%"><thead><tr><th style="padding:4px">#</th><th></th><th>Spieler</th><th style="text-align:right">Punkte</th></tr></thead>
  <tbody>${rows}</tbody></table></div>
  <div style="font-size:11px;color:var(--tx3);margin-top:6px">Gelb = korrekten Allianz-Spieler bestätigen · Orange = manuell zuordnen · Es werden keine neuen Spieler angelegt</div>`;
}

export async function vsAnalyze(){
  const files=document.getElementById('vs-shots')?.files;
  if(!files||!files.length){alert('Bitte Screenshots auswählen.');return;}
  const statusEl=document.getElementById('vs-analyze-status');
  const btn=document.getElementById('vs-analyze-btn');
  if(btn)btn.disabled=true;
  const stop=_startAnalysisProgress(statusEl);
  try{
    const images=await Promise.all(Array.from(files).map(f=>new Promise((res,rej)=>{
      const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(f);
    })));
    const knownPlayers=APP.data.players.map(p=>p.name);
    const resp=await fetch(VISION_URL()+'/analyze-vs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,known_players:knownPlayers})});
    if(!resp.ok)throw new Error(`Vision-Server: HTTP ${resp.status}`);
    const data=await resp.json();
    if(data.error)throw new Error(data.error);
    const rs=document.getElementById('vs-result-section');
    const rt=document.getElementById('vs-result-table');
    if(rs)rs.style.display='';
    if(rt)rt.innerHTML=vsResultTableHtml(data.players||[]);
    const cnt=(data.players||[]).length;
    const perImg=(data.per_image||[]).join(' · ');
    const warn=(data.warnings||[]).length?`<br><span style="color:var(--loss);font-size:11px">${(data.warnings||[]).join(' · ')}</span>`:'';
    stop(true,`<span style="color:var(--win)">✓ ${cnt} Spieler erkannt</span>${warn}<br><span style="font-size:11px;color:var(--tx3)">${perImg}</span>`);
  }catch(e){
    stop(false,`<span style="color:var(--loss)">❌ ${visionErr(e)}</span>`);
  }
  if(btn)btn.disabled=false;
}

export async function vsSave(){
  const weekDate=document.getElementById('vs-week-date')?.value;
  if(!weekDate){alert('Bitte Wochenbeginn angeben.');return;}
  // Alle Zuordnungen auslesen
  const missing=_vsMatchData.filter((_,i)=>!(document.getElementById('vsr-link-'+i)?.value));
  if(missing.length){alert(`${missing.length} Spieler noch nicht zugeordnet — bitte alle Dropdowns ausfüllen.`);return;}
  const resolved=_vsMatchData.map((m,i)=>({
    name:document.getElementById('vsr-link-'+i)?.value||'',
    pts:parseInt(document.getElementById('vsr-pts-'+i)?.value)||0,
    rank:m.rank||(i+1)
  })).filter(e=>e.name&&e.pts>0);
  if(!resolved.length){alert('Keine gültigen Einträge.');return;}
  const btn=document.getElementById('vs-save-btn');
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    // Woche anlegen/finden
    let week=(APP.data.vsWeeks||[]).find(w=>w.week_start===weekDate);
    if(!week)week=(await sbPostRet('vs_weeks',{week_start:weekDate}))[0];
    // Einträge speichern (immer Allianz-Namen)
    await sbDelete('vs_entries','week_id=eq.'+week.id);
    await sbPost('vs_entries',resolved.map(e=>({week_id:week.id,player_name:e.name,pts:e.pts,rank:e.rank})));
    const[vsw,vse]=await Promise.all([sbGet('vs_weeks?order=week_start.desc'),sbGet('vs_entries?order=pts.desc')]);
    APP.data.vsWeeks=vsw;APP.data.vsEntries=vse;
    APP.vsWeekId=week.id;APP.vsView='ranking';
    renderPage();
  }catch(e){
    alert('Fehler: '+e.message);
    if(btn){btn.textContent='Speichern';btn.disabled=false;}
  }
}
export async function vsApplyFix(oldName,idx){
  const newName=document.getElementById('vs-fix-'+idx)?.value;
  if(!newName){alert('Bitte einen Allianz-Spieler wählen.');return;}
  try{
    await sbPatch('vs_entries','player_name=eq.'+encodeURIComponent(oldName),{player_name:newName});
    APP.data.vsEntries=await sbGet('vs_entries?order=pts.desc');
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}

// --- VERLAUF ---
export function wsVerlauf(){
  const evts=APP.data.events.filter(e=>e.team===APP.team&&e.result!=='pending');
  const wins=evts.filter(e=>e.result==='win').length;
  const losses=evts.filter(e=>e.result==='loss').length;
  const rate=evts.length?Math.round(wins/evts.length*100):0;
  return`<div class="sg"><div class="sb"><div class="sb-l">Siege</div><div class="sb-v" style="color:var(--win)">${wins}</div></div><div class="sb"><div class="sb-l">Niederlagen</div><div class="sb-v" style="color:var(--loss)">${losses}</div></div><div class="sb"><div class="sb-l">Siegquote</div><div class="sb-v" style="color:var(--win)">${rate}%</div></div><div class="sb"><div class="sb-l">Events</div><div class="sb-v">${evts.length}</div></div></div>
    <div class="card" style="padding:14px;margin-bottom:12px"><div style="font-size:11px;color:var(--tx3);text-transform:uppercase;font-weight:600;letter-spacing:.04em;margin-bottom:10px">Verlauf</div><div class="wh">${evts.map(e=>{const c=e.result==='win'?'var(--win)':'var(--loss)';return`<div class="wh-d" style="background:${c}22;color:${c}" title="${e.event_date} vs ${e.opponent||'?'}">${e.result==='win'?'S':'N'}</div>`;}).join('')}</div></div>
    <div class="card"><div class="ch">Alle Kämpfe – Team ${APP.team}</div><div class="scroll-x"><table><thead><tr><th>Datum</th><th>Gegner</th><th>Wir</th><th>Gegner</th><th>Diff</th><th>Ergebnis</th></tr></thead><tbody>${evts.map(e=>{const c=e.result==='win'?'var(--win)':'var(--loss)';const diff=e.our_pts&&e.opp_pts?(e.our_pts>e.opp_pts?'+':'')+fmt(e.our_pts-e.opp_pts):'–';return`<tr><td style="white-space:nowrap">${e.event_date}</td><td>${e.opponent||'–'}</td><td><strong>${fmt(e.our_pts)}</strong></td><td>${fmt(e.opp_pts)}</td><td style="color:${c};font-weight:700">${diff}</td><td>${badge(e.result==='win'?'Sieg':'Niederlage',c)}</td></tr>`;}).join('')}</tbody></table></div></div>`;}

// --- GEBÄUDE-INFO-KARTE ---
export function buildingInfoCard(side,open){
  const stealZone=side==='left'?'Z4':'Z2';
  const stealLabel=side==='left'?'Zone 4 – Lazarett (links, näher am Gegner)':'Zone 2 – Lazarett (rechts, näher am Gegner)';

  // Zone colors matching game image
  const zColors={Z1:'#c0392b',Z2:'#e8a020',Z3:'#27ae60',Z4:'#2980b9',Z5:'#7c3aed'};

  // SVG zone map based on actual game image
  // Layout: sand background, cross dividers, Z1 top-left, Z2 top-right, Z3 bottom-right, Z4 bottom-left, Z5 center vertical rectangle
  function svgMap(){
    const w=300,h=240;
    const cx=w/2,cy=h/2;
    const z5w=56,z5h=130;
    const isStealZ4=stealZone==='Z4';
    const isStealZ2=stealZone==='Z2';

    return`<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:300px;display:block;margin:0 auto;border-radius:10px;border:1px solid var(--bd)" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${w}" height="${h}" fill="#d4b896" rx="10"/>
      <!-- Cross dividers -->
      <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="#a08060" stroke-width="2"/>
      <line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="#a08060" stroke-width="2"/>

      <!-- Z1: top-left (Ölraffinerie + Info Center) -->
      <rect x="4" y="4" width="${cx-6}" height="${cy-6}" fill="${zColors.Z1}22" rx="6" stroke="${zColors.Z1}" stroke-width="1.5"/>
      <text x="14" y="22" font-size="13" font-weight="800" fill="${zColors.Z1}" font-family="sans-serif">Z1</text>
      <text x="14" y="37" font-size="9" fill="${zColors.Z1}" font-family="sans-serif">Ölraffinerie</text>
      <text x="14" y="49" font-size="9" fill="${zColors.Z1}" font-family="sans-serif">+ Info Center</text>

      <!-- Z2: top-right (2× Lazarett) -->
      ${isStealZ2
        ?`<rect x="${cx+2}" y="4" width="${cx-6}" height="${cy-6}" fill="${zColors.Z2}18" rx="6" stroke="${zColors.Z2}" stroke-width="2.5" stroke-dasharray="6,3"/>`
        :`<rect x="${cx+2}" y="4" width="${cx-6}" height="${cy-6}" fill="${zColors.Z2}22" rx="6" stroke="${zColors.Z2}" stroke-width="1.5"/>`}
      <text x="${cx+10}" y="22" font-size="13" font-weight="800" fill="${zColors.Z2}" font-family="sans-serif">Z2</text>
      <text x="${cx+10}" y="37" font-size="9" fill="${zColors.Z2}" font-family="sans-serif">2× Lazarett</text>
      ${isStealZ2?`<text x="${cx+10}" y="54" font-size="10" font-weight="800" fill="${zColors.Z2}" font-family="sans-serif">⚠ LEER</text>`:''}

      <!-- Z3: bottom-right (Ölraffinerie + Tech Center) -->
      <rect x="${cx+2}" y="${cy+2}" width="${cx-6}" height="${cy-6}" fill="${zColors.Z3}22" rx="6" stroke="${zColors.Z3}" stroke-width="1.5"/>
      <text x="${cx+10}" y="${cy+18}" font-size="13" font-weight="800" fill="${zColors.Z3}" font-family="sans-serif">Z3</text>
      <text x="${cx+10}" y="${cy+33}" font-size="9" fill="${zColors.Z3}" font-family="sans-serif">Ölraffinerie</text>
      <text x="${cx+10}" y="${cy+45}" font-size="9" fill="${zColors.Z3}" font-family="sans-serif">+ Tech Center</text>

      <!-- Z4: bottom-left (2× Lazarett) -->
      ${isStealZ4
        ?`<rect x="4" y="${cy+2}" width="${cx-6}" height="${cy-6}" fill="${zColors.Z4}18" rx="6" stroke="${zColors.Z4}" stroke-width="2.5" stroke-dasharray="6,3"/>`
        :`<rect x="4" y="${cy+2}" width="${cx-6}" height="${cy-6}" fill="${zColors.Z4}22" rx="6" stroke="${zColors.Z4}" stroke-width="1.5"/>`}
      <text x="14" y="${cy+18}" font-size="13" font-weight="800" fill="${zColors.Z4}" font-family="sans-serif">Z4</text>
      <text x="14" y="${cy+33}" font-size="9" fill="${zColors.Z4}" font-family="sans-serif">2× Lazarett</text>
      ${isStealZ4?`<text x="14" y="${cy+50}" font-size="10" font-weight="800" fill="${zColors.Z4}" font-family="sans-serif">⚠ LEER</text>`:''}

      <!-- Z5: center vertical rectangle (Arsenal + Silo + Söldner) -->
      <rect x="${cx-z5w/2}" y="${cy-z5h/2}" width="${z5w}" height="${z5h}" fill="${zColors.Z5}30" rx="8" stroke="${zColors.Z5}" stroke-width="2"/>
      <text x="${cx}" y="${cy-28}" font-size="12" font-weight="800" fill="${zColors.Z5}" font-family="sans-serif" text-anchor="middle">Z5</text>
      <text x="${cx}" y="${cy-14}" font-size="8" fill="${zColors.Z5}" font-family="sans-serif" text-anchor="middle">Arsenal</text>
      <text x="${cx}" y="${cy-3}" font-size="8" fill="${zColors.Z5}" font-family="sans-serif" text-anchor="middle">Silo</text>
      <text x="${cx}" y="${cy+9}" font-size="8" fill="${zColors.Z5}" font-family="sans-serif" text-anchor="middle">Söldner</text>
      <text x="${cx}" y="${cy+22}" font-size="7" fill="${zColors.Z5}cc" font-family="sans-serif" text-anchor="middle">ab Min ~10</text>

      <!-- Steal zone label -->
      <text x="${cx}" y="${h-6}" font-size="9" fill="#c0392b" font-family="sans-serif" text-anchor="middle" font-weight="700">
        Stehlen: ${stealZone} bleibt leer → Gegner stiehlt → Assassinen stehlen zurück
      </text>
    </svg>`;
  }

  // Priority table — verifiziert aus Spiel-Screenshots
  const stealNote=stealZone?stealZone.toUpperCase()+' leer lassen':'Steal-Zone je nach Seite leer';
  const rows=[
    {prio:'1',zone:'Z5',gebaeude:'Nukl. Raketensilo',pts:'80/s',eff:'Höchste Punktequelle · Ressourcen stehlen',note:'Ab Min ~10:32 · sofort stürmen!'},
    {prio:'2',zone:'Z1',gebaeude:'Infozentrum',pts:'10/s',eff:'⭐ +10% Effizienz ALLER eigenen Gebäude → Bei 60/s Zonen = +6/s je Zone extra',note:'Nie aufgeben! Multiplikator-Effekt'},
    {prio:'3',zone:'Z1 / Z3',gebaeude:'Ölraffinerie',pts:'50/s',eff:'Hauptpunktequelle von Kampfbeginn · Zone-Total mit Infozentrum/Tech: 60/s',note:'Immer halten'},
    {prio:'4',zone:'Z5',gebaeude:'Arsenal',pts:'10/s',eff:'⚔ Helden +15% Angriff / Verteidigung / HP',note:'Ab Min ~10'},
    {prio:'5',zone:'Z5',gebaeude:'Söldnerfabrik',pts:'10/s',eff:'💀 Feindl. Helden −15% Angriff / Verteidigung / HP',note:'Ab Min ~10 · Z5 gesamt: 100/s'},
    {prio:'6',zone:'Z2 / Z4',gebaeude:'2× Feldlazarett',pts:'2×30=60/s',eff:'🏥 Heilung: 15 Einh. alle 10s pro Lazarett (bei 4 Lazaretten: 60 Einh./10s · 20 Spieler: ~216.000/30Min)',note:stealNote},
    {prio:'7',zone:'Z3',gebaeude:'Tech-Zentrum',pts:'10/s',eff:'⚡ Teleport-Cooldown −50% (2 Min → 1 Min) · ideal für Sammler & Support',note:'Zone-Total mit Ölraffinerie: 60/s'},
    {prio:'–',zone:'Überall',gebaeude:'Punkte-Versorgungskiste',pts:'–',eff:'💡 Bei Gebäudewechsel verstreuen sich Punkte um das Gebäude → Spähtruppen einsammeln!',note:'Sammler & Support Kernmechanik'},
  ];

  const tableHtml=`<div class="scroll-x" style="margin-top:12px">
    <table style="font-size:11px">
      <thead><tr>
        <th style="width:24px">#</th>
        <th>Zone</th>
        <th>Gebäude</th>
        <th style="white-space:nowrap">Pkt/s (Allianz)</th>
        <th>Effekt / Hinweis</th>
      </tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td style="font-weight:800;color:var(--acc)">${r.prio}</td>
          <td style="font-weight:700;white-space:nowrap">${r.zone}</td>
          <td style="white-space:nowrap">${r.gebaeude}</td>
          <td style="white-space:nowrap;font-weight:700;color:var(--win)">${r.pts}</td>
          <td style="font-size:10px;color:var(--tx2)">${r.eff}<br><span style="color:var(--tx3);font-style:italic">${r.note}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  return`<div class="card" style="margin-bottom:12px">
    <div class="ch" style="cursor:pointer" onclick="APP.infoCardOpen=!APP.infoCardOpen;renderPage()">
      <span>🏛 Gebäude-Übersicht</span>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;font-weight:400;color:var(--tx3)">Team-Seite:</span>
        <button onclick="event.stopPropagation();setTeamSide('left')" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1.5px solid ${side==='left'?'var(--primary)':'var(--bd)'};background:${side==='left'?'var(--pri-l)':'#fff'};color:${side==='left'?'var(--primary)':'var(--tx3)'};font-weight:700;cursor:pointer">Links</button>
        <button onclick="event.stopPropagation();setTeamSide('right')" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1.5px solid ${side==='right'?'var(--primary)':'var(--bd)'};background:${side==='right'?'var(--pri-l)':'#fff'};color:${side==='right'?'var(--primary)':'var(--tx3)'};font-weight:700;cursor:pointer">Rechts</button>
        <button onclick="event.stopPropagation();setTeamSide('none')" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1.5px solid ${side==='none'?'var(--tx2)':'var(--bd)'};background:${side==='none'?'#f0f4f8':'#fff'};color:${side==='none'?'var(--tx)':'var(--tx3)'};font-weight:700;cursor:pointer">Egal</button>
        <span style="font-size:16px">${open?'▲':'▼'}</span>
      </div>
    </div>
    ${open?`<div class="cb">
      <div style="font-size:11px;color:var(--tx3);margin-bottom:10px">
        ${side==='none'
          ?`<strong style="color:var(--tx2)">ℹ Alle Zonen belegt</strong> — Seite noch nicht festgelegt. Wähle Links oder Rechts um die Steal-Strategie zu aktivieren.`
          :`<strong style="color:var(--loss)">⚠ ${stealZone} bleibt leer</strong> — ${stealLabel} — Gegner besetzt sie → Steal-Gruppe schlägt zurück → sofort Z5 stürmen`}
      </div>
      ${svgMap()}
      ${tableHtml}
    </div>`:''}
  </div>`;
}

export function setTeamSide(s){APP.teamSide=s;saveWSState();renderPage();}

// --- AUFSTELLUNG (Drag & Drop + Gewichtung) ---
export function wsAufstellung(){
  const t=APP.team;
  const lineup=getLineup(t);
  const lineupReady=getLineupReady(t);
  const stealZone=APP.teamSide==='left'?'z4':APP.teamSide==='right'?'z2':null;
  const ZONE_DEF={
    ass:{label:'⚔ Assassinen / Silo',sub:'Stärkste Spieler — bis 10:00 Gegner nullen, dann Silo',pts:'80/s ab Min 10:00',type:'ass',color:'var(--ass)'},
    ars:{label:'⚔ Arsenal',sub:'Buff-Helden — bis 10:00 in Zone 2, dann Arsenal',pts:'+15% ATK/DEF/HP',type:'ass',color:'#e67e22'},
    sold:{label:'🏭 Söldnerfabrik',sub:'Debuff-Helden — bis 10:00 in Zone 4, dann Söldner',pts:'−15% Feinde',type:'ass',color:'#e74c3c'},
    sup:{label:'🛡 Sammler & Endgame-Support',sub:'Schwächste Spieler — Punkte sammeln · am Ende freie Gebäude sichern',pts:'Gebäude einnehmen wenn Gegner keine Truppen mehr hat',type:'sup',color:'var(--tx2)'},
    z1:{label:'Zone 1',sub:'Ölraffinerie 50/s + Infozentrum 10/s',pts:'= 60/s · nie aufgeben!',type:'oil',color:'var(--oil)'},
    z2:{label:'Zone 2',sub:'2× Feldlazarett (je 30/s)',pts:APP.teamSide==='right'?'⚠ LEER — Steal-Zone':'= 60/s · Heilung 30 Einh./10s',type:'med',color:APP.teamSide==='right'?'#aaa':'var(--med)'},
    z3:{label:'Zone 3',sub:'Ölraffinerie 50/s + Tech-Zentrum 10/s',pts:'= 60/s · Teleport −50%',type:'oil',color:'var(--oil)'},
    z4:{label:'Zone 4',sub:'2× Feldlazarett (je 30/s)',pts:APP.teamSide==='left'?'⚠ LEER — Steal-Zone':'= 60/s · Heilung 30 Einh./10s',type:'med',color:APP.teamSide==='left'?'#aaa':'var(--med)'},
  };
  const sel=APP.selectedChip;
  const otherT=t==='A'?'B':'A';
  const otherLineup=getLineup(otherT);
  const otherReady=getLineupReady(otherT);
  const otherHas=Object.values(otherLineup).flat().length>0;

  function renderChip(name,zone,opts){
    opts=opts||{};
    const isSel=sel===name;
    const t1=powerTag(name,APP.wsStrength);
    const ba=APP.bldAssign||{};
    // Gebäude-Badge nur in Zone 1-4 (mit Cycle-Button)
    let bldBadge='';
    if(['z1','z2','z3','z4'].includes(zone)){
      const bldKey=ba[name];
      const meta=bldKey?BLD_META[bldKey]:null;
      const short=bldKey?(_bldShort[bldKey]||bldKey):'—';
      const color=meta?meta.color:'#bbb';
      bldBadge=`<button onclick="event.stopPropagation();cycleBldAssign('${name.replace(/'/g,"\\'")}','${zone}')" title="Gebäude wechseln" style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid ${color}66;background:${color}18;color:${color};font-weight:700;cursor:pointer;margin-left:4px;white-space:nowrap">${short}</button>`;
    }
    const guestStyle=opts.isGuest?';opacity:.72;border-style:dashed':'';
    // Ersatzspieler stehen ganz normal in der Aufstellung — der Punkt ist nur,
    // dass nicht gesagt ist, ob sie antreten. Deshalb ein Merkzeichen am Chip.
    const ersatzBadge=wsIstErsatz(APP.teamAssign[name])
      ?`<span title="Ersatzspieler — Einsatz nicht gesichert" style="font-size:8px;padding:1px 4px;border-radius:3px;border:1px dashed var(--tx3);color:var(--tx3);font-weight:800;margin-left:2px">E</span>`:'';
    const ph2Badge=opts.guestLabel?`<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:#7c3aed22;color:#7c3aed;font-weight:700;margin-left:2px;white-space:nowrap">→${opts.guestLabel}</span>`:'';
    const shiftBadge=opts.shiftLabel?`<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:#27ae6022;color:#27ae60;font-weight:700;margin-left:2px;white-space:nowrap">↑${opts.shiftLabel}</span>`:'';
    return`<div class="player-chip${isSel?' selected':''}" id="chip-${name.replace(/\s/g,'_')}-${zone}"
      style="display:inline-flex;align-items:center;gap:4px${guestStyle}"
      onclick="selectChip('${name.replace(/'/g,"\\'")}','${zone}')"
      draggable="true"
      ondragstart="dragStart(event,'${name.replace(/'/g,"\\'")}','${zone}')"
      ondragend="dragEnd(event)">
      ${avatarImg(name,18,'border-radius:4px;margin-right:1px','')}<span style="cursor:pointer" onclick="event.stopPropagation();openPlayer('${name.replace(/'/g,"\\'")}');event.preventDefault()">${name}</span><span class="chip-t1">${t1}</span>${ersatzBadge}${bldBadge}${ph2Badge}${shiftBadge}
    </div>`;
  }

  function renderZone(zoneKey){
    const def=ZONE_DEF[zoneKey];
    const players=lineup[zoneKey]||[];
    const teamSlots=getZoneSlots(t);
    const slots=teamSlots[zoneKey]||0;
    // Z5-Gäste: ass/ars/sold Spieler die laut bldAssign in dieser Zone stehen (Phase 1)
    const _bz2={oelraf1:'z1',infozentrum:'z1',laz2:'z2',laz4:'z2',
                oelraf2:'z3',sciencehub:'z3',laz1:'z4',laz3:'z4'};
    const _ba=APP.bldAssign||{};
    const z5All=[...(lineup.ass||[]),...(lineup.ars||[]),...(lineup.sold||[])];
    const guestPlayers=z5All.filter(n=>_bz2[_ba[n]]===zoneKey);
    function guestRole(n){
      if((lineup.ass||[]).includes(n))return'Silo';
      if((lineup.ars||[]).includes(n))return'Arsenal';
      return'Söldner';
    }
    const isEmpty=!players.length&&!guestPlayers.length;
    const isSteal=stealZone===zoneKey;
    const isTarget=sel&&!players.includes(sel)&&!guestPlayers.includes(sel)&&!isSteal;
    const extraStyle=isSteal?'opacity:.55;border-style:dashed;':'';
    const isZone14=['z1','z2','z3','z4'].includes(zoneKey);

    // Body: für z1-z4 mit Sub-Sektionen pro Gebäude, sonst flach
    let body='';
    if(isSteal){
      body=`<div class="zc-empty" style="color:var(--loss);font-weight:700">Absichtlich leer — Steal-Strategie</div>`;
    } else if(isZone14){
      const zoneBlds=_zoneBlds[zoneKey]||[];
      const ba=APP.bldAssign||{};
      const bs=getBldSlots(t);
      // Spieler je Gebäude gruppieren (main + Phase-1-Gäste)
      const grouped={};
      zoneBlds.forEach(b=>grouped[b]={main:[],guests:[]});
      players.forEach(n=>{
        const b=ba[n];
        if(b&&grouped[b])grouped[b].main.push(n);
        else grouped[zoneBlds[0]].main.push(n); // Fallback aufs erste Gebäude
      });
      guestPlayers.forEach(n=>{
        const b=ba[n];
        if(b&&grouped[b])grouped[b].guests.push(n);
        else grouped[zoneBlds[0]].guests.push(n);
      });
      body=zoneBlds.map(b=>{
        const meta=BLD_META[b];
        const cap=bs[b]||0;
        const inBld=grouped[b];
        const total=inBld.main.length+inBld.guests.length;
        const isBldTarget=sel?true:false;
        return`<div class="bld-sub" data-zone="${zoneKey}" data-bld="${b}"
          ondragover="event.preventDefault();event.stopPropagation();this.style.background='${meta.color}28'"
          ondragleave="this.style.background='${meta.color}0d'"
          ondrop="handleDropBld(event,'${zoneKey}','${b}')"
          onclick="event.stopPropagation();dropToBld('${zoneKey}','${b}')"
          style="margin-top:6px;padding:6px 8px;border:1.5px ${isBldTarget?'solid':'dashed'} ${meta.color}66;border-radius:6px;background:${meta.color}0d;cursor:${isBldTarget?'pointer':'default'}">
          <div style="font-size:11px;font-weight:700;color:${meta.color};margin-bottom:4px;display:flex;justify-content:space-between;align-items:baseline">
            <span>${meta.dot} ${meta.label}</span>
            <span style="color:var(--tx3);font-weight:500;font-size:10px">${total}/${cap}</span>
          </div>
          ${total===0
            ?'<div style="font-size:10px;color:var(--tx3);font-style:italic;text-align:center;padding:4px 0">leer</div>'
            :inBld.main.map(n=>{
              const ba2=APP.bldAssignPh2||{};
              const p2=ba2[n];const isShifter=p2&&p2!==ba[n];
              return renderChip(n,zoneKey,isShifter?{shiftLabel:_bldShort[p2]||p2}:{});
            }).join('')+inBld.guests.map(n=>renderChip(n,zoneKey,{isGuest:true,guestLabel:guestRole(n)})).join('')
          }
        </div>`;
      }).join('');
    } else {
      // Flache Liste für ass / ars / sold / sup
      body=isEmpty
        ?`<div class="zc-empty">Leer – Spieler antippen zum Zuweisen</div>`
        :players.map(n=>renderChip(n,zoneKey)).join('');
    }

    return`<div class="zc ${def.type}${isTarget?' drop-target':''}" id="zone-${zoneKey}"
      style="${extraStyle}"
      onclick="${isSteal?'':'dropToZone(\''+zoneKey+'\')'}"
      ondragover="event.preventDefault()"
      ondragenter="${isSteal?'':'dragEnterZone(event,\''+zoneKey+'\')'}"
      ondragleave="${isSteal?'':'dragLeaveZone(event,\''+zoneKey+'\')'}"
      ondrop="${isSteal?'':'handleDrop(event,\''+zoneKey+'\')'}">
      <div class="zc-hd">
        <div><div class="zc-name" style="color:${def.color}">${def.label}</div><div class="zc-pts">${def.sub} · ${def.pts}</div></div>
        ${isSteal?`<div class="zc-count" style="background:#c0392b22;color:var(--loss)">LEER</div>`:`<div class="zc-count" style="background:${def.color}22;color:${def.color}">${players.length}/${slots}</div>`}
      </div>
      ${body}
      ${(isZone14&&!isSteal)?[(guestPlayers.length?'⏱ Gestrichelte → Zone 5 ab Min 10:00':''),(Object.values(APP.bldAssignPh2||{}).length?'↑ Grüne → rücken ab Min 10 in wichtigere Gebäude nach':'')].filter(Boolean).map(t=>`<div style="margin-top:4px;font-size:9px;color:var(--tx3);font-style:italic;text-align:center">${t}</div>`).join(''):''}

    </div>`;
  }

  const teamColor=t==='A'?'var(--win)':'#2980b9';
  // Tatsächlicher Pool, mit dem autoAssign arbeitet (dedupe + ohne Inactive).
  // Gesetzte und Ersatzspieler zusammen — der Ersatz steht ganz normal in der
  // Aufstellung, rutscht aber hinter die Gesetzten (wsPoolSort).
  const _teamPool=wsTeamPool(t);
  const _seen=new Set();
  const _accFiltered=APP.accepted.filter(n=>{if(!n||_seen.has(n)||isInactive(n))return false;_seen.add(n);return true;});
  const angemCount=_teamPool.length||_accFiltered.length;
  const _ersatzCount=_teamPool.filter(n=>wsIstErsatz(APP.teamAssign[n])).length;
  return`
    <!-- TEAM TABS -->
    <div class="ttabs">
      <button class="ttab${APP.team==='A'?' on-a':''}" onclick="setTeam('A')">⚔ Team A · ${wsZeit('A')}</button>
      <button class="ttab${APP.team==='B'?' on-b':''}" onclick="setTeam('B')">⚔ Team B · ${wsZeit('B')}</button>
    </div>

    <!-- TEAM STATUS BAR -->
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;background:${t==='A'?'var(--win-l)':'#eaf3fb'};border:1.5px solid ${teamColor};border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:${teamColor};text-transform:uppercase;letter-spacing:.04em">Team ${t} · ${zeitLang(wsZeit(t))}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:3px">${angemCount} angemeldet${_ersatzCount?' (davon '+_ersatzCount+' Ersatz)':''} · ${Object.values(lineup).flat().length} eingeplant</div>
      </div>
      ${otherHas?`<div style="flex:1;background:#f8f9fc;border:1.5px solid var(--bd);border-radius:10px;padding:10px 12px;opacity:.7">
        <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em">Team ${otherT} · ${zeitLang(wsZeit(otherT))}</div>
        <div style="font-size:12px;color:var(--tx3);margin-top:3px">${Object.values(otherLineup).flat().length} eingeplant ✓</div>
      </div>`:''}
    </div>

    ${wsZeitPicker(t)}

    <!-- AUTO-AUFSTELLEN + KARTE — die zwei Kernaktionen, immer sichtbar -->
    ${strengthPicker(APP.wsStrength,'setWsStrength')}
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-sol" onclick="autoAssign()" style="flex:1">⚡ Auto-Aufstellen Team ${t}</button>
      <button class="btn btn-out" onclick="resetLineup()" style="flex:0;white-space:nowrap">↺ Reset</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="note info" style="flex:1;text-align:center;cursor:pointer;margin:0;background:#fff8e7;color:#b8620a;border-color:#e8a02044" onclick="showWSAufstellungKarte('${t}')">📍 Aufstellung · Karte</div>
    </div>

    <!-- ERWEITERT — manuelle Feinjustierung & Einstellungen, zweitrangig, eingeklappt -->
    <div class="card" style="margin-bottom:12px">
      <div class="ch" style="cursor:pointer" onclick="APP.wsAdvOpen=!APP.wsAdvOpen;renderPage()">
        <span>⚙ Erweitert · manuelle Aufstellung &amp; Einstellungen</span>
        <span style="font-size:16px">${APP.wsAdvOpen?'▲':'▼'}</span>
      </div>
    </div>
    ${APP.wsAdvOpen?`
    <!-- GEBÄUDE-INFO-KARTE -->
    ${buildingInfoCard(APP.teamSide,APP.infoCardOpen)}

    <!-- STRATEGIE-KARTE -->
    ${renderStrategyCard()}

    ${sel?`<div class="move-hint">„${sel}" ausgewählt — Zone antippen zum Verschieben</div>`:''}

    <!-- NICHT VERTEILT -->
    <!-- Erscheint nur, wenn wirklich jemand übrig ist. Ohne diese Liste wären Spieler,
         die nicht in die eingestellten Gebäude-Slots passen, nirgends mehr sichtbar —
         die Aufstellung zeigt sonst ausschließlich Spieler, die schon in einer Zone stehen. -->
    ${(()=>{
      const platziert=new Set(Object.values(lineup).flat());
      const rest=(_teamPool.length?_teamPool:_accFiltered)
        .filter(n=>!platziert.has(n)).sort(wsPoolSort);
      if(!rest.length)return'';
      return`<div class="card" style="margin-bottom:12px;border:2px solid var(--loss)">
        <div class="ch" style="background:#fff5f5">
          <span>🎒 Nicht verteilt</span>
          <span class="ch-sub">${rest.length} · antippen, dann Gebäude wählen</span>
        </div>
        <div style="padding:8px;display:flex;flex-wrap:wrap;gap:4px">
          ${rest.map(n=>renderChip(n,'',{})).join('')}
        </div>
      </div>`;
    })()}

    <!-- ROLLEN — Zone-5-Spieler & Springer ZUERST -->
    <div class="card" style="margin-bottom:12px;border:2px solid var(--ass)">
      <div class="ch">🎭 Rollen <span class="ch-sub">Phase-2-Spieler + Springer</span></div>
      <div style="padding:0 6px 6px">
        <div class="zone-grid" style="margin-top:6px">
          ${getZoneSlots(t).ass>0?renderZone('ass'):''}
          ${getZoneSlots(t).sup>0?renderZone('sup'):''}
          ${getZoneSlots(t).ars>0?renderZone('ars'):''}
          ${getZoneSlots(t).sold>0?renderZone('sold'):''}
        </div>
      </div>
    </div>

    <!-- PHASE-2-ÜBERGANG HINWEIS -->
    <div class="note info" style="margin-bottom:12px;font-size:12px;line-height:1.45">
      <strong>📌 Phase 2 (ab Min 10:00):</strong> Nur die gestrichelt markierten Spieler wechseln per TP zu Zone 5. Alle anderen bleiben in ihren Zonen — kein weiterer Umzug nötig.
    </div>

    <!-- ZONE MAP — Phase 1 Zonen 1-4 -->
    <div class="zone-grid">
      ${renderZone('z1')}
      ${renderZone('z2')}
      ${renderZone('z3')}
      ${renderZone('z4')}
    </div>
    <div style="background:var(--acc-l);border-radius:12px;padding:12px;border:2px solid var(--acc);margin-bottom:10px;text-align:center">
      <div style="font-size:12px;font-weight:800;color:var(--acc)">Zone 5 · Silo 80/s + Arsenal 10/s + Söldnerfabrik 10/s = <span style="color:var(--win)">100/s</span></div>
      <div style="font-size:11px;color:var(--tx3);margin-top:3px">Öffnet nach ~10:00 Min · Arsenal: Helden +15% · Söldnerfabrik: Feinde −15% · Assassinen stürmen rein!</div>
    </div>

    <!-- STEAL-STRATEGIE (nur wenn Seite gewählt) -->
    ${stealZone?`<div class="card" style="margin-bottom:10px;border-color:#c0392b44">
      <div class="ch" style="background:#fff5f5">
        <span>🎯 Steal-Strategie · ${stealZone==='z4'?'Zone 4':'Zone 2'}</span>
        <span style="font-size:11px;font-weight:400;color:var(--tx3)">Zone leer lassen</span>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:8px">

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#2980b922;color:#2980b9;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Dauerbeobachtung durch 2er-Team</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">Sammler & Endgame-Support beobachten ${stealZone==='z4'?'Z4':'Z2'} laufend. Solange der Gegner die Zone <strong>nicht besetzt</strong> → sofort selber reingehen und Punkte sammeln.</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#e8a02022;color:var(--acc);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Zone besetzt? → Warten auf Steal-Signal</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">Wenn der Gegner ${stealZone==='z4'?'Z4':'Z2'} besetzt hat, nicht sofort rein. Warten bis kurz vor Spielende — dann gemeinsam als 3er-Gruppe porten und Punkte stehlen.</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#c0392b22;color:var(--loss);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Steal-Aktion — 3 Spieler gleichzeitig porten</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">
              ${(()=>{const sup=(getLineup(t).sup||[]);const ass=(getLineup(t).ass||[]);const stealers=[...sup,...ass].slice(0,3);return stealers.length?`Empfohlene Steal-Gruppe: <strong>${stealers.join(', ')}</strong> — gemeinsam in ${stealZone==='z4'?'Z4':'Z2'} porten, Zone einnehmen, Punkte sammeln.`:`Steal-Gruppe: 2 Sammler/Support + 1 Assassine — gemeinsam in ${stealZone==='z4'?'Z4':'Z2'} porten.`;})()}
            </div>
          </div>
        </div>

        <div style="background:var(--acc-l);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--tx2);border:1px solid #f9e0a8">
          💡 <strong>Nach dem Steal:</strong> Alle zurück zu Zone 5 (Silo) — Assassinen stürmen rein, Sammler & Endgame-Support hält die gewonnene Zone.
        </div>

      </div>
    </div>`:''}

    <!-- LAZARETT-RAID (nur wenn Seite gewählt) -->
    ${stealZone?`<div class="card" style="margin-bottom:10px;border-color:#8e44ad44">
      <div class="ch" style="background:#fdf5ff">
        <span>🔄 Lazarett-Raid — ${stealZone==='z4'?'Zone 2':'Zone 4'}-Spieler springen rüber</span>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:8px">

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#8e44ad22;color:#8e44ad;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">${stealZone==='z4'?'Z2':'Z4'}-Gruppe verlässt geschlossen ihr Lazarett</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">Alle Spieler aus ${stealZone==='z4'?'Zone 2':'Zone 4'} verlassen gleichzeitig die Zone. Der Gegner nimmt das Lazarett ein → Punkte-Versorgungskisten verstreuen sich sofort rund um das Gebäude.</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#8e44ad22;color:#8e44ad;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Verstreute Punkte in eigener Zone einsammeln</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">Kurz in ${stealZone==='z4'?'Zone 2':'Zone 4'} bleiben und alle Versorgungskisten einsammeln, die durch den Gebäudewechsel verstreut wurden.</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#8e44ad22;color:#8e44ad;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Gemeinsam in ${stealZone==='z4'?'Zone 4':'Zone 2'} porten — Kisten klauen!</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">
              ${(()=>{const lzPlayers=getLineup(t)[stealZone==='z4'?'z2':'z4']||[];return lzPlayers.length?`Gruppe (${lzPlayers.join(', ')}) portet geschlossen in ${stealZone==='z4'?'Zone 4':'Zone 2'}. Mit ${lzPlayers.length} Spielern können viele Kisten gleichzeitig aufgesammelt werden — Gegner hat keine Chance alle zu sichern!`:`Die ${stealZone==='z4'?'Z2':'Z4'}-Gruppe portet geschlossen in die Gegner-Zone. Mit mehreren Spielern gleichzeitig können viele Versorgungskisten eingesammelt werden!`;})()}
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:28px;height:28px;border-radius:50%;background:#8e44ad22;color:#8e44ad;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">4</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--tx)">Lazarett zurückerobern &amp; wiederholen</div>
            
          </div>
        </div>

        <div style="background:#fdf5ff;border-radius:8px;padding:8px 10px;font-size:11px;color:#8e44ad;border:1px solid #8e44ad33">
          💡 <strong>Timing:</strong> Ideal zwischen Minute 15–25, wenn Gegner bereits Truppen verloren hat. Je mehr Spieler gleichzeitig, desto mehr Kisten können gesichert werden.
        </div>

      </div>
    </div>`:''}

    <!-- SPIELER SLOTS PRO GEBÄUDE -->
    <div class="card" style="margin-bottom:12px">
      <div class="ch">Spieler-Slots <span class="ch-sub">pro Gebäude · pro Rolle · für Team ${t}</span></div>
      <div class="cb">
        ${[
          {head:'Zone 1 — Phase 1',color:'var(--oil)',blds:[['oelraf1',''],['infozentrum','']]},
          {head:'Zone 2 — Phase 1',color:'var(--med)',blds:[['laz2',''],['laz4','']]},
          {head:'Zone 3 — Phase 1',color:'var(--oil)',blds:[['oelraf2',''],['sciencehub','']]},
          {head:'Zone 4 — Phase 1',color:'var(--med)',blds:[['laz1',''],['laz3','']]},
          {head:'Rollen (unabhängig von Gebäuden)',color:'var(--ass)',blds:[
            ['silo','⚔ Assassinen (→ Silo Phase 2)'],
            ['oelquellen','🛡 Springer / Sammler (Endgame)'],
          ]},
        ].map(g=>{
          const bs=getBldSlots(t);
          const sum=g.blds.reduce((s,[b])=>s+(bs[b]||0),0);
          return`<div style="margin-bottom:10px">
            <div style="font-size:10px;font-weight:800;color:${g.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline">
              <span>${g.head}</span><span style="color:var(--tx3);font-weight:600">${sum} Spieler</span>
            </div>
            ${g.blds.map(([b,override])=>{
              const meta=BLD_META[b];
              const val=bs[b]||0;
              const label=override||(meta.dot+' '+meta.label);
              return`<div class="slot-row" style="padding-left:10px">
                <div class="slot-label" style="color:${meta.color};font-weight:600;font-size:12px">${label}</div>
                <div class="slot-btns">
                  <button class="slot-btn" onclick="changeBldSlot('${b}',-1)">−</button>
                  <div class="slot-num">${val}</div>
                  <button class="slot-btn" onclick="changeBldSlot('${b}',1)">+</button>
                </div>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
        <div style="margin-top:8px;padding-top:10px;border-top:1px solid var(--bd);font-size:12px;color:var(--tx3)">
          Gesamt: <strong>${Object.values(getBldSlots(t)).reduce((a,b)=>a+b,0)} Spieler</strong> eingeplant · ${angemCount} für Team ${t} angemeldet
        </div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div class="note info" style="flex:1;text-align:center;cursor:pointer;margin:0" onclick="setWSView('mail')">✉ Mail-Export → Tab „Mail"</div>
    </div>
    `:''}`;
}

// Drag & Drop handlers
export function dragStart(e,name,fromZone){
  APP.selectedChip=name;APP.selectedFromZone=fromZone;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',name);
  // delay so the element isn't hidden before the drag ghost is captured
  requestAnimationFrame(()=>{const el=document.getElementById('chip-'+name.replace(/\s/g,'_'));if(el)el.classList.add('dragging');});}
export function dragEnd(e){
  e.target.classList.remove('dragging');
  document.querySelectorAll('.zc').forEach(el=>el.classList.remove('drop-target'));
  APP.selectedChip=null;APP.selectedFromZone=null;
  renderPage();}
export function handleDrop(e,toZone){
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.zc').forEach(el=>el.classList.remove('drop-target'));
  if(APP.selectedChip)moveChip(APP.selectedChip,APP.selectedFromZone,toZone);}
export function handleDropBld(e,toZone,toBld){
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.zc').forEach(el=>el.classList.remove('drop-target'));
  document.querySelectorAll('.bld-sub').forEach(el=>{const m=BLD_META[el.dataset.bld];if(m)el.style.background=m.color+'0d';});
  if(APP.selectedChip)moveChip(APP.selectedChip,APP.selectedFromZone,toZone,toBld);
}
export function dragEnterZone(e,zone){e.preventDefault();document.getElementById('zone-'+zone).classList.add('drop-target');}
export function dragLeaveZone(e,zone){
  const el=document.getElementById('zone-'+zone);
  if(el&&!el.contains(e.relatedTarget))el.classList.remove('drop-target');}

// Tap-to-select (mobile)
export function selectChip(name,zone){
  if(APP.selectedChip===name){APP.selectedChip=null;APP.selectedFromZone=null;}
  else{APP.selectedChip=name;APP.selectedFromZone=zone;}
  renderPage();}
export function dropToZone(zone){
  if(!APP.selectedChip)return;
  if(APP.selectedFromZone===zone){APP.selectedChip=null;APP.selectedFromZone=null;renderPage();return;}
  moveChip(APP.selectedChip,APP.selectedFromZone,zone);
}
export function dropToBld(toZone,toBld){
  if(!APP.selectedChip)return;
  const ba=APP.bldAssign||{};
  // Gleicher Spieler im selben Gebäude → deselektieren
  if(APP.selectedFromZone===toZone&&ba[APP.selectedChip]===toBld){
    APP.selectedChip=null;APP.selectedFromZone=null;renderPage();return;
  }
  moveChip(APP.selectedChip,APP.selectedFromZone,toZone,toBld);
}
export function moveChip(name,fromZone,toZone,bldKey){
  const t=APP.team;
  const L=getLineup(t);
  if(!APP.bldAssign)APP.bldAssign={};
  // Phase-2-Rolle→Zone: Spieler bleibt in Rollen-Slot, nur Phase-1-Gebäude ändert sich
  // Prüfe tatsächlichen Lineup-Slot (nicht fromZone — Gast-Chips melden z1/z2/z3/z4 als fromZone)
  const _actualRole=['ass','ars','sold'].find(r=>(L[r]||[]).includes(name));
  if(_actualRole&&['z1','z2','z3','z4'].includes(toZone)){
    APP.bldAssign[name]=bldKey||(_zoneBlds[toZone]||[])[0];
    APP.selectedChip=null;APP.selectedFromZone=null;
    setLineupReady(t,true);
    saveWSState();renderPage();return;
  }
  // Standard-Move: aus altem Slot raus, in neuen rein
  if(fromZone&&L[fromZone])L[fromZone]=L[fromZone].filter(n=>n!==name);
  Object.keys(L).forEach(k=>{if(k!==toZone)L[k]=L[k].filter(n=>n!==name);});
  if(!L[toZone])L[toZone]=[];
  if(!L[toZone].includes(name))L[toZone].push(name);
  // Gebäude-Zuweisung
  if(bldKey&&BLD_META[bldKey]){
    APP.bldAssign[name]=bldKey;
  } else if(['z1','z2','z3','z4'].includes(toZone)){
    autoAssignBld(name,toZone,L);
  } else if(toZone==='ars'){
    autoAssignBld(name,'z2',{z2:L.ars||[]});
  } else if(toZone==='sold'){
    autoAssignBld(name,'z4',{z4:L.sold||[]});
  } else if(toZone==='ass'){
    APP.bldAssign[name]='infozentrum';
  } else if(toZone==='sup'){
    delete APP.bldAssign[name];
  }
  setLineup(t,L);
  APP.selectedChip=null;APP.selectedFromZone=null;
  setLineupReady(t,true);
  saveWSState();
  renderPage();}

// Zone-Slot-Änderung: leitet auf das primäre Gebäude der Zone weiter (changeBldSlot).
// Wird nicht mehr direkt im UI verwendet, bleibt für Kompatibilität.
export function changeSlot(k,d){
  const primary={ass:'silo',sup:'oelquellen',ars:'arsenal',sold:'soeldner',
                 z1:'oelraf1',z2:'laz2',z3:'oelraf2',z4:'laz1'}[k];
  if(primary)changeBldSlot(primary,d);
}
