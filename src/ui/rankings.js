import { sbGet } from '../core/api.js';
import { fmt } from '../core/helpers.js';

// ====== RANGLISTEN ======
export let _rkData=null,_rkTab='kampfkraft',_rkChartPlayers=null;

export async function loadRankingsData(){
  if(_rkData)return _rkData;
  const rows=await sbGet('ws_rankings?order=recorded_at.desc&limit=5000');
  const byDate={},dates=[],playerSet=new Set();
  for(const r of rows){
    if(!byDate[r.recorded_at]){byDate[r.recorded_at]=[];dates.push(r.recorded_at);}
    byDate[r.recorded_at].push(r);
    if(r.player_name)playerSet.add(r.player_name);
  }
  dates.sort((a,b)=>b.localeCompare(a));
  _rkData={dates,byDate,players:[...playerSet].sort()};
  return _rkData;
}

export async function pageRankings(el){
  el.innerHTML=`<div class="loader"><span class="spin"></span>Lade Rankings…</div>`;
  let data;
  try{data=await loadRankingsData();}
  catch(e){el.innerHTML=`<div class="loader" style="color:var(--loss)">Fehler: ${e.message}</div>`;return;}

  if(!data.dates.length){
    el.innerHTML=`<div class="card"><div class="ch">Ranglisten</div><div style="padding:20px;text-align:center;color:var(--tx3)">Noch keine Daten.<br><br>Der Collector läuft täglich um 13:30 Uhr automatisch.</div></div>`;
    return;
  }

  if(!_rkChartPlayers)_rkChartPlayers=new Set(data.players.slice(0,5));

  const latestDate=data.dates[0];
  const latest=data.byDate[latestDate]||[];
  const TABS=[
    {k:'kampfkraft',         rk:'list_rank_kampfkraft',          label:'Kampfkraft',        fmt:v=>v?(v/1e6).toFixed(2)+'M':'-'},
    {k:'kills',              rk:'list_rank_kills',                label:'Kills',             fmt:v=>v?v.toLocaleString('de'):'-'},
    {k:'spende_taeglich',    rk:'list_rank_spende_taeglich',      label:'Spende Tägl.',      fmt:v=>v?v.toLocaleString('de'):'-'},
    {k:'spende_woechentlich',rk:'list_rank_spende_woechentlich',  label:'Spende Wöch.',      fmt:v=>v?v.toLocaleString('de'):'-'},
  ];
  const tab=TABS.find(t=>t.k===_rkTab)||TABS[0];
  const sorted=[...latest].filter(r=>r[tab.rk]!=null).sort((a,b)=>(a[tab.rk]||999)-(b[tab.rk]||999));
  const chronoDates=[...data.dates].sort();
  const COLORS=['#2980b9','#27ae60','#e8a020','#9b59b6','#e74c3c','#1abc9c','#f39c12','#8e44ad','#c0392b','#16a085'];

  function renderTrend(){
    if(chronoDates.length<2)return`<div style="padding:14px;text-align:center;font-size:12px;color:var(--tx3)">Mindestens 2 Tage Daten nötig.</div>`;
    const sel=data.players.filter(p=>_rkChartPlayers.has(p));
    if(!sel.length)return`<div style="padding:14px;text-align:center;font-size:12px;color:var(--tx3)">Wähle unten Spieler aus.</div>`;
    const series=sel.map((name,i)=>({name,color:COLORS[i%COLORS.length],pts:chronoDates.map(d=>{const rec=(data.byDate[d]||[]).find(r=>r.player_name===name);return rec?rec[tab.k]:null;})}));
    const allV=series.flatMap(s=>s.pts.filter(v=>v!=null));
    if(!allV.length)return`<div style="padding:14px;text-align:center;font-size:12px;color:var(--tx3)">Keine Daten für Auswahl.</div>`;
    const maxV=Math.max(...allV),minV=Math.min(...allV),range=maxV-minV||1;
    const W=360,H=140,PAD=8,BOTT=22,LEFT=10;
    const xS=(W-PAD-LEFT)/(chronoDates.length-1||1),yS=(H-PAD-BOTT)/range;
    let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">`;
    for(let i=0;i<=4;i++){
      const y=PAD+(H-PAD-BOTT)*(1-i/4),val=minV+range*i/4;
      const lbl=tab.k==='kampfkraft'?(val/1e6).toFixed(1)+'M':Math.round(val).toLocaleString('de');
      svg+=`<line x1="${LEFT}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#e2e6f0" stroke-width="1"/>`;
      svg+=`<text x="${LEFT}" y="${y-2}" font-size="7" fill="#8892a4">${lbl}</text>`;
    }
    series.forEach(s=>{
      const vpts=[];
      s.pts.forEach((v,i)=>{
        if(v==null)return;
        const x=LEFT+i*xS,y=H-BOTT-(v-minV)*yS;
        vpts.push(`${x},${y}`);
        svg+=`<circle cx="${x}" cy="${y}" r="3" fill="${s.color}"><title>${s.name}: ${tab.fmt(v)} · ${chronoDates[i]}</title></circle>`;
      });
      if(vpts.length>1)svg+=`<polyline points="${vpts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    });
    const step=Math.max(1,Math.floor(chronoDates.length/4));
    chronoDates.forEach((d,i)=>{if(i%step!==0&&i!==chronoDates.length-1)return;svg+=`<text x="${LEFT+i*xS}" y="${H-5}" font-size="7" fill="#8892a4" text-anchor="middle">${d.slice(5)}</text>`;});
    svg+=`</svg>`;
    const legend=series.map(s=>`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer" onclick="rkTogglePlayer('${s.name.replace(/'/g,"\\'")}')"><span style="width:14px;height:3px;background:${s.color};display:inline-block;border-radius:2px"></span>${s.name}</span>`).join('');
    return`<div style="padding:10px">${svg}<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">${legend}</div></div>`;
  }

  function rkRoleBadge(r){
    if(!r)return'';
    const c={R5:'#e74c3c',R4:'#e8a020',R3:'#2980b9',R2:'#27ae60',R1:'#95a5a6'}[r]||'#bbb';
    return`<span style="font-size:10px;font-weight:800;color:#fff;background:${c};padding:2px 5px;border-radius:4px;margin-right:5px">${r}</span>`;
  }

  const listRows=sorted.slice(0,30).map(r=>{
    const rank=r[tab.rk],val=r[tab.k];
    const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
    return`<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--bd)">
      <div style="width:28px;text-align:center;font-size:13px;font-weight:800;color:${rank<=3?'var(--primary)':'var(--tx3)'};flex-shrink:0">${medal||rank}</div>
      <div style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rkRoleBadge(r.alliance_rank)}${r.player_name}</div>
      <div style="font-size:13px;font-weight:700;color:var(--primary);flex-shrink:0">${tab.fmt(val)}</div>
    </div>`;
  }).join('');

  const playerBtns=data.players.map(name=>{
    const on=_rkChartPlayers.has(name);
    return`<button onclick="rkTogglePlayer('${name.replace(/'/g,"\\'")}'" style="font-size:11px;padding:4px 9px;border-radius:6px;border:1.5px solid ${on?'var(--primary)':'var(--bd)'};background:${on?'var(--primary)':'var(--card)'};color:${on?'#fff':'var(--tx2)'};cursor:pointer;font-family:inherit;font-weight:600">${name}</button>`;
  }).join('');

  el.innerHTML=`
  <div class="card" style="margin-bottom:10px">
    <div class="stabs" style="margin-bottom:8px">${TABS.map(t=>`<button class="stab${_rkTab===t.k?' on':''}" onclick="rkSetTab('${t.k}')">${t.label}</button>`).join('')}</div>
    <div style="font-size:11px;color:var(--tx3);padding:0 12px 8px">Stand: ${latestDate} · ${sorted.length} Spieler</div>
    <div>${listRows||'<div style="padding:20px;text-align:center;color:var(--tx3)">Keine Daten für diesen Tab.</div>'}</div>
  </div>

  <div class="card" style="margin-bottom:10px">
    <div class="ch">Verlauf <span class="ch-sub">${chronoDates.length} Tage · ${tab.label}</span></div>
    ${renderTrend()}
  </div>

  <div class="card">
    <div class="ch">Spieler im Diagramm</div>
    <div style="padding:10px;display:flex;flex-wrap:wrap;gap:6px">${playerBtns}</div>
  </div>`;
}

export function rkSetTab(t){_rkTab=t;_rkData=null;const el=document.getElementById('pc');if(el)pageRankings(el);}
export function rkTogglePlayer(name){
  if(_rkChartPlayers.has(name))_rkChartPlayers.delete(name);else _rkChartPlayers.add(name);
  const el=document.getElementById('pc');if(el)pageRankings(el);
}
