// ══════════════════════════════════════════════════════
//  Gebäude-Strategie Vergleich — 2-Phasen-Modell
//  Phase 1 (0–632s):   Alle Spieler in Außenzonen (Zentrum gesperrt)
//  Phase 2 (632–1800s): Spieler wechseln ins Zentrum, Zonen werden schwächer
//  Stand: 19.04.2026 — echte Team-A-Spieler aus ws_participation (Event 17.04.)
// ══════════════════════════════════════════════════════

const SGAME = 1800;
const DUR1  = 632;    // Phase 1: Zentrum gesperrt
const DUR2  = 1168;   // Phase 2: Zentrum offen (632s → 1800s)

// Volle Spielernamen
const NAMES = {
  GB: 'GeneralBlücher',
  GF: 'Ghost Fight',
  SN: 'Snailnuts',
  Ba: 'Balafre',
  Me: 'Melthanos',
  Ti: 'Tipsx',
  XT: 'XTO43',
  Dr: 'The 100th doctor',
  Be: 'Ben_the_men',
  Si: 'So isses',
  My: 'Meeysi',
  Ma: 'Maya1',
  Db: 'Dbo0404',
  Ko: 'KomischerKautz',
  Gr: 'Greuto',
  Et: 'Etha2',
  jk: 'jks741',
  We: 'Weiler90'
};

// Kampfbeitrag je Spieler: T_eff * simU(T_eff) / 40000
const P = {
  GB: 236.8,   // GeneralBlücher    — Assassin #1
  GF: 192.8,   // Ghost Fight       — Assassin #2
  SN: 145.5,   // Snailnuts
  Ba: 122.3,   // Balafre
  Me: 110.1,   // Melthanos
  Ti: 107.3,   // Tipsx
  XT: 100.0,   // XTO43
  Dr:  95.3,   // The 100th doctor
  Be:  92.9,   // Ben_the_men
  Si:  92.0,   // So isses
  My:  88.3,   // Meeysi
  Ma:  81.9,   // Maya1
  Db:  81.6,   // Dbo0404
  Ko:  80.4,   // KomischerKautz
  Gr:  77.8,   // Greuto
  Et:  72.2,   // Etha2
  jk:  71.0,   // jks741
  We:  55.7,   // Weiler90
};

// Punkte je Sekunde je Gebäude
const PTS = { silo:80, ars:10, sold:10, z1:60, z2:60, z3:60, z4:60 };

// Kampfstärke einer Gruppe (abnehmender Grenznutzen: Spieler i trägt 1/√(i+1) bei)
function str(vals) {
  return [...vals].sort((a,b)=>b-a).reduce((s,v,i)=>s+v/Math.sqrt(i+1), 0);
}

// Kontrollanteil: wer hält ein Gebäude? (min 5%, max 95%)
function ctrl(sA, sB) {
  if (sA+sB < 0.01) return 0.5;
  return Math.max(0.05, Math.min(0.95, sA/(sA+sB)));
}

// ── 2-Phasen-Simulation ────────────────────────────────────────────
//
// lineup = {
//   silo:  [keys],   → Phase 2: am Raketensilo (Zentrum)
//   ars:   [keys],   → Phase 2: am Arsenal (obere Mitte, zwischen Z1 und Z2)
//   sold:  [keys],   → Phase 2: an der Söldnerfabrik (untere Mitte, zwischen Z3 und Z4)
//   z1..z4:[keys],   → beide Phasen: in der Außenzone
// }
//
// Phase-1-Logik:
//   Assassinen (silo) helfen in Zone 1 (stärkste Zone, oben links)
//   Arsenal-Spieler  helfen in Zone 2 (oben rechts — neben Arsenal)
//   Söldner-Spieler  helfen in Zone 4 (unten links  — neben Söldnerfabrik)
//
function sim(label, ours, theirs, raidA=0, raidB=0) {

  // ── Phase 1: alle Spieler in Zonen ──────────────────────────────
  // Kein Zentrum, keine Buffs
  function phase1zones(lu) {
    return {
      z1: [...(lu.z1||[]), ...(lu.silo||[])],   // Assassinen → Zone 1
      z2: [...(lu.z2||[]), ...(lu.ars||[])],    // Arsenal-Spieler → Zone 2
      z3: [...(lu.z3||[])],
      z4: [...(lu.z4||[]), ...(lu.sold||[])],   // Söldner-Spieler → Zone 4
    };
  }

  const p1A = phase1zones(ours);
  const p1B = phase1zones(theirs);

  // Zone-Kontrolle Phase 1 (kein Arsenal/Söldner-Buff, Lazarett läuft)
  let cZ1 = {z1:.5, z2:.5, z3:.5, z4:.5};
  for (let i=0; i<5; i++) {
    const lazA = (cZ1.z2>.5?1.025:1)*(cZ1.z4>.5?1.025:1);
    const lazB = ((1-cZ1.z2)>.5?1.025:1)*((1-cZ1.z4)>.5?1.025:1);
    for (const z of ['z1','z2','z3','z4']) {
      cZ1[z] = ctrl(str(p1A[z])*lazA, str(p1B[z])*lazB);
    }
  }

  // ── Phase 2: Zentrum offen ───────────────────────────────────────
  const ctrlSilo = ctrl(str(ours.silo||[]), str(theirs.silo||[]));
  const ctrlArs  = ctrl(str(ours.ars||[]),  str(theirs.ars||[]));
  const ctrlSold = ctrl(str(ours.sold||[]), str(theirs.sold||[]));

  // Kampf-Buffs aus Zentrum-Gebäuden
  const arsA = ctrlArs  > 0.5 ? 1.15 : 1.0;   // Wir halten Arsenal → +15% für uns
  const arsB = ctrlArs  < 0.5 ? 1.15 : 1.0;   // Gegner hält Arsenal → +15% für sie
  const debA = ctrlSold < 0.5 ? 0.85 : 1.0;   // Gegner hält Söldner → -15% auf uns
  const debB = ctrlSold > 0.5 ? 0.85 : 1.0;   // Wir halten Söldner  → -15% auf Gegner

  // Raid-Malus
  const rtA = raidA>0 ? Math.min(0.35,(Math.floor(SGAME/(raidA*60))*90)/SGAME) : 0;
  const rtB = raidB>0 ? Math.min(0.35,(Math.floor(SGAME/(raidB*60))*90)/SGAME) : 0;

  // Zone-Kontrolle Phase 2 (nur permanente Zonen-Spieler, mit Buffs)
  let cZ2 = {z1:.5, z2:.5, z3:.5, z4:.5};
  for (let i=0; i<5; i++) {
    const lazA = (cZ2.z2>.5?1.025:1)*(cZ2.z4>.5?1.025:1);
    const lazB = ((1-cZ2.z2)>.5?1.025:1)*((1-cZ2.z4)>.5?1.025:1);
    for (const z of ['z1','z2','z3','z4']) {
      const lwA = raidA>0&&(z==='z2'||z==='z4') ? (1-rtA*0.6) : 1;
      const lwB = raidB>0&&(z==='z2'||z==='z4') ? (1-rtB*0.6) : 1;
      cZ2[z] = ctrl(str(ours[z]||[])*arsA*debA*lazA*lwA, str(theirs[z]||[])*arsB*debB*lazB*lwB);
    }
  }

  // ── Punkte ───────────────────────────────────────────────────────
  // Infozentrum (Zone 1): +10% auf alle Gebäude — getrennt je Phase
  const infoA1 = cZ1.z1>.5 ? 1.10 : 1.0;
  const infoB1 = (1-cZ1.z1)>.5 ? 1.10 : 1.0;
  const infoA2 = cZ2.z1>.5 ? 1.10 : 1.0;
  const infoB2 = (1-cZ2.z1)>.5 ? 1.10 : 1.0;

  let pA=0, pB=0;

  // Zentrum (nur Phase 2)
  pA += PTS.silo*DUR2*ctrlSilo;        pB += PTS.silo*DUR2*(1-ctrlSilo);
  pA += PTS.ars *DUR2*ctrlArs*infoA2; pB += PTS.ars *DUR2*(1-ctrlArs)*infoB2;
  pA += PTS.sold*DUR2*ctrlSold*infoA2;pB += PTS.sold*DUR2*(1-ctrlSold)*infoB2;

  // Außenzonen: Phase 1 + Phase 2 separat
  for (const z of ['z1','z2','z3','z4']) {
    pA += PTS[z]*DUR1*cZ1[z]*infoA1;
    pB += PTS[z]*DUR1*(1-cZ1[z])*infoB1;
    pA += PTS[z]*DUR2*cZ2[z]*infoA2;
    pB += PTS[z]*DUR2*(1-cZ2[z])*infoB2;
  }

  // Raid-Bonus
  if (raidA>0){const ns=Math.floor(SGAME/(raidA*60));pA+=Math.round(ns*(PTS.z2*50+PTS.z4*50)*0.65);}
  if (raidB>0){const ns=Math.floor(SGAME/(raidB*60));pB+=Math.round(ns*(PTS.z2*50+PTS.z4*50)*0.65);}

  return {
    label, pA:Math.round(pA), pB:Math.round(pB),
    diff:Math.round(pA-pB), won:pA>pB,
    ctrlSilo:Math.round(ctrlSilo*100),
    ctrlArs:Math.round(ctrlArs*100),
    ctrlSold:Math.round(ctrlSold*100),
    // Zone-Kontrolle Phase 1 / Phase 2
    z1p1:Math.round(cZ1.z1*100), z1p2:Math.round(cZ2.z1*100),
    z2p1:Math.round(cZ1.z2*100), z2p2:Math.round(cZ2.z2*100),
    z3p1:Math.round(cZ1.z3*100), z3p2:Math.round(cZ2.z3*100),
    z4p1:Math.round(cZ1.z4*100), z4p2:Math.round(cZ2.z4*100),
    arsA:arsA>1, arsB:arsB>1, debA:debA<1, debB:debB<1
  };
}

// ══════════════════════════════════════════════════════
//  Aufstellungen
//
//  Phase-1-Zuweisung (automatisch in sim()):
//    Assassinen (silo)       → helfen in Zone 1 (0–10:32 min)
//    Arsenal-Spieler (ars)   → helfen in Zone 2 (0–10:32 min)
//    Söldner-Spieler (sold)  → helfen in Zone 4 (0–10:32 min)
//
//  Karte:
//    Zone 1 = NW (links oben)   | Arsenal      = Obere Mitte (neben Z1/Z2)
//    Zone 2 = NE (rechts oben)  | Raketensilo  = Zentrum
//    Zone 3 = SE (rechts unten) | Söldnerfabrik = Untere Mitte (neben Z3/Z4)
//    Zone 4 = SW (links unten)
// ══════════════════════════════════════════════════════

const OPT = {

  // ── Option A: Nur Silo — kein Arsenal, kein Söldner ─────────────
  // Alle 16 Zonenspieler bleiben die vollen 30 Min in ihren Zonen
  A: {
    name: 'Option A — Nur Silo, alle 16 in Zonen',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [], sold: [],
      z1: [P.SN, P.Ba, P.Me, P.Ti, P.XT],   // 5 Spieler (Z1 = höchste Priorität)
      z2: [P.Db, P.Ko, P.Gr],               // 3 Spieler
      z3: [P.Dr, P.Be, P.Si, P.My, P.Ma],   // 5 Spieler (Z3 = hohe Priorität)
      z4: [P.Et, P.jk, P.We]               // 3 Spieler
    }, raid:0
  },

  // ── Option B: Arsenal(2) + Söldner(2) — je 2 aus Z2/Z4 ──────────
  // Arsenal-Spieler kommen aus Z2-Region (oben), Söldner aus Z4-Region (unten)
  // Phase 1: KomischerKautz+Dbo0404 helfen in Zone 2, Etha2+jks741 in Zone 4
  // Phase 2: wechseln zu Arsenal/Söldner
  B: {
    name: 'Option B — 2×Arsenal(Ko,Db) + 2×Söldner(Et,jk)',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [P.Ko, P.Db],    // Arsenal (obere Mitte) — 2 Spieler aus Z2-Bereich
      sold: [P.Et, P.jk],    // Söldnerfabrik (untere Mitte) — 2 Spieler aus Z4-Bereich
      z1: [P.SN, P.Ba, P.Me, P.Ti, P.XT],   // 5 (unverändert)
      z2: [P.Gr],                            // 1 — Z2 wird geschwächt
      z3: [P.Dr, P.Be, P.Si, P.My, P.Ma],   // 5 (unverändert)
      z4: [P.We]                             // 1 — Z4 wird geschwächt
    }, raid:0
  },

  // ── Option C: Arsenal(2) + Söldner(2) — stärkere Söldner-Besatzung ──
  // Söldner mit Maya1+Meeysi (stärker als Et+jk), dafür Z3 schwächer
  C: {
    name: 'Option C — 2×Arsenal(Ko,Db) + 2×Söldner(Ma,My)',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [P.Ko, P.Db],
      sold: [P.Ma, P.My],   // stärkere Söldner-Spieler aus Z3-Region
      z1: [P.SN, P.Ba, P.Me, P.Ti, P.XT],
      z2: [P.Gr],
      z3: [P.Dr, P.Be, P.Si],   // Z3 verliert 2 Spieler
      z4: [P.Et, P.jk, P.We]
    }, raid:0
  },

  // ── Option D: Arsenal(2) aus Z1-Region — stärkeres Arsenal ──────
  // Ti+XT gehen zu Arsenal (stärker), dafür Z1 mit nur 3 Spielern
  D: {
    name: 'Option D — 2×Arsenal(Ti,XT) + 2×Söldner(Et,jk)',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [P.Ti, P.XT],   // stärkere Arsenal-Spieler aus Z1-Region
      sold: [P.Et, P.jk],
      z1: [P.SN, P.Ba, P.Me],   // Z1 verliert 2 — nur noch 3
      z2: [P.Db, P.Ko, P.Gr],   // Z2 bleibt voll
      z3: [P.Dr, P.Be, P.Si, P.My, P.Ma],
      z4: [P.We]
    }, raid:0
  },

  // ── Option E: Nur Arsenal(2), kein Söldner ───────────────────────
  E: {
    name: 'Option E — 2×Arsenal(Ko,Db), kein Söldner',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [P.Ko, P.Db],
      sold: [],
      z1: [P.SN, P.Ba, P.Me, P.Ti, P.XT],
      z2: [P.Gr],
      z3: [P.Dr, P.Be, P.Si, P.My, P.Ma],
      z4: [P.Et, P.jk, P.We]
    }, raid:0
  },

  // ── Option F: Ausgewogen — je 1 Spieler Arsenal+Söldner ─────────
  // Nur 2 Spieler ins Zentrum → Zonen bleiben stärker
  F: {
    name: 'Option F — 1×Arsenal(Ko) + 1×Söldner(Et)',
    lineup: {
      silo: [P.GB, P.GF],
      ars:  [P.Ko],
      sold: [P.Et],
      z1: [P.SN, P.Ba, P.Me, P.Ti, P.XT],
      z2: [P.Db, P.Gr],
      z3: [P.Dr, P.Be, P.Si, P.My, P.Ma],
      z4: [P.jk, P.We]
    }, raid:0
  },
};

// Gegner-Archetyen (gleiche Gesamtstärke, verschiedene Strategie)
const ENEMY = {
  A: { // Gegner: nur Silo
    silo:[P.GB,P.GF], ars:[], sold:[],
    z1:[P.SN,P.Ba,P.Me,P.Ti,P.XT],
    z2:[P.Db,P.Ko,P.Gr],
    z3:[P.Dr,P.Be,P.Si,P.My,P.Ma],
    z4:[P.Et,P.jk,P.We]
  },
  B: { // Gegner: Silo + 2×Arsenal + 2×Söldner
    silo:[P.GB,P.GF], ars:[P.Ko,P.Db], sold:[P.Et,P.jk],
    z1:[P.SN,P.Ba,P.Me,P.Ti,P.XT],
    z2:[P.Gr], z3:[P.Dr,P.Be,P.Si,P.My,P.Ma], z4:[P.We]
  },
  C: { // Gegner: Silo + 2×Arsenal, kein Söldner
    silo:[P.GB,P.GF], ars:[P.Ko,P.Db], sold:[],
    z1:[P.SN,P.Ba,P.Me,P.Ti,P.XT],
    z2:[P.Gr], z3:[P.Dr,P.Be,P.Si,P.My,P.Ma], z4:[P.Et,P.jk,P.We]
  },
  D: { // Gegner: kein Zentrum, alle in Zonen (verstärkte Zonen)
    silo:[], ars:[], sold:[],
    z1:[P.GB,P.SN,P.Ba,P.Me,P.Ti],
    z2:[P.GF,P.XT,P.Db,P.Ko],
    z3:[P.Dr,P.Be,P.Si,P.My,P.Ma],
    z4:[P.Gr,P.Et,P.jk,P.We]
  },
};

// ══════════════════════════════════════════════════════
//  AUSGABE
// ══════════════════════════════════════════════════════

function nameList(keys) {
  return keys.map(k=>Object.keys(P).find(n=>P[n]===k)).filter(Boolean).map(k=>NAMES[k]).join(', ');
}

const optKeys = Object.keys(OPT);
const enemyLabel = { A:'Nur Silo', B:'Silo+2Ars+2Sold', C:'Silo+2Ars', D:'Kein Zentrum' };

console.log('\n══════════════════════════════════════════════════════');
console.log(' 2-PHASEN-SIMULATION — Team A (18 Spieler, Stand 17.04.)');
console.log(' Phase 1 (0–10:32):  alle Spieler in Außenzonen');
console.log(' Phase 2 (10:32–30): Spieler wechseln ins Zentrum');
console.log('══════════════════════════════════════════════════════\n');

// Alle Optionen vs alle Gegner
const scores = {};
for (const k of optKeys) {
  const o = OPT[k];
  scores[k] = { wins:0, totalDiff:0, results:{} };
  for (const [ek, eL] of Object.entries(ENEMY)) {
    const r = sim('', o.lineup, eL, o.raid, 0);
    scores[k].results[ek] = r;
    if (r.won) scores[k].wins++;
    scores[k].totalDiff += r.diff;
  }
  scores[k].avgDiff = Math.round(scores[k].totalDiff/4);
}

const sorted = optKeys.slice().sort((a,b)=>scores[b].wins-scores[a].wins||scores[b].avgDiff-scores[a].avgDiff);

console.log('Rang | Option                                              | Siege | Avg Diff');
console.log('-----|-----------------------------------------------------|-------|----------');
sorted.forEach((k,i) => {
  const s = scores[k];
  const medal = i===0?'★':(i+1)+'';
  console.log(`  ${medal.padEnd(2)} | ${OPT[k].name.padEnd(51)} | ${s.wins}/4  | ${s.avgDiff>0?'+':''}${s.avgDiff}`);
});

// Detail der besten Optionen
console.log('\n══════════════════════════════════════════════════════');
console.log(' DETAIL-ANALYSE');
console.log('══════════════════════════════════════════════════════');

for (const k of sorted) {
  const o = OPT[k];
  const s = scores[k];
  console.log(`\n── ${o.name} (${s.wins}/4 Siege, Avg ${s.avgDiff>0?'+':''}${s.avgDiff}) ──`);
  console.log(`   Silo   : ${nameList(o.lineup.silo)} (Phase 1 → Zone 1, ab Min 10:32 → Silo)`);
  console.log(`   Arsenal: ${nameList(o.lineup.ars)||'—'} (Phase 1 → Zone 2, ab Min 10:32 → Arsenal Obere Mitte)`);
  console.log(`   Söldner: ${nameList(o.lineup.sold)||'—'} (Phase 1 → Zone 4, ab Min 10:32 → Söldner Untere Mitte)`);
  console.log(`   Zone 1 (NW, links oben): ${nameList(o.lineup.z1)} — beide Phasen`);
  console.log(`   Zone 2 (NE, rechts oben): ${nameList(o.lineup.z2)||'LEER!'} — beide Phasen`);
  console.log(`   Zone 3 (SE, rechts unten): ${nameList(o.lineup.z3)} — beide Phasen`);
  console.log(`   Zone 4 (SW, links unten): ${nameList(o.lineup.z4)||'LEER!'} — beide Phasen`);

  for (const [ek, r] of Object.entries(s.results)) {
    const buff = (r.arsA?'[Arsenal:WIR +15%]':'')+(r.arsB?'[Arsenal:GEGNER +15%]':'');
    const deb  = (r.debA?'[Söldner:GEGNER hält, wir -15%]':'')+(r.debB?'[Söldner:WIR halten, Gegner -15%]':'');
    console.log(`\n   vs Gegner ${ek} (${enemyLabel[ek]}): ${r.won?'✓ SIEG':'✗ NIEDERLAGE'}`);
    console.log(`      Punkte: Wir ${r.pA.toLocaleString()} | Gegner ${r.pB.toLocaleString()} | Diff: ${r.diff>0?'+':''}${r.diff.toLocaleString()}`);
    console.log(`      Silo: ${r.ctrlSilo}% | Arsenal: ${r.ctrlArs}% | Söldner: ${r.ctrlSold}%`);
    console.log(`      Zone 1: ${r.z1p1}%→${r.z1p2}%  Zone 2: ${r.z2p1}%→${r.z2p2}%  Zone 3: ${r.z3p1}%→${r.z3p2}%  Zone 4: ${r.z4p1}%→${r.z4p2}%`);
    if (buff||deb) console.log(`      Buffs: ${buff} ${deb}`);
  }
}
