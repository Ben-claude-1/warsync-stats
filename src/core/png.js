import { getLineup, zeitLang } from './helpers.js';
import { trs } from './i18n.js';
import { APP } from './state.js';
import { wsZeit } from '../ui/ws.js';

// Was in die Fotos-App geht, geht als JPEG — nicht als PNG.
//
// Diese Bilder werden im Spiel gepostet, und der Weg dorthin ist eng: die
// Aufstellungs-Karte misst 1206×1136 und wog als PNG 2.283.189 Bytes, als JPEG
// mit Güte 0.85 noch 227.106 — ein Zehntel, bei praktisch gleichem Aussehen.
// Das Kartenfoto und die großen Flächen komprimiert JPEG gut, und die
// Namensschilder sind groß genug, dass die Artefakte nicht auffallen.
//
// **JPEG kennt kein Alpha.** Ein durchsichtiger Bereich wird beim Kodieren
// schwarz, nicht weiß — und welcher Bauer eine deckende Fläche hinlegt und
// welcher nicht, ist nicht jedem anzusehen. Deshalb wird hier zentral auf Weiß
// abgeflacht, statt sich auf die einzelnen Bauer zu verlassen: ein vergessener
// Hintergrund wäre sonst ein schwarzes Bild in der Allianz.
const JPEG_GUETE=0.85;
function aufWeiss(c){
  const flach=document.createElement('canvas');
  flach.width=c.width;flach.height=c.height;
  const ctx=flach.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,flach.width,flach.height);
  ctx.drawImage(c,0,0);
  return flach;
}
export async function saveJpgToPhotos(build,filename,btn){
  const orig=btn?btn.textContent:'';
  const reset=()=>{if(btn){btn.textContent=orig;btn.disabled=false;}};
  if(btn){btn.textContent='⏳';btn.disabled=true;}
  try{
    const c=await build();
    if(!c){reset();return;}
    const blob=await new Promise(r=>aufWeiss(c).toBlob(r,'image/jpeg',JPEG_GUETE));
    const file=new File([blob],filename,{type:'image/jpeg'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:filename.replace(/\.jpg$/,'')});
    }else{
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=filename;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }
    if(btn){btn.textContent='✓ Gespeichert';setTimeout(reset,1800);}
  }catch(e){
    // AbortError = Nutzer hat das Share-Sheet abgebrochen, das ist kein Fehler.
    if(!e||e.name!=='AbortError')alert('Speichern fehlgeschlagen: '+((e&&e.message)||e));
    reset();
  }
}
// Bild in die Zwischenablage legen — für alles, was direkt in einen Chat geklebt
// wird, ohne den Umweg über eine Datei.
//
// Safari verlangt, dass das ClipboardItem noch im Klick-Kontext entsteht: wer erst
// die Canvas rendert und danach schreibt, hat die Nutzergeste verloren und bekommt
// „NotAllowedError". Deshalb bekommt das ClipboardItem das Blob als Versprechen und
// der Knopf sein Warte-Zeichen erst danach.
//
// **Hier bleibt es bei PNG**, anders als beim Weg in die Fotos-App. Die Browser
// nehmen für die Zwischenablage nur `image/png` an; ein JPEG-ClipboardItem wirft
// „Type image/jpeg not supported". Die Größe stört hier ohnehin nicht — es
// entsteht keine Datei, die irgendwo hochgeladen wird.
export async function copyPngToClipboard(build,btn){
  const orig=btn?btn.textContent:'';
  const reset=()=>{if(btn){btn.textContent=orig;btn.disabled=false;}};
  try{
    const blobP=(async()=>{
      const c=await build();
      if(!c)throw new Error('Bild nicht gefunden');
      return await new Promise(r=>c.toBlob(r,'image/png'));
    })();
    const write=navigator.clipboard.write([new ClipboardItem({'image/png':blobP})]);
    if(btn){btn.textContent='⏳';btn.disabled=true;}
    await write;
    if(btn){btn.textContent='✓ Kopiert!';setTimeout(reset,1800);}
  }catch(e){
    alert('Kopieren fehlgeschlagen: '+((e&&e.message)||e));
    reset();
  }
}
// Prüft, ob eine Bildquelle wirklich lädt. Ein defektes Bild darf weder angezeigt
// noch als Allianz-Standard verteilt werden — sonst sieht die ganze Allianz nichts
// mehr, und das lässt sich von außen nicht mehr korrigieren.
export function imgLoads(src){
  return new Promise(res=>{
    if(!src)return res(false);
    const i=new Image();
    i.onload=()=>res(i.naturalWidth>0);
    i.onerror=()=>res(false);
    i.src=src;
  });
}
export async function _svgToPngCanvas(svgEl,scale){
  let xml=new XMLSerializer().serializeToString(svgEl);
  // Alle referenzierten Hintergrundbilder als Base64 einbetten (sonst rendert die Canvas sie nicht).
  for(const asset of ['assets/ws_map_bg.jpg','assets/cs_map_bg.png']){
    const ref=`href="${asset}"`;
    if(!xml.includes(ref))continue;
    try{
      const bgResp=await fetch(asset);
      const bgBlob=await bgResp.blob();
      const bgB64=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(bgBlob);});
      xml=xml.split(ref).join(`href="${bgB64}"`);
    }catch(e){console.warn('Hintergrundbild nicht ladbar:',asset,e);}
  }
  const vb=svgEl.viewBox.baseVal;
  const img=new Image();
  await new Promise(res=>{img.onload=res;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);});
  const c=document.createElement('canvas');
  c.width=vb.width*scale;c.height=vb.height*scale;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#f8f9fc';ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(img,0,0,c.width,c.height);
  return c;
}
export function _buildWSCardsCanvas(team,phase){
  const L=getLineup(team);
  const ba=APP.bldAssign||{};const ba2=APP.bldAssignPh2||{};
  const baCur=phase===1?ba:ba2;
  const BS={infozentrum:'Infozentrum',oelraf1:'Ölraf I',oelraf2:'Ölraf II',sciencehub:'Science Hub',laz1:'Laz I',laz2:'Laz II',laz3:'Laz III',laz4:'Laz IV'};
  const ZD=[{label:'Zone 1',color:'#c0392b',blds:['oelraf1','infozentrum']},{label:'Zone 2',color:'#e8a020',blds:['laz1','laz2']},{label:'Zone 3',color:'#27ae60',blds:['oelraf2','sciencehub']},{label:'Zone 4',color:'#2980b9',blds:['laz3','laz4']}];
  const S=2,W=400*S,pad=10*S,gap=6*S,colW=(W-pad*2-gap)/2;
  const lineH=18*S,hdrH=24*S,innerPad=8*S,titleH=38*S;
  const fs=12*S,hdrFs=13*S,titleFs=14*S;
  const teamPl=new Set([...(L.z1||[]),...(L.z2||[]),...(L.z3||[]),...(L.z4||[]),...(L.ass||[]),...(L.ars||[]),...(L.sold||[]),...(L.sup||[])]);
  const assSet=new Set(L.ass||[]),arsSet=new Set(L.ars||[]),soldSet=new Set(L.sold||[]);
  const isZ5=n=>assSet.has(n)||arsSet.has(n)||soldSet.has(n);
  function getEntries(zd){
    const byB={};zd.blds.forEach(b=>byB[b]=[]);
    Object.entries(baCur).forEach(([n,b])=>{if(zd.blds.includes(b)&&teamPl.has(n))byB[b].push(n);});
    const out=[];zd.blds.forEach(b=>(byB[b]||[]).forEach(n=>out.push({n,b,shifted:phase===2&&ba[n]!==ba2[n]})));
    return out;
  }
  function cardH(entries){return hdrH+Math.max(1,entries.length)*lineH+innerPad;}
  const zData=ZD.map(zd=>({zd,entries:getEntries(zd)}));
  const rows=[[zData[0],zData[1]],[zData[3],zData[2]]];
  const rowH=rows.map(r=>Math.max(cardH(r[0].entries),cardH(r[1].entries)));
  const z5entries=[];
  if(phase===2){
    (L.ass||[]).forEach(n=>z5entries.push({n,role:'Silo',color:'#7c3aed'}));
    (L.ars||[]).forEach(n=>z5entries.push({n,role:'Arsenal',color:'#e67e22'}));
    (L.sold||[]).forEach(n=>z5entries.push({n,role:'Söldner',color:'#e74c3c'}));
  } else {
    // Phase 1: Assassinen halten kein Gebäude und stehen deshalb in keiner
    // Zonen-Karte. Ohne diesen Kasten fehlten die Stärksten im geposteten Bild.
    (L.ass||[]).forEach(n=>z5entries.push({n,role:'',color:'#7c3aed'}));
  }
  const z5Titel=phase===2?'Zone 5 (ab Min 10:00)':'Assassinen — kein festes Gebäude, ab Min 10:00 Silo';
  const z5CardH=z5entries.length?hdrH+z5entries.length*lineH+innerPad+gap:0;
  const totalH=titleH+rowH.reduce((a,b)=>a+b,0)+(rows.length+1)*gap+z5CardH+gap;
  const c=document.createElement('canvas');c.width=W;c.height=totalH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#f8f9fc';ctx.fillRect(0,0,W,totalH);
  function rr(x,y,w,h,r,fill,stroke,lw){
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw||2*S;ctx.stroke();}
  }
  // Titel — mit beiden Uhrzeiten wird die Zeile lang. Passt sie nicht in die
  // Breite, schrumpft die Schrift; abgeschnitten werden darf sie nicht, die
  // Serverzeit ist die, nach der im Spiel angesagt wird.
  const titel=`Team ${team} · ${zeitLang(wsZeit(team))} – `+trs('Phase '+phase+' Aufstellung');
  ctx.textAlign='center';
  ctx.fillStyle=phase===1?'#27ae60':'#7c3aed';
  let tfs=titleFs;
  ctx.font=`800 ${tfs}px Arial`;
  const maxW=W-pad*2;
  const tw=ctx.measureText(titel).width;
  if(tw>maxW){tfs=Math.max(9*S,Math.floor(tfs*maxW/tw));ctx.font=`800 ${tfs}px Arial`;}
  ctx.fillText(titel,W/2,titleH-10*S);
  ctx.textAlign='left';
  function drawCard(x,y,w,h,zd,entries){
    rr(x,y,w,h,8*S,'#fff',zd.color,2*S);
    ctx.font=`800 ${hdrFs}px Arial`;ctx.fillStyle=zd.color;ctx.fillText(trs(zd.label),x+innerPad,y+hdrH-5*S);
    let ey=y+hdrH;
    if(!entries.length){ctx.font=`${fs}px Arial`;ctx.fillStyle='#aaa';ctx.fillText('–',x+innerPad,ey+lineH-4*S);}
    else entries.forEach(({n,b,shifted})=>{
      if(shifted){ctx.fillStyle='#fffde7';ctx.fillRect(x+2*S,ey,w-4*S,lineH);}
      ctx.font=`700 ${fs}px Arial`;ctx.fillStyle=zd.color;
      const bl=trs(BS[b]||b)+': ';ctx.fillText(bl,x+innerPad,ey+lineH-4*S);
      const bw=ctx.measureText(bl).width;
      ctx.font=`${fs}px Arial`;ctx.fillStyle='#222';ctx.fillText(n,x+innerPad+bw,ey+lineH-4*S);
      const nw=ctx.measureText(n).width;
      if(phase===1&&isZ5(n)){ctx.font=`700 ${9*S}px Arial`;ctx.fillStyle='#7c3aed';ctx.fillText('⏱Z5',x+innerPad+bw+nw+3*S,ey+lineH-4*S);}
      else if(shifted){ctx.font=`700 ${9*S}px Arial`;ctx.fillStyle='#e67e22';ctx.fillText('↑',x+innerPad+bw+nw+3*S,ey+lineH-4*S);}
      ey+=lineH;
    });
  }
  let cy=titleH+gap;
  rows.forEach((row,ri)=>{
    const rh=rowH[ri];
    row.forEach(({zd,entries},ci)=>drawCard(pad+ci*(colW+gap),cy,colW,rh,zd,entries));
    cy+=rh+gap;
  });
  if(z5entries.length){
    const z5H=hdrH+z5entries.length*lineH+innerPad;
    rr(pad,cy,W-pad*2,z5H,8*S,'#faf5ff','#7c3aed',2*S);
    ctx.font=`800 ${hdrFs}px Arial`;ctx.fillStyle='#7c3aed';ctx.fillText(trs(z5Titel),pad+innerPad,cy+hdrH-5*S);
    let z5y=cy+hdrH;
    z5entries.forEach(({n,role,color})=>{
      ctx.font=`700 ${fs}px Arial`;ctx.fillStyle=color;
      const rl=role?trs(role)+': ':'';
      if(rl)ctx.fillText(rl,pad+innerPad,z5y+lineH-4*S);
      const rlw=rl?ctx.measureText(rl).width:0;
      ctx.font=`${fs}px Arial`;ctx.fillStyle='#222';ctx.fillText(n,pad+innerPad+rlw,z5y+lineH-4*S);
      z5y+=lineH;
    });
  }
  return c;
}
export async function _buildWSMapCanvas(team,phase){
  const box=document.getElementById('ws-map-'+team+'-p'+phase);
  if(!box)return null;const svg=box.querySelector('svg');if(!svg)return null;
  return _svgToPngCanvas(svg,2);
}
export async function _buildWSCombinedCanvas(team,phase){
  const mapC=await _buildWSMapCanvas(team,phase);
  if(!mapC)return null;
  const cardsC=_buildWSCardsCanvas(team,phase);
  const totalH=mapC.height+cardsC.height;
  const c=document.createElement('canvas');c.width=mapC.width;c.height=totalH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#f8f9fc';ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(mapC,0,0);ctx.drawImage(cardsC,0,mapC.height);
  return c;
}
export async function downloadWSMapPng(team,phase){
  const c=await _buildWSMapCanvas(team,phase);
  if(!c)return;
  const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download=`warsync_team${team}_phase${phase}_karte.png`;a.click();
}
export async function downloadWSCardsPng(team,phase){
  const c=_buildWSCardsCanvas(team,phase);
  const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download=`warsync_team${team}_phase${phase}_aufstellung.png`;a.click();
}
export async function downloadWSCombinedPng(team,phase){
  const c=await _buildWSCombinedCanvas(team,phase);
  if(!c)return;
  const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download=`warsync_team${team}_phase${phase}_komplett.jpg`;a.click();
}
// Fotos-Variante bekommt das komplette Bild (Karte + Aufstellungskarten) — das ist
// das, was man im Handy-Album wiederfinden will.
export async function shareWSCombinedPng(team,phase,btn){
  await saveJpgToPhotos(()=>_buildWSCombinedCanvas(team,phase),`warsync_team${team}_phase${phase}_komplett.jpg`,btn);
}
