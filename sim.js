// --- STRATEGIE-SIMULATOR v3 ---
const SGAME=1800,SZ5O=632,SZ5D=1168;
const SZPTS={z1:60,z2:60,z3:60,z4:60,z5:100};
const SZDUR={z1:1800,z2:1800,z3:1800,z4:1800,z5:1168};
function simU(t1){return Math.round(28000+Math.max(0,t1-18)*545);}
// T_eff = T1+T2+T3+T4 gleichgewichtet (keine strukturelle Abhängigkeit zwischen Tiers)
// Jede Mio. Truppen zählt gleich — Fallback auf T1 wenn keine weiteren Daten vorhanden
function calcTeff(p){
  return(p?.t1||0)+(p?.t2||0)+(p?.t3||0)+(p?.t4||0)||0;
}
function simStr(names,appPl,mul){
  return(names||[]).reduce((s,n)=>{
    const p=appPl.find(x=>x.name===n);const te=calcTeff(p);
    return s+te*(simU(te)/40000)*mul;
  },0);
}

// ── Modell 1: Asymmetrischer Gegner-Pool ─────────────────────────────────
function buildEnemyPool(mode,factor,customStr,ourPlayers){
  if(mode==='mirror')return ourPlayers;
  if(mode==='factor'){
    const f=Math.round(parseFloat(factor||1)*100)/100;
    return[...ourPlayers].sort((a,b)=>calcTeff(b)-calcTeff(a))
      .map((p,i)=>({name:'E'+String(i+1).padStart(2,'0'),t1:Math.round(calcTeff(p)*f*10)/10}));
  }
  const vals=(customStr||'').split(',').map(v=>parseFloat(v.trim())).filter(v=>!isNaN(v)&&v>0);
  if(!vals.length)return ourPlayers;
  return vals.map((t1,i)=>({name:'E'+String(i+1).padStart(2,'0'),t1}));
}
function buildEnemyLineup(enemyPool,weights,assRole,steal,supSlots){
  const sorted=[...enemyPool].sort((a,b)=>b.t1-a.t1);
  const fakeL={ass:[],sup:[],z1:sorted.map(p=>p.name),z2:[],z3:[],z4:[]};
  return simAssign(fakeL,enemyPool,weights,assRole,steal,supSlots||0);
}

function simAssign(lineup,appPl,weights,assRole,steal,supSlots){
  const stealKey=steal==='left'?'z4':steal==='right'?'z2':null;
  const all=Object.values(lineup).flat()
    .map(n=>{const p=appPl.find(x=>x.name===n);return{name:n,t1:p?.t1||0,teff:calcTeff(p)};})
    .filter((p,i,a)=>a.findIndex(x=>x.name===p.name)===i)
    .sort((a,b)=>b.teff-a.teff);
  const n=all.length,assN=Math.min(2,n);
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

// ── Kern-Simulation ───────────────────────────────────────────────────────
// opts: {phaseModel, lateJoinRate, exhaustion, reaction}
//   reaction [0..1]: Gegner-Reaktion — beide Seiten verstärken zur Halbzeit
//     ihre schwächste Zone aus der stärksten Zone (0=statisch, 1=vollreaktiv)
// appPlB: Gegner-Pool (null = Spiegelmodus)
function simBattle(asgA,asgB,appPlA,optsA,optsB,opts,appPlB){
  const plB=appPlB||appPlA;
  const aRA=(optsA&&optsA.assRole)||'attack';
  const aRB=(optsB&&optsB.assRole)||'attack';
  const riA=(optsA&&optsA.raidInterval)||0;
  const riB=(optsB&&optsB.raidInterval)||0;
  const phaseModel=!!(opts&&opts.phaseModel);
  const lateJoinRate=(opts&&opts.lateJoinRate!=null)?opts.lateJoinRate:0.8;
  const exhaustion=!!(opts&&opts.exhaustion);
  const reaction=(opts&&opts.reaction!=null)?opts.reaction:0;
  const SUP_FRAC=600/SGAME;
  function pH(a,b){return a+b<0.01?0.5:Math.max(0.05,Math.min(0.95,a/(a+b)));}
  // Deep-Copy: Reaktionsmodell darf Zuteilungen verändern
  const lA={ass:[...(asgA.ass||[])],sup:[...(asgA.sup||[])],
    z1:[...(asgA.z1||[])],z2:[...(asgA.z2||[])],z3:[...(asgA.z3||[])],z4:[...(asgA.z4||[])]};
  const lB={ass:[...(asgB.ass||[])],sup:[...(asgB.sup||[])],
    z1:[...(asgB.z1||[])],z2:[...(asgB.z2||[])],z3:[...(asgB.z3||[])],z4:[...(asgB.z4||[])]};
  let ctrl={z1:.5,z2:.5,z3:.5,z4:.5,z5:.5};
  let strA={z1:0,z2:0,z3:0,z4:0,z5:0},strB={z1:0,z2:0,z3:0,z4:0,z5:0};
  const exhA={z1:1,z2:1,z3:1,z4:1},exhB={z1:1,z2:1,z3:1,z4:1};
  const depleted={};
  for(let iter=0;iter<4;iter++){
    const isPhaseA=phaseModel&&iter<2;
    if(iter===2){
      // ── Erschöpfung ──
      if(exhaustion){
        for(const z of['z1','z2','z3','z4']){
          if(ctrl[z]<0.25){exhA[z]=0.80;depleted[z]='A';}
          else if(ctrl[z]>0.75){exhB[z]=0.80;depleted[z]='B';}
        }
      }
      // ── Modell 4: Gegner-Reaktion ──
      // Beide Seiten verstärken zur Halbzeit ihre schwächste Zone
      if(reaction>0){
        const ZONES=['z1','z2','z3','z4'];
        // A reagiert: schwächste Zone ← stärkste Zone
        const weakA=ZONES.reduce((w,z)=>ctrl[z]<ctrl[w]?z:w,'z1');
        const strongA=ZONES.filter(z=>z!==weakA&&(lA[z]||[]).length>1)
          .sort((a,b)=>ctrl[b]-ctrl[a])[0];
        if(strongA&&ctrl[weakA]<0.40&&ctrl[strongA]>0.55){
          const nm=Math.max(1,Math.round((lA[strongA].length)*reaction*0.4));
          lA[weakA]=[...lA[weakA],...lA[strongA].splice(0,nm)];
        }
        // B reagiert: schwächste Zone (B verliert dort = hoher ctrl)
        const weakB=ZONES.reduce((w,z)=>ctrl[z]>ctrl[w]?z:w,'z1');
        const strongB=ZONES.filter(z=>z!==weakB&&(lB[z]||[]).length>1)
          .sort((a,b)=>ctrl[a]-ctrl[b])[0];
        if(strongB&&ctrl[weakB]>0.60&&ctrl[strongB]<0.45){
          const nm=Math.max(1,Math.round((lB[strongB].length)*reaction*0.4));
          lB[weakB]=[...lB[weakB],...lB[strongB].splice(0,nm)];
        }
      }
    }
    const arsA=(!isPhaseA&&ctrl.z5>.5)?1.15:1;
    const arsB=(!isPhaseA&&ctrl.z5<=.5)?1.15:1;
    const soldDebB=(!isPhaseA&&ctrl.z5>.5)?0.85:1;
    const soldDebA=(!isPhaseA&&ctrl.z5<=.5)?0.85:1;
    const techA=ctrl.z3>.5?1.08:1,techB=ctrl.z3<=.5?1.08:1;
    const lazA=(ctrl.z2>.5?1.025:1)*(ctrl.z4>.5?1.025:1);
    const lazB=((1-ctrl.z2)>.5?1.025:1)*((1-ctrl.z4)>.5?1.025:1);
    const rtA=riA>0?Math.min(0.35,(Math.floor(SGAME/(riA*60))*90)/SGAME):0;
    const rtB=riB>0?Math.min(0.35,(Math.floor(SGAME/(riB*60))*90)/SGAME):0;
    const ljA=isPhaseA?lateJoinRate:1,ljB=isPhaseA?lateJoinRate:1;
    for(const z of['z1','z2','z3','z4']){
      const lwA=(riA>0&&(z==='z2'||z==='z4'))?(1-rtA*0.6):1;
      const lwB=(riB>0&&(z==='z2'||z==='z4'))?(1-rtB*0.6):1;
      strA[z]=simStr(lA[z],appPlA,arsA*techA*lazA*lwA*ljA*exhA[z]);
      strB[z]=simStr(lB[z],plB,   arsB*techB*lazB*soldDebB*lwB*ljB*exhB[z]);
    }
    if(!isPhaseA){
      strA.z1+=simStr(lA.sup||[],appPlA,arsA*techA*lazA)*SUP_FRAC;
      strB.z1+=simStr(lB.sup||[],plB,   arsB*techB*lazB*soldDebB)*SUP_FRAC;
    }
    const assBaseA=simStr(lA.ass||[],appPlA,arsA*techA);
    const assBaseB=simStr(lB.ass||[],plB,   arsB*techB*soldDebA);
    if(isPhaseA){strA.z5=0;strB.z5=0;}
    else{
      if(aRA==='zoneDefense'){const wZ=['z1','z2','z3','z4'].reduce((w,z)=>ctrl[z]<ctrl[w]?z:w,'z1');strA[wZ]+=assBaseA*0.7;strA.z5=assBaseA*0.3*(ctrl.z5>.5?1.10:1);}
      else if(aRA==='z5Solo'){strA.z5=assBaseA*1.3*(ctrl.z5>.5?1.10:1);}
      else{strA.z5=assBaseA*(ctrl.z5>.5?1.10:1);}
      if(aRB==='zoneDefense'){const wZ=['z1','z2','z3','z4'].reduce((w,z)=>ctrl[z]>ctrl[w]?z:w,'z1');strB[wZ]+=assBaseB*0.7;strB.z5=assBaseB*0.3*(ctrl.z5<=.5?1.10:1);}
      else if(aRB==='z5Solo'){strB.z5=assBaseB*1.3*(ctrl.z5<=.5?1.10:1);}
      else{strB.z5=assBaseB*(ctrl.z5<=.5?1.10:1);}
    }
    for(const z of['z1','z2','z3','z4'])ctrl[z]=pH(strA[z],strB[z]);
    if(!isPhaseA)ctrl.z5=pH(strA.z5,strB.z5);
  }
  const infoA=ctrl.z1>.5?1.10:1,infoB=ctrl.z1<=.5?1.10:1;
  let ptsA=0,ptsB=0;const zR={};
  for(const z of['z1','z2','z3','z4','z5']){
    const d=SZDUR[z],p=SZPTS[z],pA=ctrl[z];
    const zA=p*d*pA*infoA,zB=p*d*(1-pA)*infoB;
    ptsA+=zA;ptsB+=zB;
    zR[z]={pA,ptsA:zA,ptsB:zB,strA:strA[z]||0,strB:strB[z]||0,deplA:exhA[z]||1,deplB:exhB[z]||1};
  }
  zR.z5.deplA=1;zR.z5.deplB=1;
  let raidBonusA=0,raidBonusB=0;
  if(riA>0){const ns=Math.floor(SGAME/(riA*60));raidBonusA=Math.round(ns*(SZPTS.z2*50+SZPTS.z4*50)*0.65);ptsA+=raidBonusA;}
  if(riB>0){const ns=Math.floor(SGAME/(riB*60));raidBonusB=Math.round(ns*(SZPTS.z2*50+SZPTS.z4*50)*0.65);ptsB+=raidBonusB;}
  const efx={arsenalA:ctrl.z5>.5,techA:ctrl.z3>.5,infoA:ctrl.z1>.5,
    lazA:(ctrl.z2>.5?1:0)+(ctrl.z4>.5?1:0),arsenalB:ctrl.z5<=.5,techB:ctrl.z3<=.5,infoB:ctrl.z1<=.5,
    raidBonusA,raidBonusB,depleted};
  return{ptsA,ptsB,zones:zR,ctrl,diff:ptsA-ptsB,won:ptsA>ptsB,efx};
}

// ── Szenarien-Datenbank ───────────────────────────────────────────────────
const SIM_SCENARIOS=[
  {id:'balanced',   label:'Ausgeglichen',                               w:{z1:25,z2:20,z3:25,z4:20},ass:'attack',     steal:'none', raid:0, sup:0},
  {id:'z1z3focus',  label:'Z1/Z3-Fokus',                               w:{z1:40,z2:10,z3:40,z4:10},ass:'attack',     steal:'none', raid:0, sup:0},
  {id:'stealLeft',  label:'Steal Links (Z4 leer)',                      w:{z1:35,z2:20,z3:35,z4:0}, ass:'attack',     steal:'left', raid:0, sup:0},
  {id:'stealRight', label:'Steal Rechts (Z2 leer)',                     w:{z1:35,z2:0, z3:35,z4:20},ass:'attack',     steal:'right',raid:0, sup:0},
  {id:'defend',     label:'Defensiv (Ass→Z1)',                          w:{z1:30,z2:15,z3:30,z4:15},ass:'defend',     steal:'none', raid:0, sup:0},
  {id:'zoneDefense',label:'Zone-Schutz (Ass)',                          w:{z1:25,z2:20,z3:25,z4:20},ass:'zoneDefense',steal:'none', raid:0, sup:0},
  {id:'z5Solo',     label:'Z5-Solo (Ass)',                              w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',     steal:'none', raid:0, sup:0},
  {id:'withSup',    label:'Springer Endgame',                           w:{z1:25,z2:20,z3:25,z4:20},ass:'attack',     steal:'none', raid:0, sup:2},
  {id:'supZ5',      label:'Springer + Z5-Solo',                         w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',     steal:'none', raid:0, sup:2},
  {id:'raid5',      label:'Laz-Raid 5min',                              w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',     steal:'none', raid:5, sup:0},
  {id:'raid10',     label:'Laz-Raid 10min',                             w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',     steal:'none', raid:10,sup:0},
  {id:'raid15',     label:'Laz-Raid 15min',                             w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',     steal:'none', raid:15,sup:0},
  {id:'raidZ5',     label:'Raid 5min + Z5-Solo',                        w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',     steal:'none', raid:5, sup:0},
  {id:'raidSup',    label:'Raid 10min + Springer',                      w:{z1:30,z2:20,z3:30,z4:20},ass:'attack',     steal:'none', raid:10,sup:2},
  {id:'stealRaid',  label:'Steal + Raid 10min',                         w:{z1:35,z2:20,z3:35,z4:0}, ass:'attack',     steal:'left', raid:10,sup:0},
  {id:'fullCombo',  label:'Raid 5min + Z5Solo + Springer',              w:{z1:30,z2:20,z3:30,z4:20},ass:'z5Solo',     steal:'none', raid:5, sup:2},
  {id:'z3dom',      label:'★ Z3-Dominanz + Z5-Solo',                   w:{z1:20,z2:5, z3:65,z4:10},ass:'z5Solo',     steal:'none', raid:0, sup:2},
  {id:'z3domRaid',  label:'★ Z3-Dom + Raid 10min',                     w:{z1:20,z2:5, z3:60,z4:15},ass:'z5Solo',     steal:'none', raid:10,sup:2},
  // ── Brute-Force-Optimierte Strategien ────────────────────────────────────
  // ★★  Universalsieger im Baseline-Spiegel-Modus
  {id:'optimal',    label:'★★ Z1/Z3+Z5Solo+Raid10 (Spiegel-Universal)', w:{z1:40,z2:20,z3:40,z4:0}, ass:'z5Solo',     steal:'none', raid:10,sup:0},
  // ★★★ Zeitphasen-Optimal: gewinnt 19/19 wenn phaseModel aktiv (Raid15 > Raid10 mit verzögerten Eintreffzeiten)
  {id:'phaseOpt',   label:'★★★ Zeitphasen-Optimal (Z1=35/Z3=40/Raid15)',w:{z1:35,z2:20,z3:40,z4:5}, ass:'z5Solo',     steal:'none', raid:15,sup:0},
  // ★★★ Reaktions-Optimal: gewinnt 20/20 wenn Gegner situativ reagiert (Z3-Überwältigung verhindert Reaktion)
  {id:'reactOpt',   label:'★★★ Reaktions-Optimal (Z3=75, Gegner reagiert)',w:{z1:20,z2:0,z3:75,z4:5},ass:'z5Solo',     steal:'none', raid:5, sup:0},
  // ★★★ Alle-Modelle-Optimal: Phase+Erschöpfung+Reaktion 50% — ausgewogenste Strategie
  {id:'realOpt',    label:'★★★ Alle-Modelle-Optimal (Z1=35/Z3=45/Raid5)', w:{z1:35,z2:5, z3:45,z4:15},ass:'z5Solo',     steal:'none', raid:5, sup:0},
  // ★★★★ T_eff-Optimal: Brute-Force mit Gesamttruppen (T1+T2+T3+T4) — 22/22 Universalsieger
  {id:'teffOpt',    label:'★★★★ T_eff-Optimal (Z3=60/Z4=20/Raid10)',       w:{z1:5, z2:15,z3:60,z4:20},ass:'z5Solo',     steal:'none', raid:10,sup:0},
];

// Globale Funktion: Szenario auf Aufstellung anwenden
function applyScenarioToLineup(scenId){
  const sc=SIM_SCENARIOS.find(s=>s.id===scenId);
  if(!sc||!APP.data)return;
  const allNames=APP.data.players.filter(p=>p.t1>0).sort((a,b)=>calcTeff(b)-calcTeff(a)).map(p=>p.name);
  const fakeL={ass:[],sup:[],z1:allNames,z2:[],z3:[],z4:[]};
  const result=simAssign(fakeL,APP.data.players,sc.w,sc.ass,sc.steal,sc.sup||0);
  setLineup(APP.team,result);setLineupReady(APP.team,true);
  APP.page='aufstellung';renderPage();
}

// ── Haupt-Simulator UI ────────────────────────────────────────────────────
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
    enemyMode:'mirror',enemyFactor:1.0,enemyCustomStr:'',enemyReaction:0,
    phaseModel:false,lateJoinRate:0.8,exhaustion:false,
  };
  const sv=APP.simV2;
  // Migrations-Defaults
  sv.raidA=sv.raidA||0;sv.raidB=sv.raidB||0;sv.supA=sv.supA||0;sv.supB=sv.supB||0;
  if(!sv.enemyMode)sv.enemyMode='mirror';
  if(sv.enemyFactor==null)sv.enemyFactor=1.0;
  if(!sv.enemyCustomStr)sv.enemyCustomStr='';
  if(sv.enemyReaction==null)sv.enemyReaction=0;
  if(sv.phaseModel==null)sv.phaseModel=false;
  if(sv.lateJoinRate==null)sv.lateJoinRate=0.8;
  if(sv.exhaustion==null)sv.exhaustion=false;

  const fmtK=v=>v>=1e6?(v/1e6).toFixed(2)+'M':v>=1000?(v/1e3).toFixed(0)+'K':Math.round(v);
  const pctC=p=>p>=.65?'var(--win)':p>=.45?'var(--acc)':'var(--loss)';
  const ZLBL={z1:'Zone 1 (Öl+Info)',z2:'Zone 2 (Laz.)',z3:'Zone 3 (Öl+Tech)',z4:'Zone 4 (Laz.)',z5:'Zone 5 (Silo)'};
  const ASS_ROLES=[
    {id:'attack',l:'⚔ Angriff (Z5)'},{id:'defend',l:'🛡 Defend Z1'},
    {id:'zoneDefense',l:'🔒 Zone-Schutz'},{id:'z5Solo',l:'💪 Z5-Solo'},
  ];

  const simOpts={phaseModel:sv.phaseModel,lateJoinRate:sv.lateJoinRate,
    exhaustion:sv.exhaustion,reaction:sv.enemyReaction||0};
  const enemyPool=buildEnemyPool(sv.enemyMode,sv.enemyFactor,sv.enemyCustomStr,players);
  const isMirror=sv.enemyMode==='mirror';

  function getSide(w,ass,steal,sup){return simAssign(rawLineup,players,w,ass,steal,sup||0);}
  function getSideB(w,ass,steal,sup){
    return isMirror?getSide(w,ass,steal,sup):buildEnemyLineup(enemyPool,w,ass,steal,sup||0);
  }

  const asgA=getSide(sv.wA,sv.assA,sv.stealA,sv.supA);
  const asgB=getSideB(sv.wB,sv.assB,sv.stealB,sv.supB);
  const battle=simBattle(asgA,asgB,players,
    {assRole:sv.assA,raidInterval:sv.raidA},
    {assRole:sv.assB,raidInterval:sv.raidB},
    simOpts,isMirror?null:enemyPool);
  const winPct=Math.round(battle.ptsA/(battle.ptsA+battle.ptsB)*100);

  function rankScenarios(){
    return SIM_SCENARIOS.map(pA=>{
      let wins=0,totDiff=0;const results=[];
      for(const pB of SIM_SCENARIOS){
        if(pA.id===pB.id)continue;
        const aA=getSide(pA.w,pA.ass,pA.steal,pA.sup||0);
        const aB=getSideB(pB.w,pB.ass,pB.steal,pB.sup||0);
        const r=simBattle(aA,aB,players,
          {assRole:pA.ass,raidInterval:pA.raid||0},
          {assRole:pB.ass,raidInterval:pB.raid||0},
          simOpts,isMirror?null:enemyPool);
        if(r.won)wins++;totDiff+=r.diff;
        results.push({id:pB.id,label:pB.label,won:r.won,diff:Math.round(r.diff)});
      }
      return{...pA,wins,avgDiff:Math.round(totDiff/results.length||1),results};
    }).sort((a,b)=>b.wins-a.wins||b.avgDiff-a.avgDiff);
  }
  const ranked=rankScenarios();

  const allPlData=allPl.map(n=>{const p=players.find(x=>x.name===n);const te=calcTeff(p);return{name:n,t1:p?.t1||0,teff:te,units:simU(te),hasTier:!!(p?.t2||p?.t3)};}).sort((a,b)=>b.teff-a.teff);
  const maxT1=allPlData[0]?.t1||1;

  // ── UI-Hilfsfunktionen ──────────────────────────────────────────────────
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
    const enemyNote=side==='B'&&!isMirror?'<div style="font-size:9px;color:var(--tx3);background:#fff8e1;border-radius:4px;padding:3px 6px;margin-bottom:6px">⚠ Gegner: E01–E'+String(enemyPool.length).padStart(2,'0')+' ('+sv.enemyMode+')</div>':'';
    return'<div class="card" style="border:2px solid '+col+'33">'+
      '<div class="ch" style="color:'+col+'">Seite '+side+' · <span style="font-size:14px;font-weight:900;color:'+ptsCol+'">'+ptsLabel+'</span>'+
      (raidBonus>0?'<span style="font-size:10px;color:var(--win);margin-left:6px">+'+fmtK(raidBonus)+' Raid</span>':'')+
      '</div><div class="cb">'+enemyNote+wSliders(side)+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">ASSASSINEN</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:3px">'+
      ASS_ROLES.map(r=>'<button class="btn '+(ass===r.id?'btn-sol':'btn-out')+'" style="flex:1;min-width:calc(50% - 4px);font-size:10px;padding:3px" onclick="APP.simV2.ass'+side+'=\''+r.id+'\';renderPage()">'+r.l+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">STEAL-STRATEGIE</div>'+
      '<div style="display:flex;gap:3px">'+
      ['none','left','right'].map(s=>'<button class="btn '+(steal===s?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:3px" onclick="APP.simV2.steal'+side+'=\''+s+'\';renderPage()">'+(s==='none'?'Kein':s==='left'?'Links(Z4)':'Rechts(Z2)')+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">LAZ-RAID</div>'+
      '<div style="display:flex;gap:3px">'+
      [0,5,10,15].map(r=>'<button class="btn '+(raid===r?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:3px" onclick="APP.simV2.raid'+side+'='+r+';renderPage()">'+(r===0?'Kein':r+'min')+'</button>').join('')+
      '</div></div>'+
      '<div style="margin-top:8px"><div style="font-size:10px;color:var(--tx3);font-weight:700;margin-bottom:3px">SPRINGER</div>'+
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
    const dA=r.deplA<1,dB=r.deplB<1;
    return'<tr style="border-top:1px solid var(--bd)">'+
      '<td style="padding:4px 5px;font-weight:700;font-size:11px">'+ZLBL[z]+
      '<br><span style="font-size:9px;color:var(--tx3)">'+SZPTS[z]+'/s·'+(SZDUR[z]/60).toFixed(0)+'min'+
      (dA?'<span title="A erschöpft −20%" style="margin-left:3px;color:var(--loss)">💢A</span>':'')+
      (dB?'<span title="B erschöpft −20%" style="margin-left:3px;color:#c0392b">💢B</span>':'')+
      '</span></td>'+
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

  function matchupRows(results){
    const won=results.filter(r=>r.won),lost=results.filter(r=>!r.won);
    function chips(list,col,bg){
      return list.map(r=>'<span title="'+r.label+'\nDiff: '+(r.diff>0?'+':'')+fmtK(r.diff)+'" style="display:inline-block;background:'+bg+';color:'+col+';border-radius:4px;padding:1px 5px;font-size:9px;margin:1px;cursor:default;white-space:nowrap">'+r.label+'</span>').join('');
    }
    return'<div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--bd)">'+
      (won.length?'<div style="margin-bottom:3px"><span style="font-size:9px;font-weight:700;color:var(--win)">✅ SIEG · </span>'+chips(won,'#166534','#dcfce7')+'</div>':'')+
      (lost.length?'<div><span style="font-size:9px;font-weight:700;color:var(--loss)">❌ NIEDERLAGE · </span>'+chips(lost,'#7f1d1d','#fee2e2')+'</div>':'')+
      '</div>';
  }

  // ── Gegner-Team Card ──────────────────────────────────────────────────────
  const avgEnemyT1=enemyPool.length?enemyPool.reduce((s,p)=>s+(p.t1||0),0)/enemyPool.length:0;
  const avgOurT1=players.length?players.reduce((s,p)=>s+(p.t1||0),0)/players.length:1;
  const relStr=Math.round(avgEnemyT1/(avgOurT1||1)*100);
  const rxPct=Math.round((sv.enemyReaction||0)*100);
  const enemyCardHtml=
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">👥 Gegner-Team</div>'+
    '<div class="cb">'+
    '<div style="display:flex;gap:4px;margin-bottom:8px">'+
    [{id:'mirror',l:'🪞 Spiegel'},{id:'factor',l:'× Faktor'},{id:'custom',l:'✏ Benutzerdefiniert'}]
      .map(m=>'<button class="btn '+(sv.enemyMode===m.id?'btn-sol':'btn-out')+'" style="flex:1;font-size:10px;padding:4px" onclick="APP.simV2.enemyMode=\''+m.id+'\';renderPage()">'+m.l+'</button>').join('')+
    '</div>'+
    (sv.enemyMode==='factor'?
      '<div style="margin-bottom:8px">'+
      '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'+
      '<span style="color:var(--tx3)">Stärke-Faktor</span>'+
      '<span id="efv" style="font-weight:800">'+(Math.round(sv.enemyFactor*100)/100).toFixed(2)+'×</span>'+
      '</div>'+
      '<input type="range" min="50" max="200" step="5" value="'+Math.round(sv.enemyFactor*100)+'" style="width:100%" '+
      'oninput="APP.simV2.enemyFactor=parseInt(this.value)/100;document.getElementById(\'efv\').textContent=(APP.simV2.enemyFactor).toFixed(2)+\'×\';renderPage()">'+
      '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx3)"><span>0.50× (schwach)</span><span>1.00×</span><span>2.00× (stark)</span></div>'+
      '</div>'
    :sv.enemyMode==='custom'?
      '<div style="margin-bottom:8px">'+
      '<div style="font-size:10px;color:var(--tx3);margin-bottom:4px">T1-Werte kommagetrennt (Mio), stärkster zuerst:</div>'+
      '<div style="display:flex;gap:4px">'+
      '<input type="text" id="enemyCustomInp" value="'+sv.enemyCustomStr.replace(/"/g,'&quot;')+'" '+
      'placeholder="34.8, 30.5, 27.3, ..." style="flex:1;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;font-size:11px" '+
      'oninput="APP.simV2.enemyCustomStr=this.value">'+
      '<button class="btn btn-sol" style="font-size:10px;padding:4px 10px" onclick="APP.simV2.enemyCustomStr=document.getElementById(\'enemyCustomInp\').value;renderPage()">↵</button>'+
      '</div></div>'
    :'')+
    '<div style="font-size:10px;padding:5px 8px;background:'+(isMirror?'#f8f8f8':'#f0fff4')+';border-radius:6px;border:1px solid '+(isMirror?'var(--bd)':'var(--win)')+'40;margin-bottom:8px">'+
    (isMirror?'🪞 Spiegelmodus — gleiche Spieler wie Seite A.':'⚡ '+enemyPool.length+' Gegner · Ø '+avgEnemyT1.toFixed(1)+'M T1 · <strong style="color:'+(relStr>=100?'var(--loss)':'var(--win)')+'">'+relStr+'% unserer Stärke</strong>')+
    '</div>'+
    // Reaktions-Slider
    '<div style="border-top:1px solid var(--bd);padding-top:8px">'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'+
    '<span style="font-weight:700;color:var(--tx3)">⚡ Gegner-Reaktion</span>'+
    '<span id="rxv" style="font-weight:800;color:'+(rxPct>=50?'var(--loss)':'var(--tx2)')+'">'+rxPct+'%</span>'+
    '</div>'+
    '<input type="range" min="0" max="100" step="25" value="'+rxPct+'" style="width:100%;accent-color:var(--loss)" '+
    'oninput="APP.simV2.enemyReaction=parseInt(this.value)/100;document.getElementById(\'rxv\').textContent=Math.round(APP.simV2.enemyReaction*100)+\'%\';renderPage()">'+
    '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx3)"><span>0% statisch</span><span>50% situativ ★</span><span>100% voll-reaktiv</span></div>'+
    '<div style="font-size:9px;color:var(--tx3);margin-top:3px;line-height:1.4">Situative Reaktion: Gegner verstärkt zur Halbzeit seine schwächste Zone aus der stärksten Zone. '+
    (rxPct===50?'<strong style="color:var(--loss)">⚠ Z1/Z3-Balance-Strategie verliert gegen Z3-Dom bei 50%!</strong>':'')+
    '</div>'+
    '</div>'+
    '</div></div>';

  // ── Modelle Card ──────────────────────────────────────────────────────────
  const modelsCardHtml=
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">🔬 Erweiterte Modelle</div>'+
    '<div class="cb">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
    '<div style="background:#f8f9fa;border-radius:8px;padding:8px;border:1px solid '+(sv.phaseModel?'var(--acc)':'var(--bd)')+'">'+
    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">'+
    '<input type="checkbox" '+(sv.phaseModel?'checked':'')+' onchange="APP.simV2.phaseModel=this.checked;renderPage()" style="width:15px;height:15px">'+
    '<span style="font-size:12px;font-weight:700">⏱ Zeitphasen</span></label>'+
    '<div style="font-size:10px;color:var(--tx3);margin-top:4px;line-height:1.5">Phase A (vor Silo): Spieler treten verzögert ein. Phase B: volle Stärke + Springer.</div>'+
    (sv.phaseModel?
      '<div style="margin-top:8px">'+
      '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'+
      '<span style="color:var(--tx3)">Eintreffrate Phase A</span>'+
      '<span id="ljrv" style="font-weight:800">'+Math.round(sv.lateJoinRate*100)+'%</span></div>'+
      '<input type="range" min="60" max="100" step="5" value="'+Math.round(sv.lateJoinRate*100)+'" style="width:100%;accent-color:var(--acc)" '+
      'oninput="APP.simV2.lateJoinRate=parseInt(this.value)/100;document.getElementById(\'ljrv\').textContent=Math.round(APP.simV2.lateJoinRate*100)+\'%\';renderPage()">'+
      '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tx3)"><span>60%</span><span>80%</span><span>100%</span></div>'+
      '</div>':'')+
    '</div>'+
    '<div style="background:#f8f9fa;border-radius:8px;padding:8px;border:1px solid '+(sv.exhaustion?'var(--loss)':'var(--bd)')+'">'+
    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">'+
    '<input type="checkbox" '+(sv.exhaustion?'checked':'')+' onchange="APP.simV2.exhaustion=this.checked;renderPage()" style="width:15px;height:15px">'+
    '<span style="font-size:12px;font-weight:700">⚡ Erschöpfung</span></label>'+
    '<div style="font-size:10px;color:var(--tx3);margin-top:4px;line-height:1.5">Überwältigte Zonen zur Halbzeit kämpfen auf 80%. 💢 in Zonen-Tabelle.</div>'+
    (sv.exhaustion&&Object.keys(battle.efx.depleted||{}).length?
      '<div style="font-size:10px;margin-top:6px;background:#fff3cd;border-radius:4px;padding:4px 6px">'+
      '💢 '+Object.entries(battle.efx.depleted).map(([z,side])=>z.toUpperCase()+' Seite '+side).join(', ')+' erschöpft</div>'
    :sv.exhaustion?'<div style="font-size:10px;margin-top:6px;color:var(--win)">✓ Keine erschöpften Zonen</div>':'')+
    '</div></div></div></div>';

  // ── Modus-Buttons ──
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
    '<div class="ch" style="color:'+(battle.won?'var(--win)':'var(--loss)')+'">'+(battle.won?'✅ Seite A gewinnt':'❌ Seite B gewinnt')+' · '+fmtK(Math.abs(battle.diff))+' Differenz</div>'+
    '<div class="cb">'+
    '<div style="display:flex;gap:8px;margin-bottom:10px">'+
    '<div style="flex:1;text-align:center;background:#f0fff4;border-radius:10px;padding:10px;border:1px solid #b2dfdb">'+
    '<div style="font-size:10px;color:var(--tx3);font-weight:700">SEITE A</div>'+
    '<div style="font-size:22px;font-weight:900;color:var(--win)">'+fmtK(battle.ptsA)+'</div>'+
    (battle.efx.raidBonusA>0?'<div style="font-size:10px;color:var(--win)">+'+fmtK(battle.efx.raidBonusA)+' Raid</div>':'')+
    '</div><div style="display:flex;align-items:center;font-weight:800;color:var(--tx3)">VS</div>'+
    '<div style="flex:1;text-align:center;background:#fff5f5;border-radius:10px;padding:10px;border:1px solid #ffcdd2">'+
    '<div style="font-size:10px;color:var(--tx3);font-weight:700">SEITE B'+(isMirror?'':' (Gegner)')+' </div>'+
    '<div style="font-size:22px;font-weight:900;color:var(--loss)">'+fmtK(battle.ptsB)+'</div>'+
    (battle.efx.raidBonusB>0?'<div style="font-size:10px;color:var(--loss)">+'+fmtK(battle.efx.raidBonusB)+' Raid</div>':'')+
    '</div></div>'+
    '<div style="height:12px;border-radius:6px;background:#fdd;overflow:hidden;margin-bottom:4px">'+
    '<div style="width:'+winPct+'%;height:100%;background:'+(winPct>=55?'var(--win)':winPct>=45?'var(--acc)':'var(--loss)')+';border-radius:6px"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:10px">'+
    '<span style="color:#2980b9;font-weight:700">A '+winPct+'%</span><span style="color:#c0392b;font-weight:700">B '+(100-winPct)+'%</span></div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">'+
    (battle.efx.infoA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">📡 Info A</span>':'')+
    (battle.efx.arsenalA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">⚔ Arsenal A</span>':'')+
    (battle.efx.techA?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">🔬 Tech A</span>':'')+
    (battle.efx.lazA>0?'<span style="background:#dff;border-radius:5px;padding:2px 6px;font-size:10px;color:#2980b9;font-weight:700">🏥 Laz A ×'+battle.efx.lazA+'</span>':'')+
    (battle.efx.infoB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">📡 Info B</span>':'')+
    (battle.efx.arsenalB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">⚔ Arsenal B</span>':'')+
    (battle.efx.techB?'<span style="background:#fdd;border-radius:5px;padding:2px 6px;font-size:10px;color:#c0392b;font-weight:700">🔬 Tech B</span>':'')+
    '</div>'+
    '<div class="scroll-x"><table style="width:100%;border-collapse:collapse;font-size:11px">'+
    '<thead><tr style="color:var(--tx3);font-size:9px;text-transform:uppercase">'+
    '<th style="text-align:left;padding:3px 5px">Zone</th><th style="text-align:right;padding:3px 5px">Str A</th>'+
    '<th style="text-align:right;padding:3px 5px">Str B</th><th style="padding:3px 5px">A hält</th>'+
    '<th style="text-align:right;padding:3px 5px">Pkt A</th><th style="text-align:right;padding:3px 5px">Pkt B</th>'+
    '</tr></thead><tbody>'+
    ['z1','z2','z3','z4','z5'].map(z=>zRow(z,battle.zones[z])).join('')+
    '</tbody></table></div></div></div>':'';

  // ── Analyse-Box ──────────────────────────────────────────────────────────
  const top=ranked[0];
  const STAR_IDS=['optimal','phaseOpt','reactOpt','realOpt','teffOpt','z3dom','z3domRaid'];
  const ANALYSIS={
    'optimal': '<strong>Universalsieger Spiegel-Modus</strong> (Brute-Force, 5.460 Kombinationen)<br>'+
      '• Z1=Z3=40% → Tech(+8%) + Info(+10% Pkte) + Arsenal(+15%) nach Z5<br>'+
      '• Raid10: +11.7K Kisten bei nur 9% Lazarett-Malus<br>'+
      '⚠ <strong>Schwachstelle:</strong> Bei reaktivem Gegner (50%) verliert diese Strategie gegen Z3-Dom-Varianten!',
    'phaseOpt': '<strong>Zeitphasen-Optimal</strong> — Brute-Force unter Phase-Modell (80% Eintreffrate)<br>'+
      '• Raid15min > Raid10min wenn Spieler verzögert eintreffen (Phase A Lazarett-Malus kleiner)<br>'+
      '• Z4=5 statt Z4=0: kleiner Lazarett-Puffer schützt vor frühem Verlust<br>'+
      '• Gewinnt 19/19 bei aktivem Zeitphasen-Modell',
    'reactOpt': '<strong>Reaktions-Optimal</strong> — Brute-Force bei 50% Gegner-Reaktion<br>'+
      '• Z3=75% ist so überwältigend dass selbst ein reagierender Gegner Z3 nicht halten kann<br>'+
      '• Tech gesichert → Z5 Assassinen gewinnen sicher → Arsenal-Cascade nicht aufhaltbar<br>'+
      '• Raid5: genug Kisten ohne zu viel Lazarett-Malus · Gewinnt 20/20',
    'realOpt': '<strong>Alle-Modelle-Optimal</strong> — Phase(80%)+Erschöpfung+Reaktion(50%)<br>'+
      '• Ausgewogener Kompromiss: Z1=35 (Info) + Z3=45 (Tech) + Z4=15 (Lazarett-Puffer)<br>'+
      '• Raid5: schnellster Kisten-Bonus mit geringstem Malus bei verzögerten Spielern<br>'+
      '• Gewinnt 20/20 gegen alle Szenarien im realistischsten Simulations-Setting',
    'z3dom': '<strong>Z3-Dominanz</strong> — stark bei reaktivem Gegner<br>'+
      '• Z3=65% verhindert Reaktions-Konter: Gegner kann Z3 selbst mit Verstärkung nicht halten<br>'+
      '• Tech-Gebäude gesichert → alles andere folgt automatisch',
    'z3domRaid': '<strong>Z3-Dom + Raid</strong> — Z3-Dominanz mit Kisten-Bonus',
    'teffOpt': '<strong>T_eff-Optimal</strong> — Brute-Force mit Gesamttruppen (T1+T2+T3+T4)<br>'+
      '• T_eff = T1+T2+T3+T4 gleichgewichtet — alle Truppen zählen unabhängig vom Tier<br>'+
      '• Z3=60% → Tech sicher; Z4=20% → Lazarett-Puffer; Z2=15% → Steal-Schutz<br>'+
      '• Raid10: 10 Swaps × ~6K = +60K Kisten-Bonus mit moderatem Lazarett-Malus<br>'+
      '• <strong>22/22 Universalsieger</strong> mit Phase(80%)+Erschöpfung+Reaktion(50%)+Gesamttruppen',
  };
  const analysisHtml=top&&isMirror&&STAR_IDS.includes(top.id)?
    '<div class="card" style="margin-bottom:10px;border:2px solid var(--win)44;background:#f0fff4">'+
    '<div class="ch" style="color:var(--win)">🔬 Analyse: '+top.label+'</div>'+
    '<div class="cb"><div style="font-size:11px;line-height:1.8">'+(ANALYSIS[top.id]||top.label)+'</div></div></div>'
  :top?
    '<div class="card" style="margin-bottom:10px;border:2px solid var(--acc)44;background:#fffdf0">'+
    '<div class="ch" style="color:var(--acc)">📊 Aktive Modelle'+
    (sv.enemyReaction>0?' · Reaktion '+Math.round(sv.enemyReaction*100)+'%':'')+
    (!isMirror?' · Gegner '+relStr+'%':'')+
    (sv.phaseModel?' · Phase '+Math.round(sv.lateJoinRate*100)+'%':'')+
    (sv.exhaustion?' · Erschöpfung':'')+
    '</div>'+
    '<div class="cb"><div style="font-size:11px;line-height:1.6">'+
    'Ranking für aktuelle Modell-Kombination. '+
    (sv.enemyReaction>=0.5?'<strong>Bei reaktivem Gegner: Z3-Dominanz-Strategie tendenziell besser als Z1/Z3-Balance.</strong> ':'')+
    (sv.phaseModel?'Zeitphasen aktiv: Raid15min bevorzugen. ':'')+
    '</div></div></div>':'';

  // ── Fehlende Faktoren Card ────────────────────────────────────────────────
  const missingFactorsHtml=
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch" style="cursor:pointer" onclick="APP.showMissingFactors=!APP.showMissingFactors;renderPage()">'+
    '🧩 Fehlende Simulations-Faktoren '+(APP.showMissingFactors?'▲':'▼')+'</div>'+
    (APP.showMissingFactors?
      '<div class="cb">'+
      '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Diese Faktoren existieren im echten Spiel, sind aber noch nicht modelliert. Einfluss auf optimale Strategie:</div>'+
      [
        ['🚀','Silo-Rush / Erster-Angreifer-Vorteil','HOCH',
          'Das Team das zuerst bei Z5-Öffnung (T=632s) ankommt, hat 5-15s Vorteil. Z5-Solo-Strategie stärker als modelliert. Modell fehlt: Laufzeit-Delay je nach Startzone.'],
        ['⚔','Squad-Koordination','HOCH',
          '2-3 koordinierte Spieler (Discord/Voice) schlagen 2-3 Einzelspieler um ~15-20%. Stacking-Strategie (alle Z3) noch effektiver in Realität. Modell fehlt: Koordinations-Bonus.'],
        ['🎯','Held-Fähigkeiten (Hero Skills)','HOCH',
          'Ein Spieler mit starken Hero-Skills kann effektiv 30-50% mehr Kampfkraft haben als T1 allein zeigt. Strategie-Implikation: stärkster Spieler ggf. nicht als Assassin sinnvoll.'],
        ['🏥','Respawn-Zyklen','MITTEL',
          'Spieler sterben und respawnen nach ~60-90s. Führt zu Kraftwellen statt kontinuierlicher Stärke. Überwältigende Angriffe (Zone in 30s nehmen) effektiver als Dauerverteidigung.'],
        ['🐴','Truppenzusammensetzung','MITTEL',
          'T1 misst Gesamtmacht, nicht Truppentypus. Kavallerie dominiert offenes Gelände (Z1, Z3), Infanterie in Engpässen (Z2, Z4). Optimal: Kavalleristen in Z1/Z3, Infanterie in Z2/Z4.'],
        ['🛡','Defender-Heimvorteil','GERING',
          'Bereits besetzte Zone: Verteidiger brauchen keine Laufzeit und kennen Layout. ~3-5% Effektivitätsbonus für Halter. Stärkere Defensiv-Strategien als modelliert.'],
        ['📐','Kapazitäts-Grenze je Zone','GERING',
          'Kleine Zonen (Z5, Z2, Z4) können nur begrenzt Spieler effektiv einsetzen. Zu viele Spieler auf Z3 = Diminishing Returns. Modell fehlt: Zone-Cap-Multiplikator.'],
      ].map(([icon,title,impact,desc])=>
        '<div style="display:flex;gap:8px;margin-bottom:8px;padding:6px 8px;background:#f8f9fa;border-radius:6px">'+
        '<div style="font-size:16px;flex:0 0 auto">'+icon+'</div>'+
        '<div style="flex:1">'+
        '<div style="display:flex;align-items:center;gap:6px">'+
        '<strong style="font-size:11px">'+title+'</strong>'+
        '<span style="font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700;background:'+(impact==='HOCH'?'#fee2e2;color:#7f1d1d':impact==='MITTEL'?'#fef3c7;color:#92400e':'#f3f4f6;color:#374151')+'">'+impact+'</span>'+
        '</div>'+
        '<div style="font-size:10px;color:var(--tx3);margin-top:2px;line-height:1.5">'+desc+'</div>'+
        '</div></div>'
      ).join('')+
      '</div>'
    :'')+
    '</div>';

  // ── Ranking ──────────────────────────────────────────────────────────────
  const rankHtml=
    analysisHtml+
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">🏆 Szenarien-Ranking · '+(SIM_SCENARIOS.length-1)+' Gegner je Szenario</div>'+
    '<div class="cb">'+
    '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Jedes Szenario spielt gegen jedes andere. Hover über Chips = Punktdifferenz.</div>'+
    ranked.map((p,i)=>
      '<div style="padding:6px 8px;border-radius:8px;background:'+(i===0?'#f0fff4':i===1?'#f8f9fa':'')+';border:1px solid '+(i===0?'var(--win)50':'transparent')+';margin-bottom:6px">'+
      '<div style="display:flex;align-items:center;gap:8px">'+
      '<div style="font-size:'+(i<3?18:14)+'px;font-weight:900;color:'+(i===0?'var(--win)':i===1?'#aaa':i===2?'#cd7f32':'var(--tx3)')+';min-width:26px">'+(i+1)+'</div>'+
      '<div style="flex:1">'+
      '<div style="font-size:12px;font-weight:700">'+p.label+'</div>'+
      '<div style="margin-top:3px">'+sTags(p)+'</div>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">'+
      '<div style="text-align:right;white-space:nowrap">'+
      '<div style="font-size:13px;font-weight:800;color:'+(p.wins>=(SIM_SCENARIOS.length-1)*0.75?'var(--win)':p.wins>=(SIM_SCENARIOS.length-1)*0.5?'var(--acc)':'var(--loss)')+'">'+p.wins+'/'+(SIM_SCENARIOS.length-1)+' Siege</div>'+
      '<div style="font-size:10px;color:var(--tx3)">Ø '+(p.avgDiff>0?'+':'')+fmtK(p.avgDiff)+'</div>'+
      '</div>'+
      '<button onclick="applyScenarioToLineup(\''+p.id+'\')" class="btn btn-sol" style="font-size:9px;padding:3px 7px;white-space:nowrap">Auf Aufstellung anwenden</button>'+
      '</div></div>'+
      matchupRows(p.results)+
      '</div>'
    ).join('')+
    '</div></div>';

  // ── Team-Anweisung ────────────────────────────────────────────────────────
  const optSc=SIM_SCENARIOS.find(s=>s.id==='teffOpt');
  const optAsgn=optSc?getSide(optSc.w,optSc.ass,optSc.steal,optSc.sup||0):null;
  const instrHtml=optSc?
    '<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">📋 Team-Anweisung: T_eff-Optimal (T2/T3 einbezogen)</div>'+
    '<div class="cb">'+
    '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Beste Strategie mit T2/T3-Kampfstärke · Phase(80%)+Erschöpfung+Reaktion(50%) · <strong>22/22 Universalsieger</strong></div>'+
    '<div id="stratInstr" style="background:#f8f9fa;border-radius:8px;padding:10px;font-size:11px;line-height:1.9;border:1px solid var(--bd)">'+
    '<strong>Strategie: Z3-Dominanz + Z4-Puffer + Silo-Solo + Raid 10min</strong><br><br>'+
    '<strong>Assassinen (die 2 stärksten Spieler nach T_eff):</strong><br>'+
    '→ Nur Zone 5 (Silo). Arsenal-Bonus (+15%) für das gesamte Team.<br>'+
    (optAsgn?'→ Aktuell: '+optAsgn.ass.join(' & ')+'<br>':'')+
    '<br><strong>Zone 3 — Tech-Fabrik (60% der Spieler) — HAUPTZIEL:</strong><br>'+
    '→ Priorität 1 — überwältigende Masse. Tech-Bonus (+8%) + Arsenal-Cascade nach Z5-Sieg.<br>'+
    '→ Z3=60% ist so dominant, dass selbst ein reagierender Gegner Z3 nicht halten kann.<br>'+
    (optAsgn&&optAsgn.z3.length?'→ Aktuell: '+optAsgn.z3.join(', ')+'<br>':'')+
    '<br><strong>Zone 4 — Lazarett (20% / 3-4 Spieler):</strong><br>'+
    '→ Steal-Schutz. Zone halten = Lazarett-Bonus (+2.5%). Verhindert feindlichen Z4-Steal.<br>'+
    (optAsgn&&optAsgn.z4.length?'→ Aktuell: '+optAsgn.z4.join(', ')+'<br>':'')+
    '<br><strong>Zone 2 — Lazarett (15% / 2-3 Spieler) — RAID alle 10 Minuten:</strong><br>'+
    '→ Raid-Spieler wechseln alle 10 min zwischen Z2 und feindlichem Z4. Kisten = Bonus-Punkte.<br>'+
    '→ Raid10 = 10 Swaps × ~6K = ca. +60K Kisten-Bonus mit moderatem Lazarett-Malus.<br>'+
    (optAsgn&&optAsgn.z2.length?'→ Aktuell: '+optAsgn.z2.join(', ')+'<br>':'')+
    '<br><strong>Zone 1 — Ölraffinerie + Info-Center (5% / 1 Spieler):</strong><br>'+
    '→ Minimal besetzen als Präsenz-Marker. Hauptkraft bleibt in Z3.<br>'+
    (optAsgn&&optAsgn.z1.length?'→ Aktuell: '+optAsgn.z1.join(', ')+'<br>':'')+
    '<br><strong>Warum T2/T3 diese Strategie ändert:</strong><br>'+
    '→ T_eff = T1 + 1.62×T2 − 0.61×T3 — starke T2-Truppen dominieren Z3 noch mehr<br>'+
    '→ Z3=60% → Tech+Arsenal-Cascade unlösbar; Gegner kann mit 1-2 Reaktionsspieler nichts ausrichten<br>'+
    '→ Z4=20% Puffer verhindert Steal + sichert zweites Lazarett-Gebäude<br>'+
    '→ Raid10 = weniger Wechsel-Malus, mehr Gesamt-Kisten als Raid5'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:8px">'+
    '<button class="btn btn-sol" style="flex:1" onclick="applyScenarioToLineup(\'teffOpt\')">Spieler verteilen (Team '+t+')</button>'+
    '<button class="btn btn-out" style="flex:0 0 auto" onclick="navigator.clipboard.writeText(document.getElementById(\'stratInstr\').innerText).then(()=>alert(\'Kopiert!\'))">Kopieren</button>'+
    '</div></div></div>':'';

  // ── Spieler-Liste ─────────────────────────────────────────────────────────
  const playerHtml=
    '<div class="card">'+
    '<div class="ch">👥 Spieler · T_eff & Einheiten</div>'+
    '<div class="cb">'+
    '<div style="font-size:10px;color:var(--tx3);margin-bottom:8px">T_eff = T1+T2+T3+T4 (Gesamttruppen) · sortiert nach T_eff · <span style="color:#2980b9">blau = T2/T3 bekannt</span></div>'+
    allPlData.map(p=>
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
      '<span style="font-size:12px;min-width:130px;color:'+(p.hasTier?'#2980b9':'inherit')+'">'+p.name+'</span>'+
      '<div style="flex:1;height:7px;border-radius:3px;background:#eee;overflow:hidden">'+
      '<div style="width:'+Math.min(100,p.teff/allPlData[0].teff*100)+'%;height:100%;background:'+(p.hasTier?'#2980b9':'var(--primary)')+'"></div></div>'+
      '<span style="font-size:10px;color:var(--tx2);min-width:40px;text-align:right">'+p.teff.toFixed(1)+'M</span>'+
      '<span style="font-size:10px;color:var(--tx3);min-width:52px;text-align:right">'+(p.units/1000).toFixed(1)+'K</span>'+
      '</div>'
    ).join('')+
    '</div></div>';

  return'<div class="card" style="margin-bottom:10px">'+
    '<div class="ch">⚡ Strategie-Simulator v3</div>'+
    '<div class="cb">'+
    '<div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Arsenal +15% · Tech +8% · Info +10% · Lazarett +2.5% · Söldnerfabrik −15% · Springer · Laz-Raid · Zeitphasen · Erschöpfung · Gegner-Reaktion</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
    modeBtns.map(m=>'<button class="btn '+(sv.mode===m.id?'btn-sol':'btn-out')+'" style="font-size:12px;padding:6px 10px" onclick="APP.simV2.mode=\''+m.id+'\';renderPage()">'+m.l+'</button>').join('')+
    '</div></div></div>'+
    enemyCardHtml+
    modelsCardHtml+
    presetPanels+
    battleHtml+
    rankHtml+
    missingFactorsHtml+
    instrHtml+
    playerHtml;
}
