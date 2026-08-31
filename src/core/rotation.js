import { reliability } from './helpers.js';
import { APP } from './state.js';

// ── ROTATION: fest gesetzte Spieler + Fairness-Rotation für den Rest ──
//
// Anmeldung bleibt unbegrenzt (jeder, der sich im Spiel angemeldet hat, wird
// markiert). Wie viele davon einen Platz bekommen, entscheidet automatisch diese
// Logik beim Einfrieren des Kaders (wsFreezeTeam/csFreezeTeam): die stärksten
// `fixedCount` Angemeldeten sind immer dabei, der Rest rotiert fair, sobald mehr
// angemeldet sind als Plätze frei sind.

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
// `substituteNames` sind die von Hand als Ersatz markierten Spieler. Sie gehen
// **vor** der Rotation aus dem Rennen: eine bewusste Entscheidung darf nicht
// davon abhängen, wie stark jemand gerade ist oder wie lange er aussetzen musste.
// Erst der Rest wird automatisch aufgeteilt — genau dann greift die Rotation, wenn
// mehr Gesetzte angemeldet sind, als Hauptplätze da sind.
export function computeRoster({registeredNames,fixedCount,maxHaupt,maxErsatz,mode,power,substituteNames}){
  const alle=[...new Set(registeredNames)];
  const manuell=new Set((substituteNames||[]).filter(n=>alle.includes(n)));
  const byPower=alle.filter(n=>!manuell.has(n)).sort((a,b)=>(power(b)||0)-(power(a)||0));
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
  const warteliste=[...restSorted.slice(hauptFrei+ersatzFrei),...manuellSort.slice(maxErsatz)];
  return{fest,rotationHaupt,rotationErsatz,warteliste};
}
