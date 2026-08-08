import { renderPage } from '../app/render.js';
import { sbDelete, sbGet, sbPatch, sbUpsert } from '../core/api.js';
import { KEY, SB } from '../core/config.js';
import { canAccess, roleRank } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { isInactive } from '../core/players.js';
import { APP } from '../core/state.js';

// ========== UMFRAGEN ==========
export async function loadUmfragen(){
  try{
    const[polls,votes]=await Promise.all([
      sbGet('ws_polls?order=created_at.desc'),
      sbGet('ws_poll_votes?order=recorded_at.desc')
    ]);
    APP.data.polls=polls;
    APP.data.pollVotes=votes;
  }catch(e){
    APP.data.polls=[];
    APP.data.pollVotes=[];
    APP.data.pollsErr=e.message;
  }
  renderPage();
}
export function navUmfragen(sub,pollId){APP.umfragenSub=sub||'list';APP.umfragenPollId=pollId||null;renderPage();}
export function pageUmfragen(){
  if(!canAccess('umfragen'))return`<div class="loader" style="color:var(--tx3)">Kein Zugriff. Nur R4 und R5 dürfen Umfragen verwalten.</div>`;
  if(APP.data.polls===undefined){loadUmfragen();return`<div class="loader"><span class="spin"></span>Lade Umfragen…</div>`;}
  if(APP.data.pollsErr)return`<div class="card" style="margin-bottom:12px;border-left:4px solid var(--loss)"><div class="cb">
    <div style="font-weight:700;color:var(--loss);margin-bottom:8px">⚠ Umfragen-Tabellen nicht erreichbar</div>
    <div style="font-size:13px;line-height:1.5;margin-bottom:10px">Die Tabellen <code>ws_polls</code> und <code>ws_poll_votes</code> existieren noch nicht. Bitte das SQL aus dem Setup-Hinweis im Supabase-SQL-Editor einmalig ausführen.</div>
    <div style="font-size:11px;color:var(--tx3);background:#f8f9fc;padding:8px;border-radius:6px;font-family:monospace">${APP.data.pollsErr}</div>
    <button class="btn btn-out btn-sm" style="margin-top:10px" onclick="APP.data.polls=undefined;APP.data.pollsErr=undefined;renderPage()">↻ Erneut laden</button>
  </div></div>`;
  const sub=APP.umfragenSub||'list';
  if(sub==='create')return pageUmfragenCreate();
  if(sub==='activity')return pageUmfragenActivity();
  if(sub==='detail'&&APP.umfragenPollId)return pageUmfragenDetail(APP.umfragenPollId);
  return pageUmfragenList();
}
export function visiblePolls(){
  const all=APP.data.polls||[];
  return APP.user?.role==='superadmin'?all:all.filter(p=>!p.deleted_at);
}
export function pageUmfragenList(){
  const polls=visiblePolls();
  const votes=APP.data.pollVotes||[];
  let h=`<div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="btn btn-sol" style="flex:1" onclick="navUmfragen('create')">+ Neue Umfrage</button>
    <button class="btn btn-out" style="flex:1" onclick="navUmfragen('activity')">📊 Aktivität</button>
  </div>`;
  if(!polls.length){
    h+=`<div class="card"><div class="cb" style="text-align:center;color:var(--tx3);padding:24px">Noch keine Umfragen. Lege eine neue an.</div></div>`;
    return h;
  }
  for(const p of polls){
    const vc=votes.filter(v=>v.poll_id===p.id);
    const ja=vc.filter(v=>v.vote==='ja').length;
    const nein=vc.filter(v=>v.vote==='nein').length;
    const date=p.created_at?new Date(p.created_at).toLocaleDateString(LOC()):'';
    const isDeleted=!!p.deleted_at;
    h+=`<div class="card" style="margin-bottom:10px;cursor:pointer${isDeleted?';opacity:0.55;border-left:3px solid var(--loss)':''}" onclick="navUmfragen('detail','${p.id}')">
      <div class="cb">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
          <div style="font-weight:700;font-size:14px;flex:1">${isDeleted?'<span style="font-size:10px;background:#fdecea;color:var(--loss);padding:1px 5px;border-radius:4px;margin-right:6px;font-weight:700">AUSGEBLENDET</span>':''}${escapeHtml(p.title)}</div>
          <div style="font-size:11px;color:var(--tx3);white-space:nowrap">${date}</div>
        </div>
        ${p.description?`<div style="font-size:12px;color:var(--tx3);margin-bottom:8px">${escapeHtml(p.description)}</div>`:''}
        <div style="display:flex;gap:6px;font-size:11px;flex-wrap:wrap">
          <span style="background:#eafaf1;color:var(--win);padding:2px 7px;border-radius:4px;font-weight:700">✓ ${ja} Ja</span>
          <span style="background:#fdecea;color:var(--loss);padding:2px 7px;border-radius:4px;font-weight:700">✕ ${nein} Nein</span>
          <span style="background:#f0f0f0;color:var(--tx3);padding:2px 7px;border-radius:4px;font-weight:700">${vc.length} Teilnehmer</span>
        </div>
      </div>
    </div>`;
  }
  return h;
}
export function pageUmfragenCreate(){
  return`<button class="btn btn-out btn-sm" onclick="navUmfragen('list')" style="margin-bottom:12px">← Zurück</button>
  <div class="card" style="margin-bottom:12px">
    <div class="ch">Neue Umfrage anlegen</div>
    <div class="cb">
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Titel</label>
        <input id="poll-title" class="inp" type="text" placeholder="z.B. Allianz-Krieg gegen #1611?"
          style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Beschreibung (optional)</label>
        <textarea id="poll-desc" placeholder="Kontext zur Umfrage"
          style="width:100%;min-height:60px;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;resize:vertical"></textarea>
      </div>
      <button class="btn btn-sol" id="poll-create-btn" style="width:100%" onclick="createPoll()">Umfrage anlegen</button>
      <div id="poll-create-err" style="display:none;margin-top:10px;padding:8px 12px;background:#fdecea;color:var(--loss);border-radius:6px;font-size:13px"></div>
    </div>
  </div>`;
}
export async function createPoll(){
  const title=(document.getElementById('poll-title')?.value||'').trim();
  const desc=(document.getElementById('poll-desc')?.value||'').trim();
  const err=document.getElementById('poll-create-err');
  const btn=document.getElementById('poll-create-btn');
  if(!title){if(err){err.style.display='block';err.textContent='Bitte einen Titel eingeben.';}return;}
  if(btn){btn.textContent='Speichere…';btn.disabled=true;}
  try{
    const r=await fetch(SB+'/rest/v1/ws_polls',{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify({title,description:desc||null,created_by:APP.user.playerName})});
    if(!r.ok)throw new Error(await r.text());
    const created=await r.json();
    const newPoll=Array.isArray(created)?created[0]:created;
    APP.data.polls=[newPoll,...(APP.data.polls||[])];
    navUmfragen('detail',newPoll.id);
  }catch(e){
    if(err){err.style.display='block';err.textContent='Fehler: '+e.message;}
    if(btn){btn.textContent='Umfrage anlegen';btn.disabled=false;}
  }
}
export function pageUmfragenDetail(pollId){
  const poll=(APP.data.polls||[]).find(p=>p.id===pollId);
  if(!poll)return`<button class="btn btn-out btn-sm" onclick="navUmfragen('list')" style="margin-bottom:12px">← Zurück</button><div class="card"><div class="cb">Umfrage nicht gefunden.</div></div>`;
  const votes=(APP.data.pollVotes||[]).filter(v=>v.poll_id===pollId);
  const voteByPlayer={};votes.forEach(v=>{voteByPlayer[v.player_name]=v;});
  const ja=votes.filter(v=>v.vote==='ja').length;
  const nein=votes.filter(v=>v.vote==='nein').length;
  const active=APP.data.players.filter(p=>!isInactive(p.name)).sort((a,b)=>{const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');return rr||a.name.localeCompare(b.name);});
  const date=poll.created_at?new Date(poll.created_at).toLocaleString(LOC()):'';
  let h=`<button class="btn btn-out btn-sm" onclick="navUmfragen('list')" style="margin-bottom:12px">← Alle Umfragen</button>
  <div class="card" style="margin-bottom:12px">
    <div class="ch">${escapeHtml(poll.title)}</div>
    <div class="cb">
      ${poll.description?`<div style="font-size:13px;color:var(--tx3);margin-bottom:10px">${escapeHtml(poll.description)}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;margin-bottom:10px">
        <span style="background:#eafaf1;color:var(--win);padding:3px 9px;border-radius:5px;font-weight:700">✓ ${ja} Ja</span>
        <span style="background:#fdecea;color:var(--loss);padding:3px 9px;border-radius:5px;font-weight:700">✕ ${nein} Nein</span>
        <span style="background:#f0f0f0;color:var(--tx3);padding:3px 9px;border-radius:5px;font-weight:700">${votes.length} von ${active.length} haben sich gemeldet</span>
      </div>
      <div style="font-size:11px;color:var(--tx3)">Angelegt: ${date}${poll.created_by?' · '+escapeHtml(poll.created_by):''}</div>
      ${poll.deleted_at?`<div style="margin-top:10px;padding:8px 12px;background:#fdecea;color:var(--loss);border-radius:6px;font-size:12px;font-weight:600">⚠ Diese Umfrage ist ausgeblendet seit ${new Date(poll.deleted_at).toLocaleString(LOC())} und wird in der Aktivitätsübersicht nicht mehr gezählt.</div>`:''}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${poll.deleted_at?(APP.user.role==='superadmin'?`<button class="btn btn-out btn-sm" onclick="restorePoll('${poll.id}')">↻ Wiederherstellen</button><button class="btn btn-out btn-sm" style="color:var(--loss);border-color:#f5b7b1" onclick="deletePoll('${poll.id}')">🗑 Endgültig löschen</button>`:''):`<button class="btn btn-out btn-sm" style="color:var(--loss);border-color:#f5b7b1" onclick="deletePoll('${poll.id}')">${APP.user.role==='superadmin'?'🗑 Endgültig löschen':'🗑 Ausblenden'}</button>`}
      </div>
    </div>
  </div>
  <div class="card">
    <div class="ch">Spieler markieren <span class="ch-sub">Klick = Stimme erfassen, gleiche Wahl = aufheben</span></div>
    <div style="padding:0 14px">`;
  active.forEach((p,i)=>{
    const rc={R5:'#f39c12',R4:'#9b59b6',R3:'#27ae60',R2:'#2980b9',R1:'#8892a4'}[p.role]||'#8892a4';
    const v=voteByPlayer[p.name];
    const isJa=v&&v.vote==='ja';
    const isNein=v&&v.vote==='nein';
    const safeName=p.name.replace(/'/g,"\\'");
    h+=`<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:11px;color:var(--tx3);font-variant-numeric:tabular-nums;min-width:22px;text-align:right">${i+1}.</span>
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:800;color:${rc};background:${rc}22;padding:2px 5px;border-radius:4px">${p.role||'R3'}</span>
        <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
        ${p.t1?`<span style="font-size:10px;color:var(--primary);background:var(--pri-l);padding:1px 6px;border-radius:4px;font-weight:700;flex-shrink:0" title="Kampfkraft (T1)">${p.t1}M</span>`:''}
      </div>
      <button onclick="togglePollVote('${poll.id}','${safeName}','ja')"
        style="padding:5px 12px;background:${isJa?'var(--win)':'#fff'};color:${isJa?'#fff':'var(--win)'};border:1.5px solid var(--win);border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;line-height:1.2">Ja</button>
      <button onclick="togglePollVote('${poll.id}','${safeName}','nein')"
        style="padding:5px 12px;background:${isNein?'var(--loss)':'#fff'};color:${isNein?'#fff':'var(--loss)'};border:1.5px solid var(--loss);border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;line-height:1.2">Nein</button>
    </div>`;
  });
  h+=`</div></div>`;
  return h;
}
export async function togglePollVote(pollId,name,vote){
  const existing=(APP.data.pollVotes||[]).find(v=>v.poll_id===pollId&&v.player_name===name);
  try{
    if(existing&&existing.vote===vote){
      await sbDelete('ws_poll_votes','id=eq.'+encodeURIComponent(existing.id));
      APP.data.pollVotes=APP.data.pollVotes.filter(v=>v.id!==existing.id);
    }else{
      await sbUpsert('ws_poll_votes',{poll_id:pollId,player_name:name,vote,recorded_by:APP.user.playerName,recorded_at:new Date().toISOString()},'poll_id,player_name');
      const fresh=await sbGet('ws_poll_votes?poll_id=eq.'+encodeURIComponent(pollId));
      APP.data.pollVotes=(APP.data.pollVotes||[]).filter(v=>v.poll_id!==pollId).concat(fresh);
    }
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function deletePoll(pollId){
  const isSA=APP.user?.role==='superadmin';
  const msg=isSA?'Umfrage und alle Stimmen ENDGÜLTIG löschen? Das kann nicht rückgängig gemacht werden.':'Umfrage ausblenden? Sie wird nicht mehr in Liste oder Aktivitätsübersicht gezählt — Super-Admin kann sie wiederherstellen oder endgültig löschen.';
  if(!confirm(msg))return;
  try{
    if(isSA){
      await sbDelete('ws_polls','id=eq.'+encodeURIComponent(pollId));
      APP.data.polls=(APP.data.polls||[]).filter(p=>p.id!==pollId);
      APP.data.pollVotes=(APP.data.pollVotes||[]).filter(v=>v.poll_id!==pollId);
    }else{
      const ts=new Date().toISOString();
      await sbPatch('ws_polls','id=eq.'+encodeURIComponent(pollId),{deleted_at:ts});
      const p=(APP.data.polls||[]).find(x=>x.id===pollId);
      if(p)p.deleted_at=ts;
    }
    navUmfragen('list');
  }catch(e){alert('Fehler: '+e.message);}
}
export async function restorePoll(pollId){
  if(APP.user?.role!=='superadmin')return;
  try{
    await sbPatch('ws_polls','id=eq.'+encodeURIComponent(pollId),{deleted_at:null});
    const p=(APP.data.polls||[]).find(x=>x.id===pollId);
    if(p)p.deleted_at=null;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export function pageUmfragenActivity(){
  // Ausgeblendete Umfragen zählen nicht (auch nicht für Super-Admin)
  const livePolls=(APP.data.polls||[]).filter(p=>!p.deleted_at);
  const livePollIds=new Set(livePolls.map(p=>p.id));
  const votes=(APP.data.pollVotes||[]).filter(v=>livePollIds.has(v.poll_id));
  const totalPolls=livePolls.length;
  const active=APP.data.players.filter(p=>!isInactive(p.name));
  const stats=active.map(p=>{
    const vs=votes.filter(v=>v.player_name===p.name);
    const polled=new Set(vs.map(v=>v.poll_id)).size;
    return{name:p.name,role:p.role||'R3',t1:p.t1||null,count:polled,pct:totalPolls?Math.round(polled/totalPolls*100):0};
  }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  let h=`<button class="btn btn-out btn-sm" onclick="navUmfragen('list')" style="margin-bottom:12px">← Alle Umfragen</button>
  <div class="card" style="margin-bottom:12px">
    <div class="ch">Aktivitätsübersicht <span class="ch-sub">Wer meldet sich aktiv — egal wie abgestimmt</span></div>
    <div class="cb">
      <div style="font-size:12px;color:var(--tx3);margin-bottom:10px">${totalPolls} ${totalPolls===1?'Umfrage':'Umfragen'} insgesamt · ${active.length} aktive Spieler</div>
    </div>
    <div style="padding:0 14px">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
        <span style="font-size:10px;font-weight:700;color:var(--tx3);text-align:right;min-width:22px">#</span>
        <span style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase">Spieler</span>
        <span style="font-size:10px;font-weight:700;color:var(--tx3);text-align:center;width:70px">Teilnahmen</span>
        <span style="font-size:10px;font-weight:700;color:var(--tx3);text-align:center;width:50px">%</span>
      </div>`;
  stats.forEach((s,i)=>{
    const rc={R5:'#f39c12',R4:'#9b59b6',R3:'#27ae60',R2:'#2980b9',R1:'#8892a4'}[s.role]||'#8892a4';
    const pctColor=s.pct>=80?'var(--win)':s.pct>=50?'var(--acc)':s.pct>0?'#e67e22':'var(--tx3)';
    h+=`<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd)">
      <span style="font-size:11px;color:var(--tx3);font-variant-numeric:tabular-nums;min-width:22px;text-align:right">${i+1}.</span>
      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:800;color:${rc};background:${rc}22;padding:2px 5px;border-radius:4px">${s.role}</span>
        <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.name)}</span>
        ${s.t1?`<span style="font-size:10px;color:var(--primary);background:var(--pri-l);padding:1px 6px;border-radius:4px;font-weight:700;flex-shrink:0" title="Kampfkraft (T1)">${s.t1}M</span>`:''}
      </div>
      <div style="text-align:center;width:70px;font-size:14px;font-weight:700">${s.count}<span style="color:var(--tx3);font-size:11px;font-weight:500"> / ${totalPolls}</span></div>
      <div style="text-align:center;width:50px;font-size:13px;font-weight:700;color:${pctColor}">${s.pct}%</div>
    </div>`;
  });
  h+=`</div></div>`;
  return h;
}
export function escapeHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
