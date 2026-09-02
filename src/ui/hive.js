import { render } from '../app/render.js';
import { plannerPush } from '../core/auth.js';
import { fmtMio } from '../core/helpers.js';
import { HIVE_C, hiveBuild, hiveBuildArea } from '../core/hive.js';
import { trs } from '../core/i18n.js';
import { saveJpgToPhotos } from '../core/png.js';
import { APP } from '../core/state.js';
import { allianceName } from '../core/tenant.js';

export function hiveCanvas(m){
  const CW=176,CH=120,PAD=20,HEAD=76;
  const c=document.createElement('canvas');
  c.width=PAD*2+m.cols*CW;c.height=PAD*2+HEAD+m.rows*CH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.textBaseline='top';
  ctx.fillStyle='#111';ctx.font='bold 30px system-ui,-apple-system,Arial';
  ctx.fillText(trs('Hive-Aufstellung')+' — '+allianceName(),PAD,PAD);
  ctx.fillStyle='#666';ctx.font='17px system-ui,-apple-system,Arial';
  // Canvas ist kein DOM — die Anzeigeschicht greift hier nicht, trs() muss explizit sein.
  ctx.fillText(trs(`Zentrum x:${m.cx} y:${m.cy} · Bereich x:${m.x1}–${m.x2} y:${m.y1}–${m.y2}`
    +` · ${m.cols}×${m.rows} · ${m.placed} Spieler · Angabe = Gesamtkraft der Helden`),PAD,PAD+40);
  // Namen sind unterschiedlich lang; die Schrift schrumpft, bis der Name in die Zelle passt.
  const fit=(txt,maxW,start,weight)=>{
    let fs=start;
    do{ctx.font=`${weight} ${fs}px system-ui,-apple-system,Arial`;if(ctx.measureText(txt).width<=maxW)break;fs--;}while(fs>9);
    return fs;
  };
  m.cells.forEach((cell,i)=>{
    const col=i%m.cols,row=Math.floor(i/m.cols);
    const x=PAD+col*CW,y=PAD+HEAD+row*CH;
    ctx.fillStyle=HIVE_C[cell.role]||HIVE_C.R3;
    ctx.fillRect(x,y,CW,CH);
    ctx.strokeStyle='#58585a';ctx.lineWidth=3;ctx.strokeRect(x,y,CW,CH);
    const mid=x+CW/2;
    ctx.textAlign='center';
    if(cell.role==='free'){
      ctx.fillStyle='#7d94a3';ctx.font='15px system-ui,-apple-system,Arial';
      ctx.fillText(trs('frei'),mid,y+CH/2-10);
    }else{
      ctx.fillStyle='#111';
      const nfs=fit(cell.name,CW-14,cell.role==='MG'?26:17,'bold');
      ctx.fillText(cell.name,mid,y+(cell.role==='MG'?38:22));
      if(cell.power){
        ctx.fillStyle='#7a2b8a';ctx.font='bold 16px system-ui,-apple-system,Arial';
        ctx.fillText(fmtMio(cell.power),mid,y+28+nfs);
      }
    }
    ctx.fillStyle='#333';ctx.font='13px system-ui,-apple-system,Arial';
    ctx.fillText(`x:${cell.x} y:${cell.y}`,mid,y+CH-22);
  });
  ctx.textAlign='left';
  return c;
}
export function showHive(){
  const saved=APP.planner.hive||{};
  let mode=saved.mode==='area'?'area':'center';
  let model=null;
  const nz=v=>(v===null||v===undefined?'':v);
  const modal=document.createElement('div');
  modal.setAttribute('data-hive-modal','');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;overflow-y:auto;padding:12px';
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  const feld=(id,lbl,val,ph)=>`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">${lbl}</label>
    <input class="fi" id="${id}" type="number" value="${nz(val)}" placeholder="${ph}" style="width:104px"></div>`;
  modal.innerHTML=`<div style="background:#fff;border-radius:12px;padding:14px;max-width:980px;width:100%;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0;font-size:16px">🐝 Hive-Aufstellung</h3>
      <button class="btn btn-out btn-sm" onclick="this.closest('[data-hive-modal]').remove()">✕</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button id="hive-m-center" class="btn btn-sm ${mode==='center'?'btn-sol':'btn-out'}" style="flex:1">📍 Nur Zentrum</button>
      <button id="hive-m-area" class="btn btn-sm ${mode==='area'?'btn-sol':'btn-out'}" style="flex:1">⬛ Bereich vorgeben</button>
    </div>
    <div class="note info" id="hive-hint" style="margin-bottom:10px;padding:8px 12px;font-size:12px"></div>
    <div id="hive-in-center" style="display:${mode==='center'?'flex':'none'};gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
      ${feld('hive-x','Zentrum X',saved.x,'436')}
      ${feld('hive-y','Zentrum Y',saved.y,'507')}
    </div>
    <div id="hive-in-area" style="display:${mode==='area'?'flex':'none'};gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
      ${feld('hive-x1','Ecke 1 · X',saved.x1,'424')}
      ${feld('hive-y1','Ecke 1 · Y',saved.y1,'492')}
      ${feld('hive-x2','Ecke 2 · X',saved.x2,'451')}
      ${feld('hive-y2','Ecke 2 · Y',saved.y2,'522')}
    </div>
    <div style="margin-bottom:12px"><button class="btn btn-sol btn-sm" id="hive-go" style="height:36px">🐝 Hive aufbauen</button></div>
    <div id="hive-out"></div>
  </div>`;
  document.body.appendChild(modal);

  const HINTS={
    center:'Koordinate des Allianzzentrums eingeben — der Hive wird daraus automatisch aufgebaut: '
      +'MG in der Mitte, R5 und R4 im Innenring, nach außen absteigende Heldenkraft.',
    area:'Zwei gegenüberliegende Ecken des gewünschten Rechtecks eingeben — der Hive füllt genau '
      +'diesen Bereich, das MG landet in dessen Mitte. Reihenfolge der Ecken egal.'
  };
  function setMode(m){
    mode=m;model=null;
    document.getElementById('hive-m-center').className='btn btn-sm '+(m==='center'?'btn-sol':'btn-out');
    document.getElementById('hive-m-area').className='btn btn-sm '+(m==='area'?'btn-sol':'btn-out');
    document.getElementById('hive-in-center').style.display=m==='center'?'flex':'none';
    document.getElementById('hive-in-area').style.display=m==='area'?'flex':'none';
    document.getElementById('hive-hint').textContent=trs(HINTS[m]);
    document.getElementById('hive-out').innerHTML='';
  }
  document.getElementById('hive-m-center').onclick=()=>setMode('center');
  document.getElementById('hive-m-area').onclick=()=>setMode('area');
  document.getElementById('hive-hint').textContent=trs(HINTS[mode]);

  function render(){
    const out=document.getElementById('hive-out');
    if(!model){out.innerHTML='';return;}
    const legend=[['MG','MG (Allianz-Zentrum)'],['R5','R5'],['R4','R4'],['R3','R3']]
      .map(([k,l])=>`<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:13px;height:13px;border:1.5px solid #58585a;background:${HIVE_C[k]};display:inline-block"></i>${l}</span>`).join('');
    const rows=[];
    for(let r=0;r<model.rows;r++){
      const tds=model.cells.slice(r*model.cols,(r+1)*model.cols).map(c=>{
        if(c.role==='free')return`<td style="background:${HIVE_C.free};border:2px solid #58585a;padding:5px 3px;text-align:center;min-width:96px"><div style="font-size:10px;color:#7d94a3">frei</div><div style="font-size:9px;color:#333;margin-top:3px">x:${c.x} y:${c.y}</div></td>`;
        return`<td style="background:${HIVE_C[c.role]||HIVE_C.R3};border:2px solid #58585a;padding:5px 3px;text-align:center;min-width:96px">
          <div style="font-weight:800;font-size:${c.role==='MG'?'15':'11.5'}px;line-height:1.15;overflow-wrap:anywhere">${c.name}</div>
          ${c.power?`<div style="font-size:11px;font-weight:700;color:#7a2b8a;margin-top:2px">${fmtMio(c.power)}</div>`:''}
          <div style="font-size:9px;color:#333;margin-top:3px">x:${c.x} y:${c.y}</div></td>`;
      }).join('');
      rows.push('<tr>'+tds+'</tr>');
    }
    // Ein zu kleiner Bereich wird nicht stillschweigend beschnitten — wer draußen bleibt,
    // steht namentlich da, sonst fällt es erst im Spiel auf.
    // Bei einem sehr kleinen Bereich stünden hier sonst hundert Namen — gekürzt, aber
    // die Gesamtzahl bleibt sichtbar.
    const restN=model.rest.slice(0,12).map(p=>p.name).join(', ')
      +(model.rest.length>12?' … +'+(model.rest.length-12):'');
    const zuKlein=model.rest.length?`<div class="note" style="margin-bottom:8px;padding:8px 12px;font-size:12px;border-left-color:var(--loss);background:#fdecea">
        ⚠️ <strong>Der Bereich ist zu klein.</strong> ${model.rest.length} Spieler passen nicht hinein:
        ${restN}
      </div>`:'';
    out.innerHTML=`${zuKlein}
      <div class="note" style="margin-bottom:8px;padding:8px 12px;font-size:12px;border-left-color:var(--primary)">
        <strong>${model.cols}×${model.rows}</strong> · ${model.placed} Spieler platziert · ${model.free} Feld${model.free===1?'':'er'} frei
        · x:${model.x1}–${model.x2} y:${model.y1}–${model.y2}
      </div>
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--bd);border-radius:8px">
        <table style="border-collapse:collapse;font-family:inherit">${rows.join('')}</table>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:11.5px;color:var(--tx3)">${legend}</div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px">
        <button class="btn btn-sol btn-sm" id="hive-save" style="font-size:11px">💾 Speichern</button>
        <button class="btn btn-sol btn-sm" id="hive-photos" style="font-size:11px">📷 In Fotos</button>
        <button class="btn btn-sol btn-sm" id="hive-copy" style="font-size:11px">📋 Bild kopieren</button>
      </div>`;
    // Zwei Endungen, weil zwei Formate: „Speichern" lädt ein PNG herunter,
    // „Fotos" reicht ein JPEG weiter (siehe saveJpgToPhotos).
    const fname=(endung='png')=>`hive_${model.cx}_${model.cy}_${new Date().toISOString().slice(0,10)}.${endung}`;
    document.getElementById('hive-save').onclick=function(){
      const a=document.createElement('a');
      a.href=hiveCanvas(model).toDataURL('image/png');a.download=fname();a.target='_blank';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      this.textContent='✓ Gespeichert';setTimeout(()=>{this.textContent='💾 Speichern';},2000);
    };
    document.getElementById('hive-photos').onclick=function(){
      saveJpgToPhotos(()=>hiveCanvas(model),fname('jpg'),this);
    };
    document.getElementById('hive-copy').onclick=async function(){
      const btn=this;btn.textContent='⏳';btn.disabled=true;
      try{
        await new Promise((res,rej)=>hiveCanvas(model).toBlob(async b=>{
          try{await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);res();}catch(e){rej(e);}
        },'image/png'));
        btn.textContent='✓ Kopiert!';
      }catch(e){alert('Kopieren fehlgeschlagen: '+e.message);btn.textContent='📋 Bild kopieren';}
      setTimeout(()=>{btn.textContent='📋 Bild kopieren';btn.disabled=false;},2000);
    };
  }
  const zahl=id=>{const v=parseInt(document.getElementById(id).value,10);return isNaN(v)?null:v;};
  function bauen(){
    if(mode==='center'){
      const x=zahl('hive-x'),y=zahl('hive-y');
      if(x===null||y===null){alert(trs('Bitte X- und Y-Koordinate des Allianzzentrums eingeben.'));return false;}
      model=hiveBuild(x,y);
      plannerPush('hive',{mode:'center',x,y},0);
    }else{
      const x1=zahl('hive-x1'),y1=zahl('hive-y1'),x2=zahl('hive-x2'),y2=zahl('hive-y2');
      if([x1,y1,x2,y2].some(v=>v===null)){alert(trs('Bitte beide Ecken des Bereichs eingeben.'));return false;}
      model=hiveBuildArea(x1,y1,x2,y2);
      plannerPush('hive',{mode:'area',x1,y1,x2,y2},0);
    }
    return true;
  }
  // Die Koordinaten gelten für die ganze Allianz — wer schreiben darf, teilt sie.
  document.getElementById('hive-go').onclick=()=>{if(bauen())render();};
  // Gespeicherten Stand direkt aufbauen, aber ohne ihn gleich wieder hochzuschieben.
  const hatStand=mode==='center'
    ?(saved.x!==undefined&&saved.y!==undefined)
    :[saved.x1,saved.y1,saved.x2,saved.y2].every(v=>v!==undefined);
  if(hatStand){
    model=mode==='center'?hiveBuild(saved.x,saved.y):hiveBuildArea(saved.x1,saved.y1,saved.x2,saved.y2);
    render();
  }
}
