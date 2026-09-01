import { sbGet, sbUpsert } from './api.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  PRIOLISTE — wer beim nächsten Mal vorgezogen werden soll
// ══════════════════════════════════════════════════════════════════
//
// Es melden sich mehr Leute an, als Plätze da sind (39 auf 20 + 10). Wer keinen
// bekommt, wird in der Anmeldung auf 'C' gesetzt. Damit das nicht Woche für
// Woche dieselben trifft, führt jede Allianz je Event einen Zähler:
//
//   'C' beim Anmeldeschluss   →  +1
//   einen der 30 Plätze       →  -1   (nie unter 0)
//   gar nicht angemeldet      →  unverändert — die Prio bleibt für nächste Woche
//
// Nur Zähler über 0 werden angezeigt. Wer immer eingeteilt wird, steht damit gar
// nicht erst in der Liste.
//
// **Die Liste schlägt vor, sie teilt nicht ein.** Sie ändert weder die Rotation
// noch die Aufstellung — sie steht als Zahl neben dem Namen, damit der Mensch,
// der die Einteilung macht, sie sieht. Das war ausdrücklich so gewünscht: die
// Einteilung nach dem Anmeldeschluss um 04:00 soll niemand mehr automatisch
// umbauen.
//
// Warum eine eigene Tabelle statt einer Auswertung von ws_participation: ein
// 'C'-Spieler gehört zu keinem Team und damit zu keinem Event — es gibt keine
// Zeile, an die man ihn hängen könnte (siehe db/2026-09-01_ws_priority.sql).

export const PRIO_MODI=[{k:'ws',label:'Wüstensturm'},{k:'cs',label:'Schluchtsturm'}];

function alleZeilen(){return APP.data.priority||[];}
export function prioRows(mode){return alleZeilen().filter(r=>r.mode===mode);}
export function prioOf(name,mode){
  const r=prioRows(mode).find(x=>x.player_name===name);
  return r?(r.counter||0):0;
}
// Nur wer wirklich wartet. Größter Zähler zuerst, bei Gleichstand alphabetisch —
// die Datenbank-Reihenfolge wäre sonst Zufall und die Liste spränge bei jedem Laden.
export function prioListe(mode){
  return prioRows(mode).filter(r=>(r.counter||0)>0)
    .sort((a,b)=>(b.counter-a.counter)||a.player_name.localeCompare(b.player_name));
}

export async function prioPull(){
  try{APP.data.priority=await sbGet('ws_priority?order=counter.desc');}
  catch(e){APP.data.priority=[];console.warn('Prioliste nicht ladbar:',(e&&e.message)||e);}
}

// Verrechnet einen Anmeldeschluss. `eventDate` ist der Tag, für den eingeteilt
// wurde (Wüstensturm: der Freitag, Schluchtsturm: der Tag des Schließens).
//
// Idempotent über `last_event_date`: ein zweiter Durchlauf für denselben Tag —
// zwei Geräte laden gleichzeitig, oder die Anmeldung wird geschlossen, geöffnet
// und wieder geschlossen — zählt nicht doppelt. Der Preis: eine nach dem
// Schließen geänderte C-Liste wird nicht nachgetragen. Dafür gibt es die
// Stepper im Reiter „Prio".
export async function prioVerrechnen({mode,eventDate,ohnePlatz,eingeteilt}){
  // Erst frisch holen: ein anderes Gerät kann denselben Anmeldeschluss schon
  // verrechnet haben, und gegen einen veralteten Stand wäre `last_event_date`
  // blind. Bewusst ohne catch — schlägt die Abfrage fehl, bricht die
  // Verrechnung ab. Mit einer leeren Liste weiterzurechnen hieße, jeden
  // gewachsenen Zähler auf 1 zurückzusetzen.
  APP.data.priority=await sbGet('ws_priority?order=counter.desc');
  const vorher=new Map(prioRows(mode).map(r=>[r.player_name,r]));
  const neu=[];
  const bump=(name,d)=>{
    const r=vorher.get(name);
    if(r&&r.last_event_date===eventDate)return;    // für diesen Tag schon verrechnet
    const alt=r?(r.counter||0):0;
    const wert=Math.max(0,alt+d);
    // Für einen Zähler, der auf 0 bleibt, wird keine Zeile angelegt — sonst
    // stünde die halbe Allianz mit einer Null in der Tabelle.
    if(wert===alt)return;
    neu.push({player_name:name,mode,counter:wert,last_event_date:eventDate});
  };
  [...new Set(ohnePlatz||[])].forEach(n=>bump(n,+1));
  [...new Set(eingeteilt||[])].forEach(n=>bump(n,-1));
  if(!neu.length)return[];
  await sbUpsert('ws_priority',neu,'alliance_id,player_name,mode');
  await prioPull();
  return neu;
}

// Korrektur von Hand aus dem Reiter „Prio". `last_event_date` bleibt bewusst
// unangetastet: die Korrektur soll die Idempotenz des Anmeldeschlusses nicht
// aufheben, sonst zählte ein erneutes Schließen doch wieder doppelt.
export async function prioSetzen(name,mode,wert){
  const w=Math.max(0,Math.round(Number(wert)||0));
  await sbUpsert('ws_priority',[{player_name:name,mode,counter:w}],'alliance_id,player_name,mode');
  await prioPull();
}
