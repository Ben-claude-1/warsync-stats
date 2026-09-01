import { reliability } from './helpers.js';
import { APP } from './state.js';

// ── ROTATION: fest gesetzte Spieler + Fairness-Rotation für den Rest ──
//
// Wer einen Platz bekommt, wird von Hand in der Anmeldung eingeteilt (A/AE/B/BE,
// begrenzt auf 20 + 10 je Team). Diese Logik verteilt darin die Rollen: die
// stärksten `fixedCount` Gesetzten sind fest dabei, der Rest rotiert fair.

// ── Die fünf Werte der Anmeldung ──────────────────────────────────────────────
// Wüstensturm und Schluchtsturm benutzen dieselbe Kodierung, damit ein Knopf in
// beiden Anmeldungen dasselbe bedeutet:
//
//   'A' / 'B'    gesetzt        — steht in der Aufstellung, max. 20 je Team
//   'AE' / 'BE'  Ersatz         — angemeldet, bekommt kein Gebäude, max. 10 je Team
//   'C'          ohne Platz     — angemeldet, aber keiner der 30 Plätze; unbegrenzt
//
// 'C' hängt bewusst an keinem Team: wer keinen Platz bekommt, spielt in keiner
// der beiden Schlachten. Sein Nichteinsatz steht deshalb nicht in
// ws_participation (dort hängt jede Zeile an einem Team-Event), sondern als
// Zähler in ws_priority — siehe core/prio.js.
export const REG_WERTE=['A','AE','B','BE','C'];
// 'AE' → 'A'. Für jede Frage nach dem Team, unabhängig von der Ersatz-Markierung.
// 'C' hat keins und liefert null — wie ein nicht angemeldeter Spieler.
export function teamOf(v){return v==='A'||v==='AE'?'A':v==='B'||v==='BE'?'B':null;}
export function istErsatzWert(v){return v==='AE'||v==='BE';}
export function istOhnePlatzWert(v){return v==='C';}

// ── Die Begrenzung auf 20 + 10 ────────────────────────────────────────────────
// Ohne sie ließen sich beliebig viele Spieler gesetzt anmelden, und es wäre
// hinterher nicht mehr zu erkennen, wer den Platz tatsächlich hat — genau das
// soll die Rotation entscheiden können. Gibt null zurück, wenn der Wert noch
// frei ist, sonst den Text für den Nutzer.
//
// 'C' ist absichtlich unbegrenzt: das ist der Auffangwert für alle, die keinen
// Platz bekommen haben, und davon kann es beliebig viele geben.
export function regPlatzPruefen(assign,name,wert,maxHaupt,maxErsatz){
  if(wert!=='A'&&wert!=='B'&&wert!=='AE'&&wert!=='BE')return null;
  const gesetzt=wert==='A'||wert==='B';
  const grenze=gesetzt?maxHaupt:maxErsatz;
  const belegt=Object.entries(assign||{}).filter(([n,v])=>n!==name&&v===wert).length;
  if(belegt<grenze)return null;
  const team=teamOf(wert);
  return`${wert} ist voll — Team ${team} hat bereits ${grenze} ${gesetzt?'gesetzte Spieler':'Ersatzspieler'}.\n\n`
    +`Melde erst jemanden ab, oder setze diesen Spieler auf C (angemeldet, aber kein Platz).`;
}

// Datum des letzten Einsatzes (Event ohne Warteliste) in diesem Modus, oder null
// wenn noch nie dabei — „noch nie dabei" wiegt am schwersten, kommt also zuerst dran.
function letzterEinsatz(name,mode){
  let latest=null;
  APP.data.participation.forEach(x=>{
    if(x.player_name!==name||x.waitlisted)return;
    const ev=APP.data.events.find(e=>e.id===x.event_id);
    if(!ev||ev.mode!==mode)return;
    if(!latest||ev.event_date>latest)latest=ev.event_date;
  });
  return latest;
}

// Anteil der Anmeldungen, bei denen tatsächlich ein Platz herausgesprungen ist.
// Noch nie angemeldet gewesen → 0 (kommt vor allen mit schlechter, aber echter Quote).
function einsatzquote(name,mode){
  const parts=APP.data.participation.filter(x=>{
    if(x.player_name!==name)return false;
    const ev=APP.data.events.find(e=>e.id===x.event_id);
    return ev&&ev.mode===mode;
  });
  if(!parts.length)return 0;
  return parts.filter(x=>!x.waitlisted).length/parts.length;
}

// Fairness-Reihenfolge unter den NICHT fest gesetzten Angemeldeten:
// Wartezeit seit letztem Einsatz (älter zuerst) → Einsatzquote (niedriger zuerst)
// → Zuverlässigkeit (niedriger zuerst, siehe reliability()) → Stärke als Tiebreak.
export function rotationSort(names,mode,power){
  return[...names].sort((a,b)=>{
    const da=letzterEinsatz(a,mode),db=letzterEinsatz(b,mode);
    if(da!==db){
      if(da===null)return -1;
      if(db===null)return 1;
      return da<db?-1:1;
    }
    const qa=einsatzquote(a,mode),qb=einsatzquote(b,mode);
    if(qa!==qb)return qa-qb;
    const ra=reliability(a,mode)??0,rb=reliability(b,mode)??0;
    if(ra!==rb)return ra-rb;
    return(power(b)||0)-(power(a)||0);
  });
}

// Teilt die Angemeldeten eines Teams in vier Gruppen. Reine Funktion — nimmt die
// Namen entgegen, statt sie sich selbst aus APP.teamAssign zu holen, damit
// Wüstensturm und Schluchtsturm exakt denselben Code mit ihren jeweiligen
// Registrierungen aufrufen können.
//
// `substituteNames` sind die von Hand als Ersatz markierten Spieler, `waitlistNames`
// die von Hand als „ohne Platz" markierten (Wert 'C'). Beide gehen **vor** der
// Rotation aus dem Rennen: eine bewusste Entscheidung darf nicht davon abhängen,
// wie stark jemand gerade ist oder wie lange er aussetzen musste. Erst der Rest
// wird automatisch aufgeteilt — die Rotation greift also nur noch, wenn trotz der
// Begrenzung mehr Gesetzte zusammenkommen, als Hauptplätze da sind.
export function computeRoster({registeredNames,fixedCount,maxHaupt,maxErsatz,mode,power,substituteNames,waitlistNames}){
  const alle=[...new Set(registeredNames)];
  const ohnePlatz=new Set((waitlistNames||[]).filter(n=>alle.includes(n)));
  const manuell=new Set((substituteNames||[]).filter(n=>alle.includes(n)&&!ohnePlatz.has(n)));
  const byPower=alle.filter(n=>!manuell.has(n)&&!ohnePlatz.has(n)).sort((a,b)=>(power(b)||0)-(power(a)||0));
  const fest=byPower.slice(0,Math.max(0,fixedCount));
  const festSet=new Set(fest);
  const rest=byPower.filter(n=>!festSet.has(n));
  const restSorted=rotationSort(rest,mode,power);
  const hauptFrei=Math.max(0,maxHaupt-fest.length);
  const rotationHaupt=restSorted.slice(0,hauptFrei);
  // Die von Hand Gesetzten belegen die Ersatzbank zuerst; nur was danach frei
  // bleibt, füllt die Rotation auf. Sind es mehr als Plätze da sind, rutschen die
  // schwächsten davon auf die Warteliste — die Zahl ist eine Spielregel.
  const manuellSort=[...manuell].sort((a,b)=>(power(b)||0)-(power(a)||0));
  const ersatzFrei=Math.max(0,maxErsatz-manuellSort.length);
  const rotationErsatz=[...manuellSort.slice(0,maxErsatz),...restSorted.slice(hauptFrei,hauptFrei+ersatzFrei)];
  const ohnePlatzSort=[...ohnePlatz].sort((a,b)=>(power(b)||0)-(power(a)||0));
  const warteliste=[...ohnePlatzSort,...restSorted.slice(hauptFrei+ersatzFrei),...manuellSort.slice(maxErsatz)];
  return{fest,rotationHaupt,rotationErsatz,warteliste};
}
