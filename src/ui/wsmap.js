import { allZonePlayers, getLineup, zeitLang } from '../core/helpers.js';
import { downloadWSCardsPng, downloadWSCombinedPng, downloadWSMapPng, shareWSCombinedPng } from '../core/png.js';
import { APP } from '../core/state.js';
import { BLD_META } from './buildings.js';
import { wsZeit } from './ws.js';

// ========== KARTEN-BILD ==========
// Phase 1: 4 Zonen (volle Breite, kein Z5-Streifen), kein Z5-Footer
// Phase 2: Z5-Mittelspalte + Z5-Footer mit neuer Aufstellung
export function renderWSMapSvg(t, phase){
  const L=getLineup(t);
  const ba=APP.bldAssign||{};
  const ba2=APP.bldAssignPh2||{};
  const W=400;
  const trunc=s=>(s||'').length>12?s.slice(0,11)+'…':s;

  const _bz={oelraf1:'z1',infozentrum:'z1',laz2:'z2',laz4:'z2',oelraf2:'z3',sciencehub:'z3',laz1:'z4',laz3:'z4'};
  const z5All=[...(L.ass||[]),...(L.ars||[]),...(L.sold||[])];
  const allZonePlayers=[...(L.z1||[]),...(L.z2||[]),...(L.z3||[]),...(L.z4||[])];
  function z5Short(n){
    if((L.ass||[]).includes(n))return'→Silo';
    if((L.ars||[]).includes(n))return'→Ars';
    return'→Söld';
  }

  const hdrH=0, mapH=395, mapY=hdrH;
  const topY=mapY+4, topH=190, botY=topY+topH, botH=196;
  const BOX_FILL='rgba(255,255,255,0.45)';
  const hasSpringer=(L.sup||[]).length>0;
  const FS={zone:15,bld:12,player:14,guest:13,z5lbl:13,z5entry:12,footer:11,legend:10}; // font-sizes

  // Zone-Layout: Phase 1 = volle Breite ohne Z5; Phase 2 = mit Z5-Mittelspalte
  let zones, z5box=null;
  if(phase===1){
    zones={
      z1:{x:4,   y:topY, w:195, h:topH, color:'#c0392b', label:'Z1', blds:['oelraf1','infozentrum']},
      z4:{x:4,   y:botY, w:195, h:botH, color:'#2980b9', label:'Z4', blds:['laz3','laz4']},
      z2:{x:201, y:topY, w:195, h:topH, color:'#e8a020', label:'Z2', blds:['laz1','laz2']},
      z3:{x:201, y:botY, w:195, h:botH, color:'#27ae60', label:'Z3', blds:['oelraf2','sciencehub']},
    };
  } else {
    zones={
      z1:{x:4,   y:topY, w:138, h:topH, color:'#c0392b', label:'Z1', blds:['oelraf1','infozentrum']},
      z4:{x:4,   y:botY, w:138, h:botH, color:'#2980b9', label:'Z4', blds:['laz3','laz4']},
      z2:{x:258, y:topY, w:138, h:topH, color:'#e8a020', label:'Z2', blds:['laz1','laz2']},
      z3:{x:258, y:botY, w:138, h:botH, color:'#27ae60', label:'Z3', blds:['oelraf2','sciencehub']},
    };
    z5box={x:146, y:topY, w:108, h:topH+botH, color:'#7c3aed'};
  }

  // Dynamische Gesamthöhe
  const z5FooterH=0;
  const supH=hasSpringer?46:0;
  const H=mapY+mapH+8+z5FooterH+supH+40;

  let parts=[];
  // Bild + dunkles Overlay
  parts.push(`<image href="assets/ws_map_bg.jpg" x="0" y="${mapY}" width="${W}" height="${mapH}" preserveAspectRatio="none"/>`);
  parts.push(`<rect x="0" y="${mapY}" width="${W}" height="${mapH}" fill="rgba(0,0,0,0.12)"/>`);
  // Z5-Spalte (nur Phase 2)
  if(z5box){
    const {x,y,w,h,color}=z5box;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(124,58,237,0.28)" stroke="${color}" stroke-width="2" rx="6"/>`);
    parts.push(`<text x="${x+w/2}" y="${y+18}" text-anchor="middle" font-size="${FS.z5lbl}" font-weight="800" fill="${color}" font-family="Arial" stroke="#fff" stroke-width="2.5" paint-order="stroke">Z5</text>`);
    const z5entries=[...(L.ass||[]).map(n=>({n,r:'Silo'})),...(L.ars||[]).map(n=>({n,r:'Ars'})),...(L.sold||[]).map(n=>({n,r:'Söld'}))];
    let z5yo=y+34;
    z5entries.forEach(({n,r})=>{
      if(z5yo>y+h-8)return;
      parts.push(`<text x="${x+w/2}" y="${z5yo}" text-anchor="middle" font-size="${FS.z5entry}" fill="${color}" font-family="Arial" stroke="#fff" stroke-width="1.5" paint-order="stroke">${r}: ${trunc(n)}</text>`);
      z5yo+=15;
    });
  }

  // Zonen-Overlays
  Object.entries(zones).forEach(([zk,z])=>{
    parts.push(`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="${BOX_FILL}" stroke="${z.color}" stroke-width="1.5" rx="5"/>`);
    parts.push(`<text x="${z.x+5}" y="${z.y+16}" font-size="${FS.zone}" font-weight="800" fill="${z.color}" font-family="Arial" stroke="#fff" stroke-width="2.5" paint-order="stroke">${z.label}</text>`);
    let yo=z.y+32;
    z.blds.forEach(bk=>{
      const meta=BLD_META[bk];
      const permForBld=phase===2
        ?allZonePlayers.filter(n=>(ba2[n]||ba[n])===bk)
        :(L[zk]||[]).filter(n=>(ba[n]||z.blds[0])===bk);
      const guestForBld=phase===1?z5All.filter(n=>_bz[ba[n]]===zk&&(ba[n]||z.blds[0])===bk):[];
      if(!permForBld.length&&!guestForBld.length)return;
      const sl=meta.label.replace('Feldlazarett','Laz').replace('Ölraffinerie','Öl').replace('Infozentrum','Info').replace('Science Hub','Sci');
      parts.push(`<text x="${z.x+5}" y="${yo}" font-size="${FS.bld}" font-weight="700" fill="${meta.color}" font-family="Arial" stroke="#fff" stroke-width="2.5" paint-order="stroke">${sl}</text>`);
      yo+=16;
      permForBld.forEach(n=>{
        if(yo>z.y+z.h-4)return;
        const isShifted=phase===2&&ba2[n]&&ba2[n]!==ba[n];
        parts.push(`<text x="${z.x+8}" y="${yo}" font-size="${FS.player}" fill="${isShifted?'#000':'#fff'}" font-family="Arial" stroke="${isShifted?'rgba(255,255,255,0.85)':'rgba(0,0,0,0.5)'}" stroke-width="2" paint-order="stroke">${isShifted?'↑ ':'• '}${trunc(n)}</text>`);
        yo+=16;
      });
      guestForBld.forEach(n=>{
        if(yo>z.y+z.h-4)return;
        parts.push(`<text x="${z.x+8}" y="${yo}" font-size="${FS.guest}" fill="#000" font-style="italic" font-family="Arial" stroke="rgba(255,255,255,0.85)" stroke-width="2" paint-order="stroke">⏱ ${trunc(n)} ${z5Short(n)}</text>`);
        yo+=15;
      });
      yo+=4;
    });
  });

  // Footer
  const footerY=mapY+mapH+8;
  parts.push(`<rect x="0" y="${footerY-8}" width="${W}" height="${H-footerY+8}" fill="#fff"/>`);
  let fy=footerY;



  // Springer (nur wenn vorhanden)
  if(hasSpringer){
    parts.push(`<text x="${W/2}" y="${fy+14}" text-anchor="middle" font-size="${FS.footer}" font-weight="700" fill="#7f8c8d" font-family="Arial">Springer / Sammler</text>`);
    parts.push(`<text x="${W/2}" y="${fy+28}" text-anchor="middle" font-size="${FS.z5entry}" fill="#2c3e50" font-family="Arial">${(L.sup||[]).map(trunc).join(', ')}</text>`);
    fy+=supH;
  }

  // Legende
  if(phase===2){
    parts.push(`<text x="${W/2}" y="${fy+15}" text-anchor="middle" font-size="${FS.legend}" font-weight="700" fill="#2c3e50" font-family="Arial">↑ = rückt in geräumtes Gebäude nach (Shift)</text>`);
  }
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:420px;display:block">${parts.join('')}</svg>`;
}
export function wsZoneCards(t,phase){
  const L=getLineup(t);
  const ba=APP.bldAssign||{};
  const ba2=APP.bldAssignPh2||{};
  const BS={infozentrum:'Infozentrum',oelraf1:'Ölraf I',oelraf2:'Ölraf II',sciencehub:'Science Hub',laz1:'Laz I',laz2:'Laz II',laz3:'Laz III',laz4:'Laz IV'};
  const ZD=[{z:'z1',label:'Zone 1',color:'#c0392b',blds:['oelraf1','infozentrum']},{z:'z2',label:'Zone 2',color:'#e8a020',blds:['laz1','laz2']},{z:'z3',label:'Zone 3',color:'#27ae60',blds:['oelraf2','sciencehub']},{z:'z4',label:'Zone 4',color:'#2980b9',blds:['laz3','laz4']}];
  // Nur Spieler dieses Teams berücksichtigen
  const teamPl=new Set([...(L.z1||[]),...(L.z2||[]),...(L.z3||[]),...(L.z4||[]),...(L.ass||[]),...(L.ars||[]),...(L.sold||[]),...(L.sup||[])]);
  const assSet=new Set(L.ass||[]),arsSet=new Set(L.ars||[]),soldSet=new Set(L.sold||[]);
  const isZ5=n=>assSet.has(n)||arsSet.has(n)||soldSet.has(n);
  if(phase===1){
    const boxes=ZD.map(z=>{
      const byBld={};z.blds.forEach(b=>byBld[b]=[]);
      Object.entries(ba).forEach(([n,b])=>{if(z.blds.includes(b)&&teamPl.has(n))byBld[b].push(n);});
      let rows='';
      z.blds.forEach(b=>{(byBld[b]||[]).forEach(n=>{const z5=isZ5(n);rows+=`<div style="padding:2px 0;font-size:11px"><span style="color:${z.color};font-weight:700">${BS[b]||b}:</span> ${n}${z5?` <span style="color:#7c3aed;font-size:9px;font-weight:800">⏱→Z5</span>`:''}</div>`;});});
      if(!rows)rows='<div style="font-size:10px;color:#aaa">–</div>';
      return`<div style="border:2px solid ${z.color};border-radius:8px;padding:8px"><div style="font-weight:800;color:${z.color};font-size:12px;margin-bottom:4px">${z.label}</div>${rows}</div>`;
    }).join('');
    return`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">${boxes}</div>`;
  } else {
    const boxes=ZD.map(z=>{
      const byBld={};z.blds.forEach(b=>byBld[b]=[]);
      Object.entries(ba2).forEach(([n,b])=>{if(z.blds.includes(b)&&teamPl.has(n))byBld[b].push(n);});
      let rows='';
      z.blds.forEach(b=>{(byBld[b]||[]).forEach(n=>{const shifted=ba[n]!==ba2[n];rows+=`<div style="padding:2px 0;font-size:11px${shifted?';background:#fff9c4;border-radius:3px;padding-left:3px':''}"><span style="color:${z.color};font-weight:700">${BS[b]||b}:</span> ${n}${shifted?` <span style="color:#e67e22;font-size:9px;font-weight:800">↑Shift</span>`:''}</div>`;});});
      if(!rows)rows='<div style="font-size:10px;color:#aaa">–</div>';
      return`<div style="border:2px solid ${z.color};border-radius:8px;padding:8px"><div style="font-weight:800;color:${z.color};font-size:12px;margin-bottom:4px">${z.label}</div>${rows}</div>`;
    }).join('');
    let z5rows='';
    (L.ass||[]).forEach(n=>z5rows+=`<div style="padding:2px 0;font-size:11px"><span style="color:#7c3aed;font-weight:700">Silo:</span> ${n}</div>`);
    (L.ars||[]).forEach(n=>z5rows+=`<div style="padding:2px 0;font-size:11px"><span style="color:#e67e22;font-weight:700">Arsenal:</span> ${n}</div>`);
    (L.sold||[]).forEach(n=>z5rows+=`<div style="padding:2px 0;font-size:11px"><span style="color:#e74c3c;font-weight:700">Söldner:</span> ${n}</div>`);
    const z5box=z5rows?`<div style="border:2px solid #7c3aed;border-radius:8px;padding:8px;background:#faf5ff;grid-column:1/-1"><div style="font-weight:800;color:#7c3aed;font-size:12px;margin-bottom:4px">Zone 5 (ab Min 10:00)</div>${z5rows}</div>`:'';
    return`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">${boxes}${z5box}</div>`;
  }
}
export function showWSMap(){
  const modal=document.createElement('div');
  modal.setAttribute('data-map-modal','');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;overflow-y:auto;padding:12px';
  modal.onclick=(e)=>{if(e.target===modal)modal.remove();};

  function teamBlock(team){
    const svg1=renderWSMapSvg(team,1);
    const svg2=renderWSMapSvg(team,2);
    return`<div style="font-size:12px;font-weight:800;text-align:center;margin-bottom:8px;color:var(--tx2)">Team ${team} · ${zeitLang(wsZeit(team))}</div>
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#27ae60;text-align:center;margin-bottom:8px;padding:6px;background:#f0fff4;border-radius:8px">Phase 1 · Start bis Min 10:00</div>
        <div id="ws-map-${team}-p1" style="border-radius:8px;overflow:hidden;border:1.5px solid #e0e0e0">${svg1}</div>
        ${wsZoneCards(team,1)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
          <button class="btn btn-out btn-sm" onclick="downloadWSMapPng('${team}',1)">📥 Karte</button>
          <button class="btn btn-out btn-sm" onclick="downloadWSCardsPng('${team}',1)">📥 Aufstellung</button>
          <button class="btn btn-sol btn-sm" onclick="downloadWSCombinedPng('${team}',1)">📥 Komplett</button>
          <button class="btn btn-sol btn-sm" onclick="shareWSCombinedPng('${team}',1,this)">📷 In Fotos</button>
        </div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#7c3aed;text-align:center;margin-bottom:8px;padding:6px;background:#f5f0ff;border-radius:8px">Phase 2 · ab Min 10:00</div>
        <div id="ws-map-${team}-p2" style="border-radius:8px;overflow:hidden;border:1.5px solid #e0e0e0">${svg2}</div>
        ${wsZoneCards(team,2)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
          <button class="btn btn-out btn-sm" onclick="downloadWSMapPng('${team}',2)">📥 Karte</button>
          <button class="btn btn-out btn-sm" onclick="downloadWSCardsPng('${team}',2)">📥 Aufstellung</button>
          <button class="btn btn-sol btn-sm" onclick="downloadWSCombinedPng('${team}',2)">📥 Komplett</button>
          <button class="btn btn-sol btn-sm" onclick="shareWSCombinedPng('${team}',2,this)">📷 In Fotos</button>
        </div>
      </div>`;
  }

  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:14px;max-width:660px;width:100%;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0;font-size:16px">Wüstensturm – Aufstellung</h3>
      <button class="btn btn-out btn-sm" onclick="this.closest('[data-map-modal]').remove()">✕</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button id="wsm-tab-A" class="btn btn-sm btn-sol" style="flex:1" onclick="wsmTab('A')">Team A · ${wsZeit('A')}</button>
      <button id="wsm-tab-B" class="btn btn-sm btn-out" style="flex:1" onclick="wsmTab('B')">Team B · ${wsZeit('B')}</button>
    </div>
    <div id="wsm-A">${teamBlock('A')}</div>
    <div id="wsm-B" style="display:none">${teamBlock('B')}</div>
  </div>`;
  document.body.appendChild(modal);
  wsmTab(APP.team);
}
export function wsmTab(t){
  ['A','B'].forEach(x=>{
    const tb=document.getElementById('wsm-tab-'+x);
    const ct=document.getElementById('wsm-'+x);
    if(tb)tb.className='btn btn-sm '+(x===t?'btn-sol':'btn-out');
    if(ct)ct.style.display=x===t?'':'none';
  });
}
