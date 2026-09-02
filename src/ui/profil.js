import { renderPage } from '../app/render.js';
import { sbPatch } from '../core/api.js';
import { sha256 } from '../core/auth.js';
import { VISION_URL } from '../core/config.js';
import { badge, canAccess, fmt, fmtMio, relColor, reliability, roleBadge, roleRank } from '../core/helpers.js';
import { LANG, LOC, setLang } from '../core/i18n.js';
import { T1_TYP, avatarImg, isInactive, t1TypSelect } from '../core/players.js';
import { APP } from '../core/state.js';
import { savePlayerHistory } from './allianz.js';
import { logout } from './login.js';

// ========== PROFIL ==========
export function t1StaleInfo(player){
  if(!player)return null;
  const upd=player.t1_updated_at;
  if(!upd)return{stale:true,label:'Nie aktualisiert',color:'var(--loss)'};
  const days=Math.floor((Date.now()-new Date(upd).getTime())/(1000*86400));
  if(days>21)return{stale:true,label:`Veraltet (vor ${days} Tagen)`,color:'var(--loss)'};
  if(days>10)return{stale:false,label:`Vor ${days} Tagen`,color:'var(--acc)'};
  return{stale:false,label:days===0?'Heute':days===1?'Gestern':`Vor ${days} Tagen`,color:'var(--win)'};
}
// ── VERLAUFS-DIAGRAMM ──
// Zwei getrennte Verläufe aus derselben Tabelle (ws_player_history): die
// Truppenstärken liegen bei rund 20–30 Mio, die Gesamtkraft der Helden bei
// 150–200 Mio. In einem Diagramm zusammengelegt wären die Truppenlinien flach
// gedrückt, deshalb bekommt jeder Verlauf seine eigene Skala.
//
// Beim Helden-Verlauf beginnt die Achse bewusst NICHT bei null: die Heldenkraft
// wächst um wenige Prozent im Monat, ab null wäre die Entwicklung eine
// waagerechte Linie. Die Achse ist dafür durchgehend beschriftet, damit der
// Ausschnitt nicht täuscht.
export const HIST_MODI={
  truppen:{ab0:true, delta:false, felder:[{k:'t1',c:'#2980b9',l:'T1'},{k:'t2',c:'#27ae60',l:'T2'},{k:'t3',c:'#e8a020',l:'T3'},{k:'t4',c:'#9b59b6',l:'T4'}]},
  helden: {ab0:false,delta:true,  felder:[{k:'hero_power',c:'#7c3aed',l:'🦸 Gesamtkraft der Helden',teiler:1e6}]},
};
// Alle Werte werden in Mio geführt — die Truppenstärken stehen so schon in der
// Datenbank, die Heldenkraft absolut.
export function histWert(h,f){
  const v=parseFloat(h&&h[f.k]);
  if(isNaN(v)||v<=0)return 0;
  return f.teiler?v/f.teiler:v;
}
// Wie viele Einträge tragen für diesen Verlauf überhaupt einen Wert.
export function histAnzahl(name,modus){
  const cfg=HIST_MODI[modus]||HIST_MODI.truppen;
  return (APP.playerHistory[name]||[]).filter(h=>cfg.felder.some(f=>histWert(h,f)>0)).length;
}
export function renderHistoryChart(name,modus){
  const cfg=HIST_MODI[modus]||HIST_MODI.truppen;
  const alle=(APP.playerHistory[name]||[]).slice().reverse(); // ältester zuerst
  const fields=cfg.felder.filter(f=>alle.some(h=>histWert(h,f)>0));
  // Nur Einträge, die für diesen Verlauf überhaupt einen Wert tragen. Sonst
  // stünde im Helden-Verlauf für jede reine T1-Eintragung eine Lücke.
  const hist=alle.filter(h=>fields.some(f=>histWert(h,f)>0));
  if(!fields.length||hist.length<2)
    return`<div style="padding:14px;text-align:center;font-size:12px;color:var(--tx3)">Noch nicht genug Datenpunkte für einen Verlauf.</div>`;
  const allVals=hist.flatMap(h=>fields.map(f=>histWert(h,f))).filter(v=>v>0);
  const maxRaw=Math.max(...allVals,0.1);
  const minRaw=Math.min(...allVals);
  // Ausschnitt: ab null (Truppen) oder um die Werte herum (Helden). Bei nur
  // einem Wert bekommt die Achse trotzdem Höhe, sonst teilt der Code durch 0.
  const spanne=maxRaw-minRaw;
  const yMin=cfg.ab0?0:(spanne>0?Math.max(0,minRaw-spanne*0.25):Math.max(0,minRaw*0.98));
  const yMax=cfg.ab0?maxRaw:(spanne>0?maxRaw+spanne*0.25:maxRaw*1.02||0.1);
  const yRange=(yMax-yMin)||0.1;
  // PAD=10 statt 6: die oberste Achsenbeschriftung sass sonst halb ausserhalb.
  const W=320,H=120,PAD=10,BOTT=20,LEFT=cfg.ab0?PAD:26;
  const xScale=(W-LEFT-PAD)/(hist.length-1||1);
  const yScale=(H-PAD-BOTT)/yRange;
  const px=i=>LEFT+i*xScale;
  const py=v=>H-BOTT-(v-yMin)*yScale;
  const nk=yRange<5?1:0; // enge Ausschnitte brauchen eine Nachkommastelle
  let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">`;
  for(let i=0;i<=4;i++){
    const y=PAD+(H-PAD-BOTT)*(1-i/4);
    const val=(yMin+yRange*i/4).toFixed(nk);
    svg+=`<line x1="${LEFT}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#e2e6f0" stroke-width="1"/>`;
    svg+=`<text x="${cfg.ab0?LEFT:2}" y="${y-2}" font-size="8" fill="#8892a4">${val}M</text>`;
  }
  fields.forEach(f=>{
    // Jede Linie nur über ihre eigenen Datenpunkte. Früher lief sie über alle
    // Einträge — ein Eintrag ohne diesen Wert riss sie auf null herunter.
    const pts=hist.map((h,i)=>({v:histWert(h,f),i,h})).filter(p=>p.v>0);
    if(!pts.length)return;
    svg+=`<polyline points="${pts.map(p=>`${px(p.i)},${py(p.v)}`).join(' ')}" fill="none" stroke="${f.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach(p=>{
      svg+=`<circle cx="${px(p.i)}" cy="${py(p.v)}" r="3" fill="${f.c}"><title>${f.l}: ${p.v.toFixed(1)}M · ${p.h.recorded_at?.slice(0,10)||''}</title></circle>`;
    });
  });
  const labelIdx=[0,hist.length-1];
  if(hist.length>=5)labelIdx.push(Math.floor(hist.length/2));
  labelIdx.forEach(i=>{
    const d=hist[i]?.recorded_at?.slice(0,10)||'';
    // Erstes und letztes Datum nach innen ausrichten, sonst ragen sie aus dem Bild.
    const anker=i===0?'start':i===hist.length-1?'end':'middle';
    svg+=`<text x="${px(i)}" y="${H-3}" font-size="7" fill="#8892a4" text-anchor="${anker}">${d.slice(5)}</text>`;
  });
  svg+=`</svg>`;
  const legend=fields.map(f=>`<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px"><span style="width:12px;height:3px;background:${f.c};display:inline-block;border-radius:2px"></span>${f.l}</span>`).join('');
  return`<div style="padding:12px">${svg}
    ${cfg.delta?histDelta(hist,fields):''}
    <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap">${legend}</div>
  </div>`;
}
// „+12,4 M seit 13.04. · +8,0 %" — die Zahl zum Bild. Ohne sie muss man die
// Entwicklung aus der Kurve schätzen, und bei einem engen Ausschnitt sieht
// jeder Anstieg gleich steil aus.
export function histDelta(hist,fields){
  const zeilen=fields.map(f=>{
    const pts=hist.map(h=>({v:histWert(h,f),h})).filter(p=>p.v>0);
    if(pts.length<2)return'';
    const a=pts[0],b=pts[pts.length-1];
    const diff=b.v-a.v;
    const pct=a.v?diff/a.v*100:0;
    const c=diff>0?'var(--win)':diff<0?'var(--loss)':'var(--tx3)';
    const vz=diff>0?'+':'';
    const seit=(a.h.recorded_at||'').slice(0,10);
    return`<span style="font-size:11px;color:var(--tx3)">${f.l}: <strong style="color:${c}">${vz}${diff.toLocaleString(LOC(),{maximumFractionDigits:1})} M</strong>
      <span style="color:${c}">(${vz}${pct.toLocaleString(LOC(),{maximumFractionDigits:1})} %)</span> seit ${seit}</span>`;
  }).filter(Boolean);
  if(!zeilen.length)return'';
  return`<div style="display:flex;flex-direction:column;gap:2px;margin-top:6px">${zeilen.join('')}</div>`;
}
export function pageProfil(){
  const u=APP.user;
  const player=APP.data.players.find(p=>p.name===u.playerName);
  const rel=reliability(u.playerName);
  const myParts=APP.data.participation.filter(p=>p.player_name===u.playerName).slice(0,8);
  const stale=t1StaleInfo(player);
  let h=`<div style="display:flex;align-items:center;gap:13px;margin-bottom:20px">
    ${avatarImg(u.playerName,54,'border-radius:16px',`<div style="width:54px;height:54px;border-radius:16px;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;color:#fff;flex-shrink:0">${u.playerName?.charAt(0)||'?'}</div>`)}
    <div><div style="font-size:18px;font-weight:800">${u.playerName}</div><div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">${roleBadge(u.role)}${rel!==null?`<span style="font-size:11px;font-weight:700;color:${relColor(rel)};background:${relColor(rel)}22;padding:3px 8px;border-radius:6px">Teilnahme ${rel}%</span>`:''}</div></div>
    <button class="btn btn-sm btn-out" style="margin-left:auto;flex-shrink:0" onclick="logout()">Abmelden</button>
  </div>`;

  h+=`<div class="card" style="margin-bottom:12px">
    <div class="ch">🌐 Sprache / Language</div>
    <div style="padding:10px 12px 12px">
      <div class="lang-sw" style="margin-top:0">
        <button class="lang-b${LANG==='de'?' on':''}" onclick="setLang('de')">🇩🇪 Deutsch</button>
        <button class="lang-b${LANG==='en'?' on':''}" onclick="setLang('en')">🇬🇧 English</button>
      </div>
    </div>
  </div>`;

  // Truppenstärke + Staleness
  if(player&&(player.t1||player.t2||player.t3||player.hero_power||player.t1_type)){
    const sc=stale?.color||'var(--tx3)';
    h+=`<div class="card" style="margin-bottom:12px${stale?.stale?';border-color:var(--loss)':''}">
      <div class="ch">Aktuelle Truppenstärke
        ${stale?`<span style="font-size:11px;font-weight:700;color:${sc};background:${sc}22;padding:2px 8px;border-radius:5px">${stale.label}</span>`:''}
      </div>
      <div style="padding:12px"><div class="kk-grid">
        ${player.t1?`<div class="kk-box"${T1_TYP[player.t1_type]?` style="border-color:${T1_TYP[player.t1_type].c}"`:''}><div class="kk-l">T1${T1_TYP[player.t1_type]?` · ${T1_TYP[player.t1_type].s} ${T1_TYP[player.t1_type].l}`:''}</div><div class="kk-v">${player.t1} M</div></div>`:''}
        ${player.t2?`<div class="kk-box"><div class="kk-l">T2</div><div class="kk-v">${player.t2} M</div></div>`:''}
        ${player.t3?`<div class="kk-box"><div class="kk-l">T3</div><div class="kk-v">${player.t3} M</div></div>`:''}
        ${player.t4?`<div class="kk-box"><div class="kk-l">T4</div><div class="kk-v">${player.t4} M</div></div>`:''}
        ${player.total_power?`<div class="kk-box" style="grid-column:1/-1"><div class="kk-l">Gesamtkampfkraft</div><div class="kk-v" style="font-size:18px">${fmt(player.total_power)}</div></div>`:''}
            ${player.hero_power?`<div class="kk-box" style="grid-column:1/-1;border-color:var(--ass)"><div class="kk-l">🦸 Gesamtkraft der Helden</div><div class="kk-v" style="font-size:18px;color:var(--ass)">${fmtMio(player.hero_power)}</div></div>`:''}
      </div></div>
    </div>`;
  }

  // Verlaufsdiagramme — Truppen und Helden getrennt, siehe HIST_MODI.
  const hist=APP.playerHistory[u.playerName]||[];
  if(hist.length){
    h+=`<div class="card" style="margin-bottom:12px">
      <div class="ch">Truppenstärke-Verlauf <span class="ch-sub">${hist.length} Einträge</span></div>
      ${renderHistoryChart(u.playerName,'truppen')}
    </div>`;
    h+=`<div class="card" style="margin-bottom:12px;border-color:var(--ass)44">
      <div class="ch">🦸 Helden-Verlauf <span class="ch-sub">${histAnzahl(u.playerName,'helden')} Einträge</span></div>
      ${renderHistoryChart(u.playerName,'helden')}
    </div>`;
  }

  // Stärken aktualisieren
  h+=`<div class="card" style="margin-bottom:12px"><div class="ch">Stärken aktualisieren</div><div class="cb">
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px dashed var(--bd);border-radius:8px;cursor:pointer;background:var(--bg);margin-bottom:12px">
      <svg viewBox="0 0 24 24" style="width:20px;height:20px;flex-shrink:0;fill:none;stroke:var(--tx3);stroke-width:2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span id="profImgLabel" style="font-size:13px;color:var(--tx3);flex:1">Screenshot hochladen (Truppenstärke)</span>
      <input type="file" accept="image/*" style="display:none" onchange="handleStrengthImageProf(this.files[0])">
    </label>
    <div id="profImgResult" style="display:none;margin-bottom:12px;padding:9px 12px;border-radius:8px;font-size:13px;border:1px solid var(--bd);background:var(--bg)"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      ${[['manT1','T1 (Mio.)',player?.t1||'']].map(([id,label,val])=>`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">${label}</label><input class="fi" id="${id}" type="number" step="0.01" value="${val}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`).join('')}
      ${t1TypSelect('manT1Type',player?.t1_type||'')}
      ${[['manT2','T2 (Mio.)',player?.t2||''],['manT3','T3 (Mio.)',player?.t3||''],['manT4','T4 (Mio.)',player?.t4||'']].map(([id,label,val])=>`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">${label}</label><input class="fi" id="${id}" type="number" step="0.01" value="${val}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none"></div>`).join('')}
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">🦸 Gesamtkraft der Helden (Mio.)</label>
      <input class="fi" id="manHP" type="number" step="0.1" value="${player?.hero_power?player.hero_power/1e6:''}"
        style="padding:8px 10px;width:100%;border:1.5px solid var(--ass);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
      <div style="font-size:11px;color:var(--tx3);margin-top:4px">Jedes Speichern legt einen Verlaufs-Eintrag mit Zeitstempel an — der alte Stand bleibt erhalten.</div>
    </div>
    <button class="btn btn-sol" id="saveBtn" style="width:100%" onclick="saveStrength()">Stärken speichern</button>
  </div></div>`;

  if(myParts.length)h+=`<div class="card"><div class="ch">Meine WS-Teilnahme</div>${myParts.map(p=>{const ev=APP.data.events.find(e=>e.id===p.event_id);return`<div class="mi"><div class="dot" style="background:${p.played?'var(--win)':'var(--loss)'};width:12px;height:12px;flex-shrink:0"></div><div><div class="mn" style="font-size:13px">${ev?.event_date||'–'} · Team ${ev?.team||'–'}</div><div class="mm">${p.zone?p.zone+' · ':''}${fmt(p.individual_pts)} Pkt${p.rank?' · Platz '+p.rank:''}</div></div><div class="mr">${badge(p.played?'Gespielt':'Gefehlt',p.played?'var(--win)':'var(--loss)')}</div></div>`;}).join('')}</div>`;

  // Passwort ändern — nur wenn Spieler darf (can_reset_password) oder Verwalter.
  // Der Allianz-Admin darf das für seine Allianz genauso wie der Super-Admin; die
  // Spielerliste, aus der er wählt, ist ohnehin nur die seiner Allianz.
  const isSA=canAccess('admin');
  const canChangePw=isSA||u.can_reset_password;
  if(canChangePw){
    const allPlayers=APP.data.players.filter(p=>!isInactive(p.name)).sort((a,b)=>{const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');return rr||a.name.localeCompare(b.name);});
    h+=`<div class="card" style="margin-bottom:12px">
      <div class="ch">🔑 Passwort ändern</div>
      <div class="cb">
        ${isSA?`<div style="margin-bottom:12px">
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Spieler (Admin: für jeden)</label>
          <select id="prof-pw-player" style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            ${allPlayers.map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}"${p.name===u.playerName?' selected':''}>${p.name} (${p.role||'R3'})</option>`).join('')}
          </select>
        </div>`:`<div style="font-size:12px;color:var(--tx3);margin-bottom:12px">Nur dein eigenes Passwort kann hier geändert werden.</div>`}
        <div style="margin-bottom:12px">
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Neues Passwort</label>
          <input id="prof-pw-new" type="password" placeholder="Neues Passwort eingeben"
            style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Passwort bestätigen</label>
          <input id="prof-pw-confirm" type="password" placeholder="Passwort wiederholen"
            style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
        </div>
        <button class="btn btn-sol" id="prof-pw-btn" style="width:100%" onclick="saveProfilePassword()">Passwort speichern</button>
        <div id="prof-pw-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
      </div>
    </div>`;
  }

  return h;
}
export function fileToBase64(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});
}
export function resizeImageForOcr(dataUrl,maxPx=1280){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const scale=Math.min(1,maxPx/Math.max(img.width,img.height));
      const c=document.createElement('canvas');
      c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      res(c.toDataURL('image/jpeg',0.85));
    };
    img.src=dataUrl;
  });
}
export async function handleStrengthImage(file,t1Id,t2Id,t3Id,t4Id,resultId,labelId){
  const lbl=document.getElementById(labelId);
  const out=document.getElementById(resultId);
  if(!file)return;
  if(lbl)lbl.textContent='Analysiere…';
  if(out){out.style.display='';out.style.background='var(--bg)';out.style.borderColor='var(--bd)';out.textContent='Bild wird via Ollama analysiert…';}
  try{
    const b64=await resizeImageForOcr(await fileToBase64(file));
    const resp=await fetch(VISION_URL()+'/analyze-strength',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({image:b64})
    });
    if(!resp.ok)throw new Error('Vision-Server HTTP '+resp.status);
    const parsed=await resp.json();
    if(parsed.error)throw new Error(parsed.error);
    const toMio=v=>v>1000?Math.round(v/1e4)/100:v; // raw int → Mio
    let filled=0;
    [['t1',t1Id],['t2',t2Id],['t3',t3Id],['t4',t4Id]].forEach(([k,id])=>{
      if(parsed[k]!=null){const el=document.getElementById(id);if(el){el.value=toMio(parsed[k]);filled++;}}
    });
    if(out){out.style.background='#f0fef4';out.style.borderColor='var(--win)';out.textContent=`✅ ${filled} Werte erkannt — bitte prüfen und speichern.`;}
    if(lbl)lbl.textContent=file.name;
  }catch(e){
    let msg='❌ '+e.message;
    if(e.message.includes('fetch')||e.message.includes('Failed'))msg+=' — Ist der Vision-Server erreichbar? (Admin → Vision-URL prüfen)';
    if(out){out.style.background='#fef0f0';out.style.borderColor='var(--loss)';out.textContent=msg;}
    if(lbl)lbl.textContent='Screenshot hochladen (Truppenstärke)';
  }
}
export function handleStrengthImageProf(file){handleStrengthImage(file,'manT1','manT2','manT3','manT4','profImgResult','profImgLabel');}
export function handleStrengthImageApd(file){handleStrengthImage(file,'apd-t1','apd-t2','apd-t3','apd-t4','apdImgResult','apdImgLabel');}
export async function saveStrength(){
  const t1=parseFloat(document.getElementById('manT1')?.value)||null;
  const t2=parseFloat(document.getElementById('manT2')?.value)||null;
  const t3=parseFloat(document.getElementById('manT3')?.value)||null;
  const t4=parseFloat(document.getElementById('manT4')?.value)||null;
  // Die Heldenkraft steht im Spiel in Millionen („167,2"), gespeichert wird der
  // absolute Wert — dieselbe Umrechnung wie im Allianz-Formular (apd-hp).
  const hp=parseFloat(document.getElementById('manHP')?.value)||null;
  // Der T1-Typ ist keine Zahl und wird deshalb nicht über >0 geprüft, sondern
  // gegen den bisherigen Stand: das Feld ist vorbelegt, eine Auswahl von
  // „– unbekannt" ist also eine Entscheidung und darf einen alten Wert löschen.
  const cur=APP.data.players.find(p=>p.name===APP.user.playerName);
  const typEl=document.getElementById('manT1Type');
  const typChanged=!!typEl&&(typEl.value||null)!==(cur?.t1_type||null);
  // Die Heldenkraft allein darf reichen: sie steht im Spiel auf einem anderen
  // Bildschirm als die Truppenstärke, und wer nur sie nachträgt, soll dafür
  // nicht erst T1 abtippen müssen. Für den Typ gilt dasselbe.
  if(!t1&&!t2&&!t3&&!t4&&!hp&&!typChanged){alert('Bitte mindestens einen Wert eingeben.');return;}
  const btn=document.getElementById('saveBtn');if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    const name=APP.user.playerName;
    const upd={};if(t1)upd.t1=t1;if(t2)upd.t2=t2;if(t3)upd.t3=t3;if(t4)upd.t4=t4;
    if(hp>0)upd.hero_power=Math.round(hp*1e6);
    // savePlayerHistory baut seine Zeile aus einer festen Feldliste — t1_type
    // landet deshalb nur in ws_players, und ein reiner Typwechsel legt keinen
    // Verlaufs-Eintrag an. Der Typ ist eine Eigenschaft, keine Messung.
    if(typChanged)upd.t1_type=typEl.value||null;
    const player=APP.data.players.find(p=>p.name===name);
    if(player)await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),upd);
    if(player)Object.assign(player,upd);
    await savePlayerHistory(name,upd);
    if(btn){btn.textContent='✅ Gespeichert!';setTimeout(()=>{btn.textContent='Stärken speichern';btn.disabled=false;},2000);}
    renderPage();
  }catch(err){alert('Fehler: '+err.message);if(btn){btn.textContent='Stärken speichern';btn.disabled=false;}}
}

export async function saveProfilePassword(){
  const u=APP.user;
  const isSA=canAccess('admin');
  const targetName=isSA?(document.getElementById('prof-pw-player')?.value||u.playerName):u.playerName;
  // Safety: non-admin can only change own password
  if(!isSA&&targetName!==u.playerName){alert('Nur dein eigenes Passwort kann geändert werden.');return;}
  const pw=(document.getElementById('prof-pw-new')?.value||'').trim();
  const pw2=(document.getElementById('prof-pw-confirm')?.value||'').trim();
  if(!pw){showPwResult('Bitte ein Passwort eingeben.',false);return;}
  if(pw.length<4){showPwResult('Passwort muss mindestens 4 Zeichen haben.',false);return;}
  if(pw!==pw2){showPwResult('Passwörter stimmen nicht überein.',false);return;}
  const btn=document.getElementById('prof-pw-btn');
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    const hash=await sha256(pw);
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(targetName),{password_hash:hash});
    const pl=APP.data.players.find(p=>p.name===targetName);
    if(pl)pl.password_hash=hash;
    showPwResult('✅ Passwort für „'+targetName+'" gespeichert!',true);
    document.getElementById('prof-pw-new').value='';
    document.getElementById('prof-pw-confirm').value='';
  }catch(err){showPwResult('Fehler: '+err.message,false);}
  if(btn){btn.textContent='Passwort speichern';btn.disabled=false;}
}
export function showPwResult(msg,ok){
  const el=document.getElementById('prof-pw-result');
  if(!el)return;
  el.style.display='block';
  el.style.background=ok?'var(--win-l)':'var(--loss-l)';
  el.style.color=ok?'var(--win)':'var(--loss)';
  el.style.border='1px solid '+(ok?'#a9dfbf':'#f5b7b1');
  el.textContent=msg;
  if(ok)setTimeout(()=>{el.style.display='none';},3000);
}
