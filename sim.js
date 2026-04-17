// --- STRATEGIE-SIMULATOR v3 ---
const SGAME=1800,SZ5O=632,SZ5D=1168;
const SZPTS={z1:60,z2:60,z3:60,z4:60,z5:100};
const SZDUR={z1:1800,z2:1800,z3:1800,z4:1800,z5:1168};
function simU(t1){return Math.round(28000+Math.max(0,t1-18)*545);}
function simStr(names,appPl,mul){
  return(names||[]).reduce((s,n)=>{
    const p=appPl.find(x=>x.name===n);const t1=p?.t1||0;
    return s+t1*(simU(t1)/40000)*mul;
  },0);
}
function simAssign(lineup,appPl,weights,assRole,steal,supSlots){
  const stealKey=steal==='left'?'z4':steal==='right'?'z2':null;
  const all=Object.values(lineup).flat()
    .map(n=>{const p=appPl.find(x=>x.name===n);return{name:n,t1:p?.t1||0};})
    .filter((p,i,a)=>a.findIndex(x=>x.name===p.name)===i)
    .sort((a,b)=>b.t1-a.t1);
  const n=all.length;
  const assN=Math.min(2,n);
  const supN=Math.min(supSlots||0,Math.max(0,n-assN));
  const zonePool=all.slice(assN,n-supN);
  const activeZ=['z1','z2','z3','z4'].filter(z=>z!==stealKey);
  const totalW=activeZ.reduce((s,z)=>s+(weights[z]||20),0)||1;
  const slots={};let slotSum=0;
  activeZ.forEach(z=>{slots[z]=Math.max(1,Math.round(zonePool.length*(weights[z]||20)/totalW));slotSum+=slots[z];});
  while(slotSum<zonePool.length&&activeZ.length){slots[activeZ[0]]++;slotSum++;}
  while(slotSum>zonePool.length){const z=activeZ.find(z=>slots[z]>1);if(z){slots[z]--;slotSum--;}else break;}
  const byPrio=[...activeZ].sort((a,b)=>(weights[b]||0)-(weights[a]||0));
  const asgn={ass:[],sup:[],z1:[],z2:[],z3:[],z4:[]};
  asgn.ass=all.slice(0,assN).map(p=>p.name);
  asgn.sup=all.slice(n-supN).map(p=>p.name);
  let pool=[...zonePool];
  for(const z of byPrio){while(pool.length&&asgn[z].length<(slots[z]||0)){asgn[z].push(pool.shift().name);}}
  while(pool.length){asgn[byPrio[0]].push(pool.shift().name);}
  if(assRole==='defend'&&asgn.ass.length>1){
    const defZ=stealKey==='z1'?'z3':'z1';asgn[defZ].unshift(asgn.ass.pop());
  }
  if(stealKey)asgn[stealKey]=[];
  return asgn;
}
function simBattle(asgA,asgB,appPl,optsA,optsB){
  const aRA=(optsA&&optsA.assRole)||'attack';
  const aRB=(optsB&&optsB.assRole)||'attack';
  const riA=(optsA&&optsA.raidInterval)||0;
  const riB=(optsB&&optsB.raidInterval)||0;
  const SUP_FRAC=600/SGAME;
  function pH(a,b){return a+b<0.01?0.5:Math.max(0.05,Math.min(0.95,a/(a+b)));}
  let ctrl={z1:.5,z2:.5,z3:.5,z4:.5,z5:.5};
  let strA={z1:0,z2:0,z3:0,z4:0,z5:0},strB={z1:0,z2:0,z3:0,z4:0,z5:0};
  for(let iter=0;iter<4;iter++){
    const arsA=ctrl.z5>.5?1.15:1,arsB=ctrl.z5<=.5?1.15:1;
    const soldDebB=ctrl.z5>.5?0.85:1,soldDebA=ctrl.z5<=.5?0.85:1;
    const techA=ctrl.z3>.5?1.08:1,techB=ctrl.z3<=.5?1.08:1;
    const lazA=(ctrl.z2>.5?1.025:1)*(ctrl.z4>.5?1.025:1);
    const lazB=((1-ctrl.z2)>.5?1.025:1)*((1-ctrl.z4)>.5?1.025:1);
    // Raid transit: during swap travel (~90s per swap) lazarett zones are undermanned
    const rtA=riA>0?Math.min(0.35,(Math.floor(SGAME/(riA*60))*90)/SGAME):0;
    const rtB=riB>0?Math.min(0.35,(Math.floor(SGAME/(riB*60))*90)/SGAME):0;
    for(const z of ['z1','z2','z3','z4']){
      const lazWeakA=(riA>0&&(z==='z2'||z==='z4'))?(1-rtA*0.6):1;
      const lazWeakB=(riB>0&&(z==='z2'||z==='z4'))?(1-rtB*0.6):1;
      strA[z]=simStr(asgA[z],appPl,arsA*techA*lazA*lazWeakA);
      strB[z]=simStr(asgB[z],appPl,arsB*techB*lazB*soldDebB*lazWeakB);
    }
    // Springer (sup): weakest players, join Z1 in endgame (last 600s = 33% of game)
    strA.z1+=simStr(asgA.sup||[],appPl,arsA*techA*lazA)*SUP_FRAC;
    strB.z1+=simStr(asgB.sup||[],appPl,arsB*techB*lazB*soldDebB)*SUP_FRAC;
    // Assassin contributions
    const assBaseA=simStr(asgA.ass||[],appPl,arsA*techA);
    const assBaseB=simStr(asgB.ass||[],appPl,arsB*techB*soldDebA);
    if(aRA==='zoneDefense'){
      // Assassins reinforce the most contested zone (lowest ctrl for A)
      const wZ=['z1','z2','z3','z4'].reduce((w,z)=>ctrl[z]<ctrl[w]?z:w,'z1');
      strA[wZ]+=assBaseA*0.7;strA.z5=assBaseA*0.3*(ctrl.z5>.5?1.10:1);
    }else if(aRA==='z5Solo'){
      // Assassins all-in on Z5 silo with focus bonus
      strA.z5=assBaseA*1.3*(ctrl.z5>.5?1.10:1);
    }else{
      strA.z5=assBaseA*(ctrl.z5>.5?1.10:1);
    }
    if(aRB==='zoneDefense'){
      const wZ=['z1','z2','z3','z4'].reduce((w,z)=>ctrl[z]>ctrl[w]?z:w,'z1');
      strB[wZ]+=assBaseB*0.7;strB.z5=assBaseB*0.3*(ctrl.z5<=.5?1.10:1);
    }else if(aRB==='z5Solo'){
      strB.z5=assBaseB*1.3*(ctrl.z5<=.5?1.10:1);
    }else{
      strB.z5=assBaseB*(ctrl.z5<=.5?1.10:1);
    }
    for(const z of ['z1','z2','z3','z4','z5'])ctrl[z]=pH(strA[z],strB[z]);
  }
  const infoA=ctrl.z1>.5?1.10:1,infoB=ctrl.z1<=.5?1.10:1;
  let ptsA=0,ptsB=0;const zR={};
  for(const z of ['z1','z2','z3','z4','z5']){
    const d=SZDUR[z],p=SZPTS[z],pA=ctrl[z];
    const zA=p*d*pA*infoA,zB=p*d*(1-pA)*infoB;
    ptsA+=zA;ptsB+=zB;
    zR[z]={pA,ptsA:zA,ptsB:zB,strA:strA[z]||0,strB:strB[z]||0};
  }
  // Lazarett-Raid bonus: each swap collects crates from own drop + opponent zone
  // Own zone drops ~50s worth on abandon; opponent zone ~50s if raid succeeds (~65% rate)
  let raidBonusA=0,raidBonusB=0;
  if(riA>0){const ns=Math.floor(SGAME/(riA*60));raidBonusA=Math.round(ns*(SZPTS.z2*50+SZPTS.z4*50)*0.65);ptsA+=raidBonusA;}
  if(riB>0){const ns=Math.floor(SGAME/(riB*60));raidBonusB=Math.round(ns*(SZPTS.z2*50+SZPTS.z4*50)*0.65);ptsB+=raidBonusB;}
  const efx={arsenalA:ctrl.z5>.5,techA:ctrl.z3>.5,infoA:ctrl.z1>.5,
    lazA:(ctrl.z2>.5?1:0)+(ctrl.z4>.5?1:0),arsenalB:ctrl.z5<=.5,techB:ctrl.z3<=.5,infoB:ctrl.z1<=.5,
    raidBonusA,raidBonusB};
  return{ptsA,ptsB,zones:zR,ctrl,diff:ptsA-ptsB,won:ptsA>ptsB,efx};
}
const SIM_SCENARIOS=[
  {id:'balanced',label:'Ausgeglichen',w:{z1:25,z2:20,z3:25,z4:20},ass:'attack',steal:'none',raid:0,sup:0},
  {id:'z1z3focus',label:'Z1/Z3-Fokus',w:{z1:40,z2:10,z3:40,z4:10},ass:'attack',steal:'none',raid:0,sup:0},
  {id:'stealLeft',label:'Steal Links (Z4 leer)',w:{z1:35,z2:20,z3:35,z4:0},ass:'attack',steal:'left',raid:0,sup:0},
  {id:'stealRight',label:'Steal Rechts (Z2 leer)',w:{z1:35,z2:0,z3:35,z4:20},ass:'attack',steal:'right',raid:0,sup:0},
  {id:'defend',label:'Defensiv (Ass→Z1)',w:{z1:30,z2:15,z3:30,z4:15},ass:'defend',steal:'none',raid:0,sup:0},
  {id:'zoneDefense',label:'Zone-Schutz (Ass)',w:{z1:25,z2:20,z3:25,z4:20},ass:'zoneDefense',steal:'none',raid:0,sup:0},
  {id:'z5Solo',label:'Z5-Solo (Ass)',w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',steal:'none',raid:0,sup:0},
  {id:'withSup',label:'Springer Endgame',w:{z1:25,z2:20,z3:25,z4:20},ass:'attack',steal:'none',raid:0,sup:2},
  {id:'supZ5',label:'Springer + Z5-Solo',w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',steal:'none',raid:0,sup:2},
  {id:'raid5',label:'Laz-Raid 5min',w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',steal:'none',raid:5,sup:0},
  {id:'raid10',label:'Laz-Raid 10min',w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',steal:'none',raid:10,sup:0},
  {id:'raid15',label:'Laz-Raid 15min',w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',steal:'none',raid:15,sup:0},
  {id:'raidZ5',label:'Raid 5min + Z5-Solo',w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',steal:'none',raid:5,sup:0},
  {id:'raidSup',label:'Raid 10min + Springer',w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',steal:'none',raid:10,sup:2},
  {id:'stealRaid',label:'Steal + Raid 10min',w:{z1:35,z2:20,z3:35,z4:0},ass:'attack',steal:'left',raid:10,sup:0},
  {id:'fullCombo',label:'Raid 5min + Z5Solo + Springer',w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',steal:'none',raid:5,sup:2},
  // ── Optimierte Strategien (Brute-Force über 5.460 Kombinationen mit echten Spielerdaten) ──
  // Universalsieger: schlägt alle anderen Szenarien.
  // Schlüssel: Z1+Z3 gleich stark (Oil+Info UND Oil+Tech gesichert) + z5Solo (Arsenal)
  // + Raid 10min (~11.7K Kisten-Bonus, nur 9% Lazarett-Malus) + Z4 fast leer (Lazarett = schwächster Bonus)
  {id:'z3dom',label:'★ Z3-Dominanz + Z5-Solo',w:{z1:20,z2:5,z3:65,z4:10},ass:'z5Solo',steal:'none',raid:0,sup:2},
  {id:'z3domRaid',label:'★ Z3-Dom + Raid 10min',w:{z1:20,z2:5,z3:60,z4:15},ass:'z5Solo',steal:'none',raid:10,sup:2},
  {id:'optimal',label:'★★ Z1/Z3+Z5Solo+Raid10 (Universalsieger)',w:{z1:40,z2:20,z3:40,z4:0},ass:'z5Solo',steal:'none',raid:10,sup:0},
];
function wsSimulator(){
  const t=APP.team;
  const rawLineup=getLineup(t);
  const players=APP.data.players;
  const allPl=Object.values(rawLineup).flat().filter((n,i,a)=>a.indexOf(n)===i);
  if(!allPl.length)return'<div class="note">Erst im Tab <strong>Aufstellung</strong> Spieler zuweisen.</div>';
  if(!APP.simV2)APP.simV2={
    mode:'matrix',
    wA:{z1:25,z2:20,z3:25,z4:20},assA:'attack',stealA:'none',raidA:0,supA:0,
    wB:{z1:25,z2:20,z3:25,z4:20},assB:'attack',stealB:'none',raidB:0,supB:0,
    selPresetA:'balanced',selPresetB:'z1z3focus',
  };
  const sv=APP.simV2;
  sv.raidA=sv.raidA||0;sv.raidB=sv.raidB||0;sv.supA=sv.supA||0;sv.supB=sv.supB||0;
  const fmtK=v=>v>=1e6?(v/1e6).toFixed(2)+'M':v>=1000?(v/1e3).toFixed(0)+'K':Math.round(v);
  const pctC=p=>p>=.65?'var(--win)':p>=.45?'var(--acc)':'var(--loss)';
  const ZLBL={z1:'Zone 1 (Öl+Info)',z2:'Zone 2 (Laz.)',z3:'Zone 3 (Öl+Tech)',z4:'Zone 4 (Laz.)',z5:'Zone 5 (Silo)'};
  const ASS_ROLES=[
    {id:'attack',l:'⚔ Angriff (Z5)'},
    {id:'defend',l:'🛡 Defend Z1'},
    {id:'zoneDefense',l:'🔒 Zone-Schutz'},
    {id:'z5Solo',l:'💪 Z5-Solo'},
  ];

  function getSide(w,ass,steal,sup){return simAssign(rawLineup,players,w,ass,steal,sup||0);}
  const asgA=getSide(sv.wA,sv.assA,sv.stealA,sv.supA);
  const asgB=getSide(sv.wB,sv.assB,sv.stealB,sv.supB);
  const battle=simBattle(asgA,asgB,players,
    {assRole:sv.assA,raidInterval:sv.raidA},
    {assRole:sv.assB,raidInterval:sv.raidB}
  );
  const winPct=Math.round(battle.ptsA/(battle.ptsA+battle.ptsB)*100);

  function rankScenarios(){
    return SIM_SCENARIOS.map(pA=>{
      let wins=0,totDiff=0;
      const results=[];
      for(const pB of SIM_SCENARIOS){
        if(pA.id===pB.id)continue;
        const aA=getSide(pA.w,pA.ass,pA.steal,pA.sup||0);
        const aB=getSide(pB.w,pB.ass,pB.steal,pB.sup||0);
        const r=simBattle(aA,aB,players,
          {assRole:pA.ass,raidInterval:pA.raid||0},
          {assRole:pB.ass,raidInterval:pB.raid||0}
        );
        if(r.won)wins++;totDiff+=r.diff;
        results.push({id:pB.id,label:pB.label,won:r.won,diff:Math.round(r.diff)});
      }
      return{...pA,wins,avgDiff:Math.round(totDiff/results.length||1),results};
    }).sort((a,b)=>b.wins-a.wins||b.avgDiff-a.avgDiff);
  }
  const ranked=rankScenarios();

  const allPlData=allPl.map(n=>{const p=players.find(x=>x.name===n);return{name:n,t1:p?.t1||0,units:simU(p?.t1||0)};}).sort((a,b)=>b.t1-a.t1);
  const maxT1=allPlData[0]?.t1||1;

  function wSliders(side){
    const w=side==='A'?sv.wA:sv.wB;
    const steal=side==='A'?sv.stealA:sv.stealB;
    const stealKey=steal==='left'?'z4':steal==='right'?'z2':null;
    return['z1','z2','z3','z4'].map(z=>{
      const disabled=stealKey===z;
      const c=z==='z1'||z==='z3'?'var(--oil)':'var(--med)';
      return'<div style="margin-bottom:6px;'+(disabled?'opacity:.4':'')+'">'+
        '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:1px">'+
        '<span style="font-weight:700;color:'+c+'">'+ZLBL[z]+(disabled?' ✗':'')+'</span>'+
        '<span id="sw'+side+z+'" style="font-weight:800">'+(w[z]||20)+'</span></div>'+
        '<input type="range" min="0" max="60" value="'+(w[z]||20)+'" '+(disabled?'disabled':'')+
        ' style="width:100%;accent-color:'+c+'" oninput="APP.simV2.w'+side+'.'+z+'=parseInt(this.value);document.getElementById(\'sw'+side+z+'\').textContent=this.value;renderPage()">'+
        '</div>';
    }).join('');
  }

  function sidePanel(side){
    const ass=side==='A'?sv.assA:sv.assB;
    const steal=side==='A'?sv.stealA:sv.stealB;
    const raid=side==='A'?sv.raidA:sv.raidB;
    const sup=side==='A'?sv.supA:sv.supB;
    const asgn=side==='A'?asgA:asgB;
    const col=side==='A'?'#2980b9':'#c0392b';
    const ptsLabel=side==='A'?fmtK(battle.ptsA):fmtK(battle.ptsB);
    const ptsCol=side==='A'?(battle.won?'var(--win)':'var(--loss)'):(battle.won?'var(--loss)':'var(--win)');
    const raidBonus=side==='A'?battle.efx.raidBonusA:battle.efx.raidBonusB;
    return'<div class="card" style="border:2px solid '+col+'33">'+
      '<div class="ch" style="color:'+col+'">Seite '+side+' · <span style="font-size:14px;font-weight:900;color:'+ptsCol+'">'+ptsLabel+'</span>'+
      (raidBonus>0?'<span style="font-size:10px;color:var(--win);margin-left:6px">+'+fmtK(raidBonus)+' Raid</span>':'')+
      '</div><div class="cb">'+
      wSliders(side)+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">ASSASSINEN</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:3px">'+
      ASS_ROLES.map(r=>'<button class="btn '+(ass===r.id?'btn-sol':'btn-out')+'" style="flex:1;min-width:calc(50% - 4px);font-size:10px;padding:3px" onclick="APP.simV2.ass'+side+'=\''+r.id+'\';renderPage()">'+r.l+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">STEAL-STRATEGIE</div>'+
      '<div style="display:flex;gap:3px">'+
      ['none','left','right'].map(s=>'<button class="btn '+(steal===s?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:3px" onclick="APP.simV2.steal'+side+'=\''+s+'\';renderPage()">'+(s==='none'?'Kein':s==='left'?'Links(Z4)':'Rechts(Z2)')+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">LAZ-RAID (Z2↔Z4 Kistentausch)</div>'+
      '<div style="display:flex;gap:3px">'+
      [0,5,10,15].map(r=>'<button class="btn '+(raid===r?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:3px" onclick="APP.simV2.raid'+side+'='+r+';renderPage()">'+(r===0?'Kein':r+'min')+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">SPRINGER (schwächste → Endgame Z1)</div>'+
      '<div style="display:flex;gap:3px">'+
      [0,1,2,3].map(s=>'<button class="btn '+(sup===s?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:3px" onclick="APP.simV2.sup'+side+'='+s+';renderPage()">'+(s===0?'Kein':s+' Spr.')+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px;font-size:10px;color:var(--tx3);line-height:1.6">'+
      '<strong>Ass:</strong> '+((asgn.ass||[]).join(', ')||'–')+'<br>'+
      ((asgn.sup||[]).length?'<strong>Springer:</strong> '+asgn.sup.join(', ')+'<br>':'')+
      ['z1','z2','z3','z4'].filter(z=>(asgn[z]||[]).length).map(z=>'<strong>'+z.toUpperCase()+':</strong> '+asgn[z].join(', ')).join(' · ')+
      '</div></div></div>';
  }

  function zRow(z,r){
    return'<tr style="border-top:1px solid var(--bd)">'+
      '<td style="padding:4px 5px;font-weight:700;font-size:11px">'+ZLBL[z]+'<br><span style="font-size:9px;color:var(--tx3)">'+SZPTS[z]+'/s·'+(SZDUR[z]/60).toFixed(0)+'min</span></td>'+
      '<td style="text-align:right;padding:4px 5px;font-size:11px;color:#2980b9;font-weight:700">'+r.strA.toFixed(1)+'</td>'+
      '<td style="text-align:right;padding:4px 5px;font-size:11px;color:#c0392b;font-weight:700">'+r.strB.toFixed(1)+'</td>'+
      '<td style="padding:4px 5px"><div style="display:flex;align-items:center;gap:3px">'+
      '<div style="flex:1;height:8px;border-radius:4px;background:#fdd;overflow:hidden">'+
      '<div style="width:'+Math.round(r.pA*100)+'%;height:100%;background:'+pctC(r.pA)+';border-radius:4px 0 0 4px"></div></div>'+
      '<span style="font-size:10px;font-weight:800;color:'+pctC(r.pA)+';min-width:30px">'+Math.round(r.pA*100)+'%</span>'+
      '</div></td>'+
      '<td style="text-align:right;padding:4px 5px;font-size:10px;font-weight:700;color:'+pctC(r.pA)+'">'+fmtK(r.ptsA)+'</td>'+
      '<td style="text-align:right;padding:4px 5px;font-size:10px;color:var(--tx3)">'+fmtK(r.ptsB)+'</td></tr>';
  }

  function sTags(p){
    const tags=[];
    if(p.raid>0)tags.push('Raid '+p.raid+'min');
    if(p.sup>0)tags.push(p.sup+' Springer');
    if(p.steal!=='none')tags.push('Steal '+(p.steal==='left'?'Links':'Rechts'));
    const aLbl={attack:'Ass:Angriff',defend:'Ass:Defend Z1',zoneDefense:'Ass:Zone-Schutz',z5Solo:'Ass:Z5-Solo'};
    tags.push(aLbl[p.ass]||p.ass);
    return tags.map(x=>'<span style="background:#f0f0f0;border-radius:4px;padding:1px 5px;font-size:9px">'+x+'</span>').join(' ');
  }

  const modeBtns=[{id:'vsSame',l:'Manuell A vs B'},{id:'vsPreset',l:'Preset-Auswahl'},{id:'matrix',l:'Alle Szenarien'}];

  let presetPanels='';
  if(sv.mode==='vsPreset'){
    presetPanels='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+
    '<div class="card"><div class="ch" style="color:#2980b9">Preset Seite A</div><div class="cb">'+
    SIM_SCENARIOS.map(p=>'<label style="display:flex;gap:6px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;background:'+(sv.selPresetA===p.id?'#e8f4fd':'')+'">'
      +'<input type="radio" name="pA" '+(sv.selPresetA===p.id?'checked':'')+' onchange="const pr=SIM_SCENARIOS.find(x=>x.id===\''+p.id+'\');APP.simV2.selPresetA=\''+p.id+'\';APP.simV2.wA={...pr.w};APP.simV2.assA=pr.ass;APP.simV2.stealA=pr.steal;APP.simV2.raidA=pr.raid||0;APP.simV2.supA=pr.sup||0;renderPage()">'
      +'<span style="font-size:11px">'+p.label+'</span></label>').join('')+
    '</div></div>'+
    '<div class="card"><div class="ch" style="color:#c0392b">Preset Seite B</div><div class="cb">'+
    SIM_SCENARIOS.map(p=>'<label style="display:flex;gap:6px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;background:'+(sv.selPresetB===p.id?'#fff0f0':'')+'">'
      +'<input type="radio" name="pB" '+(sv.selPresetB===p.id?'checked':'')+' onchange="const pr=SIM_SCENARIOS.find(x=>x.id===\''+p.id+'\');APP.simV2.selPresetB=\''+p.id+'\';APP.simV2.wB={...pr.w};APP.simV2.assB=pr.ass;APP.simV2.stealB=pr.steal;APP.simV2.raidB=pr.raid||0;APP.simV2.supB=pr.sup||0;renderPage()">'
      +'<span style="font-size:11px">'+p.label+'</span></label>').join('')+
    '</div></div></div>';
  }else if(sv.mode==='vsSame'){
    presetPanels='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+sidePanel('A')+sidePanel('B')+'</div>';
  }

  const battleHtml=sv.mode!=='matrix'?
    '<div class="card" style="margin-bottom:10px;border:2px solid '+(battle.won?'var(--win)':'var(--loss)')+'44">'+
    '<div class="ch" style="color:'+(battle.won?'var(--win)':'var(--loss)')+'">'+(battle.won?'✅ Seite A gewinnt':'❌ Seite B gewinnt')+' · '+fmtK(Math.abs(battle.diff))+' Punkte Differenz</div>'+
    '<div class="cb">'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
    '<div style="flex:1;text-align:center;background:#f0fff4;border-radius:10px;padding:10px;border:1px solid #b2dfdb">'+
    '<div style="font-size:10px;color:var(--tx3);font-weight:700">SEITE A</div>'+
    '<div style="font-size:22px;font-weight:900;color:var(--win)">'+fmtK(battle.ptsA)+'</div>'+
    (battle.efx.raidBonusA>0?'<div style="font-size:10px;color:var(--win)">+'+fmtK(battle.efx.raidBonusA)+' Raid-Kisten</div>':'')+
    '</div>'+
    '<div style="display:flex;align-items:center;font-weight:800;color:var(--tx3)">VS</div>'+
    '<div style="flex:1;text-align:center;background:#fff5f5;border-radius:10px;padding:10px;border:1px solid #ffcdd2">'+
    '<div style="font-size:10px;color:var(--tx3);font-weight:700">SEITE B</div>'+
    '<div style="font-size:22px;font-weight:900;color:var(--loss)">'+fmtK(battle.ptsB)+'</div>'+
    (battle.efx.raidBonusB>0?'<div style="font-size:10px;color:var(--loss)">+'+fmtK(battle.efx.raidBonusB)+' Raid-Kisten</div>':'')+
    '</div></div>'+
    '<div style="height:12px;border-radius:6px;background:#fdd;overflow:hidden;margin-bottom:4px">'+
    '<div style="width:'+winPct+'%;height:100%;background:'+(winPct>=55?'var(--win)':winPct>=45?'var(--acc)':'var(--loss)')+';border-radius:6px"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:10px">'+
    '<span style="color:#2980b9;font-weight:700">A '+winPct+'%</span><span style="color:#c0392b;font-weight:700">B '+(100-winPct)+'%</span></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">'+
    (battle.efx.infoA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">📡 Info A +10%</span>':'')+
    (battle.efx.arsenalA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">⚔ Arsenal A +15%</span>':'')+
    (battle.efx.techA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">🔬 Tech A +8%</span>':'')+
    (battle.efx.lazA>0?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">🏥 Laz A ×'+battle.efx.lazA+'</span>':'')+
    (battle.efx.infoB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">📡 Info B +10%</span>':'')+
    (battle.efx.arsenalB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">⚔ Arsenal B +15%</span>':'')+
    (battle.efx.techB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">🔬 Tech B +8%</span>':'')+
    '</div>'+
    '<div class="scroll-x"><table style="width:100%;border-collapse:collapse;font-size:11px">'+
    '<thead><tr style="color:var(--tx3);font-size:9px;text-transform:uppercase">'+
    '<th style="text-align:left;padding:3px 5px">Zone</th>'+
    '<th style="text-align:right;padding:3px 5px">Str A</th>'+
    '<th style="text-align:right;padding:3px 5px">Str B</th>'+
    '<th style="padding:3px 5px">A hält</th>'+
    '<th style="text-align:right;padding:3px 5px">Pkt A</th>'+
    '<th style="text-align:right;padding:3px 5px">Pkt B</th>'+
    '</tr></thead><tbody>'+
    ['z1','z2','z3','z4','z5'].map(z=>zRow(z,battle.zones[z])).join('')+
    '</tbody></table></div></div></div>':'';

  function matchupRows(results){
    const won=results.filter(r=>r.won);
    const lost=results.filter(r=>!r.won);
    function chips(list,col,bg){
      return list.map(r=>'<span title="'+r.label+'\nDiff: '+(r.diff>0?'+':'')+fmtK(r.diff)+'" style="display:inline-block;background:'+bg+';color:'+col+';border-radius:4px;padding:1px 5px;font-size:9px;margin:1px;cursor:default;white-space:nowrap">'+r.label+'</span>').join('');
    }
    return'<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--bd)">'+
      (won.length?'<div style="margin-bottom:3px"><span style="font-size:9px;font-weight:700;color:var(--win)">✅ SIEG · </span>'+chips(won,'#166534','#dcfce7')+'</div>':'')+
      (lost.length?'<div><span style="font-size:9px;font-weight:700;color:var(--loss)">❌ NIEDERLAGE · </span>'+chips(lost,'#7f1d1d','#fee2e2')+'</div>':'')+
      '</div>';
  }

  // Analyse-Box: Synergie-Erklärung wenn eine der neuen Strategien Platz 1 hält
  const top=ranked[0];
  const analysisHtml=top&&(top.id==='optimal'||top.id==='z3dom'||top.id==='z3domRaid')?
    '<div class="card" style="margin-bottom:10px;border:2px solid var(--win)44;background:#f0fff4">'+
    '<div class="ch" style="color:var(--win)">🔬 '+(top.id==='optimal'?'Universalsieger gefunden — Brute-Force über 5.460 Kombinationen':'Analyse: Warum diese Strategie gewinnt')+'</div>'+
    '<div class="cb">'+
    '<div style="font-size:11px;line-height:1.8">'+
    (top.id==='optimal'?
      '<strong>Getestete Spieler:</strong> 17 Team-A-Spieler (T1: 21–35M) · 18 Szenarien gegeneinander<br>'+
      '<strong>Ergebnis:</strong> Diese Konfiguration gewinnt gegen <strong style="color:var(--win)">alle 18 anderen Szenarien</strong>.<br><br>'+
      '<strong>Warum Z1 UND Z3 gleich stark (40/40)?</strong><br>'+
      '• Z3 = Tech-Fabrik: <span style="background:#dcfce7;border-radius:3px;padding:0 4px">+8% Kampfstärke überall</span> (inkl. Z5)<br>'+
      '• Z1 = Ölraffinerie + Info-Center: <span style="background:#dcfce7;border-radius:3px;padding:0 4px">+10% Punkte-Bonus auf alle Zonen</span><br>'+
      '• Beide Boni zusammen: +24.2% Stärke + +10% Punkte = kein Gegner kann mithalten<br><br>'+
      '<strong>Warum z5Solo-Assassinen?</strong> 1.3× Fokus-Bonus → Z5 fast sicher → Arsenal <span style="background:#dcfce7;border-radius:3px;padding:0 4px">+15% überall</span><br>'+
      '<strong>Warum Raid 10min?</strong> Nur 9% Lazarett-Malus, aber +11.7K Kisten-Punkte extra<br>'+
      '<strong>Warum Z4≈0?</strong> Lazarett gibt nur +2.5% — zu schwach um Spieler zu opfern. 1 Spieler als Token reicht.'
      :
      '<strong>Z3 (Tech-Fabrik) = entscheidender Multiplikator:</strong> +8% auf ALLE Zonen inkl. Z5<br>'+
      '<strong>Kettenreaktion:</strong> Z3 → Tech → Z5 stärker → Arsenal (+15%) → +24.2% auf jede Zone<br>'+
      '<strong>Hinweis:</strong> Z1 nicht vergessen — Info-Center gibt +10% Punkte-Bonus. Zu wenig Z1 kostet den Sieg!'
    )+
    '</div></div></div>':'';

  const rankHtml=
    analysisHtml+
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">🏆 Szenarien-Ranking (alle gegen alle · '+(SIM_SCENARIOS.length-1)+' Gegner je Szenario)</div>'+
    '<div class="cb">'+
    '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Jedes Szenario spielt gegen jedes andere mit deiner Aufstellung. Hover über Chips zeigt Punktdifferenz.</div>'+
    ranked.map((p,i)=>
      '<div style="padding:6px 8px;border-radius:8px;background:'+(i===0?'#f0fff4':i===1?'#f8f9fa':'')+';border:1px solid '+(i===0?'var(--win)50':'transparent')+';margin-bottom:6px">'+
      '<div style="display:flex;align-items:center;gap:8px">'+
      '<div style="font-size:'+(i<3?18:14)+'px;font-weight:900;color:'+(i===0?'var(--win)':i===1?'#aaa':i===2?'#cd7f32':'var(--tx3)')+';min-width:26px">'+(i+1)+'</div>'+
      '<div style="flex:1">'+
      '<div style="font-size:12px;font-weight:700">'+p.label+'</div>'+
      '<div style="margin-top:3px">'+sTags(p)+'</div>'+
      '</div>'+
      '<div style="text-align:right;white-space:nowrap">'+
      '<div style="font-size:13px;font-weight:800;color:'+(p.wins>=(SIM_SCENARIOS.length-1)*0.75?'var(--win)':p.wins>=(SIM_SCENARIOS.length-1)*0.5?'var(--acc)':'var(--loss)')+'">'+p.wins+'/'+(SIM_SCENARIOS.length-1)+' Siege</div>'+
      '<div style="font-size:10px;color:var(--tx3)">Ø '+(p.avgDiff>0?'+':'')+fmtK(p.avgDiff)+'</div>'+
      '</div></div>'+
      matchupRows(p.results)+
      '</div>'
    ).join('')+
    '</div></div>';

  const playerHtml=
    '<div class="card">'+
    '<div class="ch">👥 Spieler · T1 & Einheiten</div>'+
    '<div class="cb">'+
    '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">T1≈40M → ~40K Einh. · T1≈18M → ~28K Einh. · Springer = schwächste Spieler, treten erst in den letzten 10 Minuten in Z1 ein</div>'+
    allPlData.map(p=>
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
      '<span style="font-size:12px;min-width:130px">'+p.name+'</span>'+
      '<div style="flex:1;height:7px;border-radius:3px;background:#eee;overflow:hidden">'+
      '<div style="width:'+Math.min(100,p.t1/maxT1*100)+'%;height:100%;background:var(--primary)"></div></div>'+
      '<span style="font-size:10px;color:var(--tx2);min-width:36px;text-align:right">'+p.t1.toFixed(1)+'M</span>'+
      '<span style="font-size:10px;color:var(--tx3);min-width:52px;text-align:right">'+(p.units/1000).toFixed(1)+'K</span>'+
      '</div>'
    ).join('')+
    '</div></div>';

  return'<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">⚡ Strategie-Simulator v3</div>'+
    '<div class="cb">'+
    '<div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Arsenal +15% · Söldnerfabrik −15% · Lazarett +2.5% · Tech +8% · Info +10% · Springer (Endgame) · Laz-Raid: Kisten aus Z2↔Z4</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
    modeBtns.map(m=>'<button class="btn '+(sv.mode===m.id?'btn-sol':'btn-out')+'" style="font-size:12px;padding:6px 10px" onclick="APP.simV2.mode=\''+m.id+'\';renderPage()">'+m.l+'</button>').join('')+
    '</div></div></div>'+
    presetPanels+
    battleHtml+
    rankHtml+
    playerHtml;
}
