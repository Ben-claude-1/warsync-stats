import { nav } from '../app/render.js';
import { canAccess, fmt, fmtK, fmtMio, relColor } from '../core/helpers.js';
import { avatarImg, isInactive } from '../core/players.js';
import { APP } from '../core/state.js';
import { renderHistoryChart, t1StaleInfo } from './profil.js';

// ====== PLAYER PROFILE OVERLAY ======
export function openPlayer(name){APP.overlayPlayer=name;renderOverlay();}
export function closeOverlay(){APP.overlayPlayer=null;const el=document.getElementById('overlay');if(el)el.remove();}
export function renderOverlay(){
  const name=APP.overlayPlayer;if(!name)return;
  const p=APP.data.players.find(x=>x.name===name);
  if(!p){closeOverlay();return;}
  const inactive=isInactive(name);
  const r=inactive?null:(p.role||'R3');
  const rc={R5:'#f39c12',R4:'#9b59b6',R3:'#7f8c8d'}[r]||'#7f8c8d';
  const allParts=APP.data.participation.filter(x=>x.player_name===name);
  const allEvts=allParts.map(x=>({...x,ev:APP.data.events.find(e=>e.id===x.event_id)})).filter(x=>x.ev).sort((a,b)=>b.ev.event_date.localeCompare(a.ev.event_date));
  const played=allParts.filter(x=>x.played);
  const rel=allParts.length?Math.round(played.length/allParts.length*100):null;
  const ap=played.filter(x=>x.individual_pts).reduce((s,x)=>s+(x.individual_pts||0),0);
  const avgP=played.filter(x=>x.individual_pts).length?Math.round(ap/played.filter(x=>x.individual_pts).length):0;
  const evtsWon=allEvts.filter(x=>x.played&&x.ev?.result==='win').length;
  const evtsLost=allEvts.filter(x=>x.played&&x.ev?.result==='loss').length;
  const profP=p.profession||'Ingenieur';const isKP=profP==='Kriegsführer';
  const st=t1StaleInfo(p);const sc=st?.color||'var(--tx3)';
  const canEdit=canAccess('profile_edit')||APP.user?.role==='superadmin';
  const hist=APP.playerHistory[name]||[];

  let body=``;
  if(inactive)body+=`<div style="background:#fef9f0;border-left:3px solid #e67e22;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:10px">⚠️ Nicht mehr in der Allianz</div>`;
  // Header
  body+=`<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
    ${avatarImg(name,44,`border-radius:9px;border:2px solid ${rc};box-sizing:border-box`,`<div style="width:44px;height:44px;border-radius:50%;background:${rc};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0">${r||'?'}</div>`)}
    <div style="flex:1">
      <div style="font-size:17px;font-weight:800;${inactive?'color:var(--tx3);text-decoration:line-through':''}">${name}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:3px">
        ${r?`<span style="font-size:11px;font-weight:800;color:${rc};background:${rc}22;padding:2px 7px;border-radius:5px">${r}</span>`:''}
        ${rel!==null?`<span style="font-size:11px;font-weight:700;color:${relColor(rel)};background:${relColor(rel)}22;padding:2px 7px;border-radius:5px">${rel}% WS-Quote</span>`:''}
      </div>
    </div>
  </div>`;
  // Spieler-Info
  const kk=[
    profP?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">Beruf</span><span style="font-weight:700;font-size:12px;color:${isKP?'var(--ass)':'var(--primary)'}">${isKP?'⚔ Kriegsführer':'🔧 Ingenieur'}</span></div>`:'',
    p.profession_level?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">Beruf-Level</span><span style="font-weight:700;font-size:12px">${p.profession_level}</span></div>`:'',
    p.kills?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">⚔ Kills</span><span style="font-weight:700;font-size:12px">${fmtK(p.kills)}</span></div>`:'',
    p.popularity?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">❤ Beliebtheit</span><span style="font-weight:700;font-size:12px">${fmt(p.popularity)}</span></div>`:'',
    p.hero_power?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">🦸 Gesamtkraft der Helden</span><span style="font-weight:700;font-size:12px">${fmtMio(p.hero_power)}</span></div>`:'',
    p.t1?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">T1</span><span style="font-weight:700;font-size:12px;color:${st?.stale?'var(--loss)':'var(--tx)'}">${p.t1} M ${st?`<span style="font-size:10px;color:${sc}">(${st.label})</span>`:''}</span></div>`:'',
    p.t2?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">T2</span><span style="font-weight:700;font-size:12px">${p.t2} M</span></div>`:'',
    p.t3?`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);font-size:12px">T3</span><span style="font-weight:700;font-size:12px">${p.t3} M</span></div>`:'',
    p.total_power?`<div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:var(--tx3);font-size:12px">Gesamtkampfkraft</span><span style="font-weight:700;font-size:12px">${fmt(p.total_power)}</span></div>`:'',
  ].filter(Boolean).join('');
  if(kk)body+=`<div style="background:var(--bg);border-radius:10px;padding:0 10px;margin-bottom:10px">${kk}</div>`;
  // WS Stats
  if(allParts.length){
    body+=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
      ${[['Gespielt',played.length,'var(--win)'],['Siege',evtsWon,'var(--win)'],['Niederlagen',evtsLost,'var(--loss)'],['Quote',rel!==null?rel+'%':'–',relColor(rel)],['Ø Punkte',fmt(avgP),'var(--tx)'],['Events',allParts.length,'var(--tx3)']].map(([l,v,c])=>`<div style="background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:8px;text-align:center"><div style="font-size:10px;color:var(--tx3);text-transform:uppercase">${l}</div><div style="font-size:16px;font-weight:800;color:${c}">${v}</div></div>`).join('')}
    </div>`;
  }
  // Verlauf
  if(hist.length>=2)body+=`<div style="background:var(--card);border:1px solid var(--bd);border-radius:10px;margin-bottom:10px"><div style="padding:8px 12px;font-size:12px;font-weight:700;border-bottom:1px solid var(--bd)">Truppenstärke-Verlauf</div>${renderHistoryChart(name)}</div>`;
  // Bearbeiten-Link
  if(canEdit&&!inactive)body+=`<button class="btn btn-sol" style="width:100%;margin-top:4px" onclick="closeOverlay();APP.allianzPlayer='${name.replace(/'/g,"\\'")}';APP.allianzPlayerEdit=true;APP.allianzParsed=null;APP.allianzParsedSel={};nav('allianz')">✏ Profil bearbeiten</button>`;

  let existing=document.getElementById('overlay');
  if(!existing){existing=document.createElement('div');existing.id='overlay';document.body.appendChild(existing);}
  existing.style.cssText='position:fixed;inset:0;z-index:999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45)';
  existing.innerHTML=`<div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;padding:20px 16px 32px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--tx3)">Spielerprofil</div>
      <button onclick="closeOverlay()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--tx3);line-height:1">✕</button>
    </div>
    ${body}
  </div>`;
  existing.onclick=e=>{if(e.target===existing)closeOverlay();};
}
