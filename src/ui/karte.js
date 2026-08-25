import { plannerPull, plannerPush } from '../core/auth.js';
import { canAccess, getLineup, zeitLang } from '../core/helpers.js';
import { imgLoads, savePngToPhotos } from '../core/png.js';
import { APP } from '../core/state.js';
import { AID, lsKey } from '../core/tenant.js';
import { wsZeit } from './ws.js';

// Damit die Karte das grosse Hintergrundbild nur einmal pro Sitzung zieht.
// Gemerkt wird die Allianz, nicht bloß „schon geholt": nach einem Wechsel der
// Ansicht muss das Bild der neuen Allianz nachgeladen werden, sonst hinge die
// Karte am Hintergrund der vorigen.
let _karteBgPulledFor=null;

export function showWSAufstellungKarte(team){
  // Kartenbild, Schilderpositionen und die Beschriftung hängen an der Allianz:
  // ein Wechsel der Ansicht darf nicht die Karte der vorigen zeigen.
  const IMG_KEY=lsKey('ws_karte_bg'),POS_KEY=lsKey('ws_karte_pos'),LABEL_KEY=lsKey('ws_karte_label_pos'),GAP=5;
  // Positionen kommen aus dem geteilten Stand, sonst aus dem localStorage dieses Geräts.
  const shared=APP.planner.karte||{};
  const readLS=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch(e){return null;}};
  let labelPos=shared.labelPos||readLS(LABEL_KEY)||{left:null,top:null};
  // Nach jeder Verschiebung beides schreiben: lokal sofort, geteilt entprellt.
  const pushKarte=()=>plannerPush('karte',{pos:(()=>{const s={};Object.keys(pos).forEach(k=>s[k]={left:pos[k].left,top:pos[k].top});return s;})(),labelPos});
  const DEF={
    infozentrum:{left:3, top:9,  lbl:'Info Center (Z1)',  c:'#1a9ed4'},
    oelraf1:    {left:3, top:31, lbl:'Öl-Raf. 1 (Z1)',    c:'#1a9ed4'},
    laz2:       {left:67,top:9,  lbl:'Feldlaz. 2 (Z2)',   c:'#d4a017'},
    laz4:       {left:67,top:31, lbl:'Feldlaz. 4 (Z2)',   c:'#d4a017'},
    laz1:       {left:3, top:59, lbl:'Feldlaz. 1 (Z3)',   c:'#3fad51'},
    laz3:       {left:3, top:77, lbl:'Feldlaz. 3 (Z3)',   c:'#3fad51'},
    oelraf2:    {left:67,top:59, lbl:'Öl-Raf. 2 (Z4)',    c:'#d4a017'},
    sciencehub: {left:67,top:77, lbl:'Science Hub (Z4)',  c:'#d4a017'},
    z5l:        {left:35,top:37, lbl:'Silo Links (Z5)',   c:'#c73b3b'},
    z5r:        {left:57,top:37, lbl:'Silo Rechts (Z5)',  c:'#c73b3b'},
  };
  const saved=shared.pos||readLS(POS_KEY)||{};
  const pos={};Object.keys(DEF).forEach(k=>pos[k]={...DEF[k],...(saved[k]||{})});
  const savePos=()=>{const s={};Object.keys(pos).forEach(k=>s[k]={left:pos[k].left,top:pos[k].top});localStorage.setItem(POS_KEY,JSON.stringify(s));pushKarte();};
  // Kartenbild: In der DB steht der Standard für die ganze Allianz. Wer selbst eins
  // hochlädt, überschreibt den Standard nur auf dem eigenen Gerät — erkennbar am
  // Flag OWN_KEY. Ohne dieses Flag folgt das Gerät immer dem Standard.
  const OWN_KEY=lsKey('ws_karte_bg_own'), DEF_IMG='assets/ws_map_bg.jpg';
  let ownImg=localStorage.getItem(OWN_KEY)==='1';
  let imgSrc=localStorage.getItem(IMG_KEY)||DEF_IMG;
  let editMode=false,curTeam=team||APP.team||'A';

  function getGroups(){
    const L=getLineup(curTeam),ba=APP.bldAssign||{},g={};
    Object.keys(pos).forEach(k=>g[k]=[]);
    [...(L.z1||[]),...(L.z2||[]),...(L.z3||[]),...(L.z4||[]),...(L.ars||[]),...(L.sold||[])].forEach(n=>{
      const b=ba[n];if(b&&g[b]!==undefined)g[b].push(n);
    });
    const ass=L.ass||[],h=Math.ceil(ass.length/2);
    g.z5l=ass.slice(0,h);g.z5r=ass.slice(h);
    return g;
  }
  function renderTags(){
    const wrap=document.getElementById('karte-img-wrap');if(!wrap)return;
    wrap.querySelectorAll('.ktag').forEach(e=>e.remove());
    // Die Namensschilder müssen sich an der *angezeigten* Kartenbreite orientieren,
    // nicht an festen px. Sonst sitzt am Handy (schmale Karte) dieselbe 11px-Schrift
    // auf einem halb so breiten Bild und wirkt doppelt so groß — und buildKarteCanvas
    // rechnet genau diesen Unterschied in den PNG-Export hoch.
    // 0.0175 ≈ die bisherigen 11px bei den 630px Kartenbreite am Mac.
    const kw=wrap.getBoundingClientRect().width||630;
    // Untergrenze 9px: maßstabsgetreu wären es am Handy 5.9px, das ist auf dem Display
    // nicht mehr lesbar. Die Vorschau zeigt die Schilder dort also etwas größer als das
    // PNG — buildKarteCanvas rechnet nicht mehr aus dem DOM, der Export bleibt davon
    // unberührt und auf allen Geräten gleich.
    const fs=Math.max(9,kw*0.0175);
    // Das Team-Schild hing ebenfalls an festen 14px und deckte am Handy Namen zu.
    // 0.02215 ≈ die bisherigen 14px bei 632px — am Mac bleibt es damit unverändert.
    const lbl=document.getElementById('karte-team-label');
    if(lbl){
      const lfs=Math.max(11,kw*0.02215);
      lbl.style.fontSize=lfs.toFixed(2)+'px';
      lbl.style.padding=`${(lfs*0.357).toFixed(2)}px ${(lfs*1.143).toFixed(2)}px`;
      lbl.style.borderRadius=(lfs*1.43).toFixed(2)+'px';
      lbl.style.borderLeftWidth=(lfs*0.357).toFixed(2)+'px';
    }
    // Alles mitskalieren, auch letter-spacing — sonst fällt das Schild bei kleiner
    // Schrift proportional breiter aus als am Mac.
    const padV=fs*0.182,padR=fs*0.636,padL=fs*0.455,bw=fs*0.273,rad=fs*0.273,ls=fs*0.027;
    Object.keys(pos).forEach(k=>{
      const p=pos[k];
      (getGroups()[k]||[]).forEach((name,i)=>{
        const el=document.createElement('span');
        el.className='ktag';
        el.style.cssText=`position:absolute;left:${p.left}%;top:${p.top+i*GAP}%;white-space:nowrap;pointer-events:none;font-size:${fs.toFixed(2)}px;font-weight:700;letter-spacing:${ls.toFixed(3)}px;padding:${padV.toFixed(2)}px ${padR.toFixed(2)}px ${padV.toFixed(2)}px ${padL.toFixed(2)}px;border-radius:${rad.toFixed(2)}px;background:rgba(8,8,8,.83);color:#fff;border-left:${bw.toFixed(2)}px solid ${p.c};`;
        el.textContent=name;wrap.appendChild(el);
      });
    });
  }
  // Beim Drehen des Handys ändert sich die Kartenbreite → Schilder neu bemaßen.
  // Der Listener hängt sich selbst ab, sobald die Karte zu ist.
  const onKarteResize=()=>{
    if(!document.getElementById('karte-img-wrap')){window.removeEventListener('resize',onKarteResize);return;}
    renderTags();
  };
  window.addEventListener('resize',onKarteResize);
  function buildSliders(){
    const panel=document.getElementById('karte-sliders');if(!panel)return;
    panel.style.display=editMode?'grid':'none';
    panel.innerHTML='';if(!editMode)return;
    Object.keys(pos).forEach(k=>{
      const p=pos[k],d=document.createElement('div');
      d.style.cssText='background:#fff;border-radius:6px;padding:8px;border:1px solid #e0e0e0';
      d.innerHTML=`<div style="font-size:10px;font-weight:700;margin-bottom:6px;border-left:3px solid ${p.c};padding-left:5px;color:${p.c}">${p.lbl}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:10px;color:#888;width:36px">Links</span><input type="range" min="0" max="95" step="1" value="${p.left}" style="flex:1"><span style="font-size:11px;font-weight:700;min-width:32px">${p.left}%</span></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:#888;width:36px">Oben</span><input type="range" min="0" max="95" step="1" value="${p.top}" style="flex:1"><span style="font-size:11px;font-weight:700;min-width:32px">${p.top}%</span></div>`;
      const[rl,rt]=d.querySelectorAll('input'),sp=[...d.querySelectorAll('span')],vl=sp[sp.length-2],vt=sp[sp.length-1];
      rl.oninput=()=>{p.left=+rl.value;vl.textContent=rl.value+'%';savePos();renderTags();};
      rt.oninput=()=>{p.top=+rt.value;vt.textContent=rt.value+'%';savePos();renderTags();};
      panel.appendChild(d);
    });
    // Label-Slider
    const lbl=document.getElementById('karte-team-label');
    const wrap=document.getElementById('karte-img-wrap');
    let iLeft=30,iTop=2;
    if(labelPos.left!==null){iLeft=Math.round(labelPos.left);iTop=Math.round(labelPos.top);}
    else if(lbl&&wrap){const wR=wrap.getBoundingClientRect(),lR=lbl.getBoundingClientRect();iLeft=Math.round((lR.left-wR.left)/wR.width*100);iTop=Math.round((lR.top-wR.top)/wR.height*100);}
    const ld=document.createElement('div');
    ld.style.cssText='background:#fff;border-radius:6px;padding:8px;border:1px solid #e0e0e0;grid-column:1/-1';
    ld.innerHTML=`<div style="font-size:10px;font-weight:700;margin-bottom:6px;border-left:3px solid #888;padding-left:5px;color:#555">Team-Label</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:10px;color:#888;width:36px">Links</span><input type="range" min="0" max="90" step="1" value="${iLeft}" style="flex:1"><span style="font-size:11px;font-weight:700;min-width:32px">${iLeft}%</span></div>
      <div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;color:#888;width:36px">Oben</span><input type="range" min="0" max="92" step="1" value="${iTop}" style="flex:1"><span style="font-size:11px;font-weight:700;min-width:32px">${iTop}%</span></div>`;
    const[ll,lt]=ld.querySelectorAll('input'),lsp=[...ld.querySelectorAll('span')],lvl=lsp[lsp.length-2],lvt=lsp[lsp.length-1];
    ll.oninput=()=>{labelPos.left=+ll.value;labelPos.top=labelPos.top??iTop;lvl.textContent=ll.value+'%';localStorage.setItem(LABEL_KEY,JSON.stringify(labelPos));pushKarte();updateLabelPos();};
    lt.oninput=()=>{labelPos.top=+lt.value;labelPos.left=labelPos.left??iLeft;lvt.textContent=lt.value+'%';localStorage.setItem(LABEL_KEY,JSON.stringify(labelPos));pushKarte();updateLabelPos();};
    panel.appendChild(ld);
  }
  function updateLabelPos(){
    const lbl=document.getElementById('karte-team-label');if(!lbl)return;
    if(labelPos.left!==null){
      lbl.style.left=labelPos.left+'%';lbl.style.top=labelPos.top+'%';lbl.style.transform='none';
    }else{
      lbl.style.left='50%';lbl.style.top='10px';lbl.style.transform='translateX(-50%)';
    }
  }
  const modal=document.createElement('div');
  modal.setAttribute('data-karte-modal','');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;overflow-y:auto;padding:12px';
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:14px;max-width:660px;width:100%;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0;font-size:16px">📍 Aufstellungs-Karte</h3>
      <div style="display:flex;gap:6px">
        <button class="btn btn-out btn-sm" id="btn-karte-edit">✏ Bearbeiten</button>
        <button class="btn btn-out btn-sm" onclick="this.closest('[data-karte-modal]').remove()">✕</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button id="karte-tab-A" class="btn btn-sm ${curTeam==='A'?'btn-sol':'btn-out'}" style="flex:1">Team A · ${wsZeit('A')}</button>
      <button id="karte-tab-B" class="btn btn-sm ${curTeam==='B'?'btn-sol':'btn-out'}" style="flex:1">Team B · ${wsZeit('B')}</button>
    </div>
    <div id="karte-img-wrap" style="position:relative;width:100%">
      <img src="${imgSrc}" style="width:100%;border-radius:8px;display:block" onerror="this.style.display='none'">
      <div id="karte-team-label" style="position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.78);color:#fff;font-weight:800;font-size:14px;padding:5px 16px;border-radius:20px;white-space:nowrap;pointer-events:none;z-index:10;border-left:5px solid ${curTeam==='A'?'#3b82f6':'#f59e0b'}">Team ${curTeam} · ${zeitLang(wsZeit(curTeam))}</div>
    </div>
    <div style="margin-top:6px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px">
      <button class="btn btn-sol btn-sm" id="btn-karte-save" style="font-size:11px">💾 Speichern</button>
      <button class="btn btn-sol btn-sm" id="btn-karte-photos" style="font-size:11px">📷 In Fotos</button>
      <button class="btn btn-sol btn-sm" id="btn-karte-copy" style="font-size:11px">📋 Bild kopieren</button>
      <label class="btn btn-out btn-sm" style="cursor:pointer;font-size:11px">🔄 Eigenes Bild
        <input type="file" accept="image/*" style="display:none" id="karte-file">
      </label>
      <button class="btn btn-out btn-sm" id="btn-karte-standard" style="font-size:11px;display:none">↺ Standardbild</button>
      ${canAccess('ws')?`<button class="btn btn-out btn-sm" id="btn-karte-setdefault" style="font-size:11px">🌐 Als Standard für alle</button>`:''}
    </div>
    <div id="karte-sliders" style="display:none;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;background:#f5f5f5;border-radius:8px;padding:8px"></div>
  </div>`;
  document.body.appendChild(modal);
  updateLabelPos();
  document.getElementById('btn-karte-edit').onclick=()=>{
    editMode=!editMode;
    document.getElementById('btn-karte-edit').textContent=editMode?'✓ Fertig':'✏ Bearbeiten';
    buildSliders();
  };
  ['A','B'].forEach(t=>document.getElementById('karte-tab-'+t).onclick=()=>{
    curTeam=t;
    ['A','B'].forEach(x=>document.getElementById('karte-tab-'+x).className='btn btn-sm '+(x===t?'btn-sol':'btn-out'));
    const lbl=document.getElementById('karte-team-label');
    if(lbl){lbl.textContent=`Team ${t} · ${zeitLang(wsZeit(t))}`;lbl.style.borderLeftColor=t==='A'?'#3b82f6':'#f59e0b';}
    renderTags();
  });
  // Bild auf diesem Gerät anzeigen. own=true → eigenes Bild, das dem Allianz-Standard
  // vorgeht; own=false → dieses Gerät folgt wieder dem Standard.
  function applyKarteBg(src,own){
    imgSrc=src;ownImg=own;
    try{
      localStorage.setItem(IMG_KEY,src);
      if(own)localStorage.setItem(OWN_KEY,'1');else localStorage.removeItem(OWN_KEY);
    }catch(e){console.warn('Kartenbild zu groß für localStorage:',e.message);}
    const el=document.querySelector('#karte-img-wrap img');
    if(el){el.onload=()=>renderTags();el.src=src;el.style.display='';}
    renderTags();updateKarteBgButtons();
  }
  function updateKarteBgButtons(){
    const b=document.getElementById('btn-karte-standard');
    if(b)b.style.display=ownImg?'':'none';
  }
  document.getElementById('karte-file').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    // Bewusst kein plannerPush: ein hochgeladenes Bild gilt nur für dieses Gerät.
    // Für alle gilt es erst über "Als Standard für alle".
    r.onload=async ev=>{
      if(!(await imgLoads(ev.target.result))){alert('Diese Datei lässt sich nicht als Bild anzeigen.');return;}
      applyKarteBg(ev.target.result,true);
    };
    r.readAsDataURL(f);
  };
  document.getElementById('btn-karte-standard').onclick=async function(){
    const shared=APP.planner.karte_bg&&APP.planner.karte_bg.img;
    const std=(shared&&await imgLoads(shared))?shared:DEF_IMG;
    applyKarteBg(std,false);
    this.textContent='✓ Standardbild';setTimeout(()=>{this.textContent='↺ Standardbild';},1600);
  };
  const setDefBtn=document.getElementById('btn-karte-setdefault');
  if(setDefBtn)setDefBtn.onclick=async function(){
    const btn=this;btn.disabled=true;
    // Vor dem Verteilen prüfen: ein defektes Bild hier würde bei jedem in der Allianz
    // die Karte leeren.
    if(!(await imgLoads(imgSrc))){
      alert('Das Bild lässt sich nicht laden und wird deshalb nicht als Standard gesetzt.');
      btn.disabled=false;return;
    }
    plannerPush('karte_bg',{img:imgSrc},0);
    // Das eigene Bild ist jetzt der Standard — Flag weg, sonst bliebe es als
    // "Sonderfall dieses Geräts" markiert und würde spätere Standards ignorieren.
    ownImg=false;try{localStorage.removeItem(OWN_KEY);}catch(e){}
    updateKarteBgButtons();
    btn.textContent='✓ Für alle gesetzt';
    setTimeout(()=>{btn.textContent='🌐 Als Standard für alle';btn.disabled=false;},2000);
  };
  updateKarteBgButtons();
  async function buildKarteCanvas(){
    const wrap=document.getElementById('karte-img-wrap');
    const bgImg=wrap.querySelector('img');
    if(!bgImg||!bgImg.complete)throw new Error('Kartenbild noch nicht geladen.');
    // Warte bis naturalWidth verfügbar (Safari-Bug: manchmal 0 direkt nach load)
    if(!bgImg.naturalWidth){
      await new Promise(res=>{const t=setInterval(()=>{if(bgImg.naturalWidth){clearInterval(t);res();}},50);setTimeout(()=>{clearInterval(t);res();},2000);});
    }
    const cw=bgImg.naturalWidth||bgImg.offsetWidth||800;
    const ch=bgImg.naturalHeight||bgImg.offsetHeight||600;
    const c=document.createElement('canvas');
    c.width=cw;c.height=ch;
    const ctx=c.getContext('2d');
    ctx.drawImage(bgImg,0,0,cw,ch);
    // Die Schilder werden aus den Daten gezeichnet, nicht aus dem gerenderten DOM.
    // Über getBoundingClientRect hing der Export sonst an der Anzeigebreite — und die
    // Anzeige braucht am Handy größere Schrift als der Maßstab hergibt, sonst kann man
    // auf 338px Kartenbreite nichts mehr lesen. So bleibt das PNG auf jedem Gerät
    // gleich, unabhängig davon, wie groß die Vorschau die Schilder zeigt.
    // 0.0175 ist derselbe Anteil wie bisher am Mac (11px bei 632px Kartenbreite).
    const fs=Math.max(10,cw*0.0175);
    const padR=fs*0.636,padL=fs*0.455,bw=fs*0.273,rad=fs*0.273,tagH=fs*1.54;
    ctx.font=`700 ${fs}px system-ui,-apple-system,sans-serif`;
    if('letterSpacing' in ctx)ctx.letterSpacing=(fs*0.027).toFixed(2)+'px';
    const groups=getGroups();
    Object.keys(pos).forEach(k=>{
      const p=pos[k];
      (groups[k]||[]).forEach((name,i)=>{
        const x=cw*p.left/100, y=ch*(p.top+i*GAP)/100;
        const w=bw+padL+ctx.measureText(name).width+padR, h=tagH, r=rad;
        ctx.save();
        ctx.fillStyle='rgba(8,8,8,0.83)';
        ctx.beginPath();
        ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();ctx.fill();
        ctx.fillStyle=p.c;ctx.fillRect(x,y,bw,h);
        ctx.fillStyle='#fff';ctx.textBaseline='middle';
        ctx.fillText(name,x+bw+padL,y+h/2);
        ctx.restore();
      });
    });
    // Team + Uhrzeit einblenden
    const tlabel=`Team ${curTeam} · ${zeitLang(wsZeit(curTeam))}`;
    const safeCW=cw||800;
    let tfs=Math.max(20,Math.min(80,Math.round(safeCW/18)));
    ctx.font=`bold ${tfs}px Arial`;
    // Mit europäischer Zeit UND Serverzeit wird die Zeile mehr als doppelt so
    // lang wie früher. Passt der Kasten nicht auf das Bild, schrumpft die
    // Schrift — sonst schöbe er sich über den Rand hinaus.
    const maxBW=safeCW-Math.round(safeCW*0.04);
    let tmw=ctx.measureText(tlabel).width||200;
    if(tmw+tfs*1.1>maxBW){
      tfs=Math.max(12,Math.floor(tfs*(maxBW-tfs*1.1)/tmw));
      ctx.font=`bold ${tfs}px Arial`;
      tmw=ctx.measureText(tlabel).width||200;
    }
    const tpad=Math.round(tfs*0.55);
    const tbw=Math.round(tmw+tpad*2);
    const tbh=Math.round(tfs*1.8);
    let tbx,tby;
    if(labelPos.left!==null){tbx=Math.round(cw*labelPos.left/100);tby=Math.round(ch*labelPos.top/100);}
    else{tbx=Math.round((safeCW-tbw)/2);tby=Math.round(tfs*0.3);}
    ctx.fillStyle='#000000';
    ctx.fillRect(tbx,tby,tbw,tbh);
    ctx.fillStyle=curTeam==='A'?'#2563eb':'#d97706';
    ctx.fillRect(tbx,tby,Math.round(tfs*0.25),tbh);
    ctx.fillStyle='#ffffff';
    ctx.textBaseline='middle';
    ctx.fillText(tlabel,tbx+tpad,Math.round(tby+tbh/2));
    return c;
  }
  document.getElementById('btn-karte-save').onclick=async function(){
    const btn=this;btn.textContent='⏳';btn.disabled=true;
    try{
      const c=await buildKarteCanvas();
      const dataUrl=c.toDataURL('image/png');
      // iOS: neuen Tab öffnen → langer Druck → "Zum Fotoalbum"
      // Desktop: direkter Download
      const a=document.createElement('a');
      a.href=dataUrl;
      a.download=`aufstellung_team_${curTeam}_${new Date().toISOString().slice(0,10)}.png`;
      a.target='_blank';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      btn.textContent='✓ Gespeichert';
      setTimeout(()=>{btn.textContent='💾 Speichern';btn.disabled=false;},2000);
    }catch(e){
      alert('Fehler: '+e.message);btn.textContent='💾 Speichern';btn.disabled=false;
    }
  };
  document.getElementById('btn-karte-photos').onclick=function(){
    savePngToPhotos(buildKarteCanvas,`aufstellung_team_${curTeam}_${new Date().toISOString().slice(0,10)}.png`,this);
  };
  document.getElementById('btn-karte-copy').onclick=async function(){
    const btn=this;btn.textContent='⏳';btn.disabled=true;
    try{
      const c=await buildKarteCanvas();
      await new Promise((res,rej)=>c.toBlob(async blob=>{
        try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);res();}
        catch(e){rej(e);}
      },'image/png'));
      btn.textContent='✓ Kopiert!';
      setTimeout(()=>{btn.textContent='📋 Bild kopieren';btn.disabled=false;},2000);
    }catch(e){
      alert('Kopieren fehlgeschlagen: '+e.message);btn.textContent='📋 Bild kopieren';btn.disabled=false;
    }
  };
  renderTags();
  // Das ausgetauschte Kartenbild steckt als Base64 in der DB und wird erst hier geholt —
  // es wäre bei jedem Seitenaufruf unnötiger Ballast. Bis es da ist, steht das lokale
  // bzw. das Standardbild.
  (async()=>{
    try{
      // Selbstheilung: ein gespeichertes Bild, das nicht mehr lädt, wird verworfen —
      // sonst bliebe die Karte dauerhaft leer und das kaputte Bild würde unten sogar
      // als neuer Standard hochgeschoben.
      if(imgSrc!==DEF_IMG&&!(await imgLoads(imgSrc))){
        console.warn('Gespeichertes Kartenbild lädt nicht — zurück auf das Standardbild.');
        try{localStorage.removeItem(IMG_KEY);localStorage.removeItem(OWN_KEY);}catch(e){}
        ownImg=false;applyKarteBg(DEF_IMG,false);
      }
      if(_karteBgPulledFor!==AID()){await plannerPull(['karte_bg']);_karteBgPulledFor=AID();}
      const std=APP.planner.karte_bg&&APP.planner.karte_bg.img;
      if(!std){
        // Es gibt noch gar keinen Allianz-Standard. Wer ein brauchbares Bild im
        // localStorage hat, setzt damit den ersten.
        const mine=localStorage.getItem(IMG_KEY);
        if(mine&&mine!==DEF_IMG&&await imgLoads(mine))plannerPush('karte_bg',{img:mine},0);
        return;
      }
      // Ein bewusst hochgeladenes eigenes Bild hat Vorrang vor dem Standard.
      if(ownImg||std===imgSrc)return;
      if(!(await imgLoads(std))){
        console.warn('Allianz-Standardbild lädt nicht — dieses Gerät bleibt beim bisherigen Bild.');
        return;
      }
      applyKarteBg(std,false);
    }catch(e){console.warn('Kartenbild nicht ladbar:',e.message);}
  })();
}
// Bild in die Fotos-App legen. navigator.share öffnet auf iPhone/iPad/Android das
// System-Sheet, dort steht "Bild sichern" bzw. "In Fotos sichern". Ohne Share-API
// (Desktop-Browser) bleibt es beim normalen Download — deshalb heißt der Fallback
// hier bewusst nicht "Fehler", sondern speichert einfach als Datei.
// build() liefert die Canvas und läuft erst nach dem Button-Feedback, sonst wirkt
// das Rendern der großen PNGs wie ein Hänger.
