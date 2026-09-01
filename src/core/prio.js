import { sbGet, sbUpsert } from './api.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  PRIOLISTE — wer beim nächsten Mal vorgezogen werden soll
// ══════════════════════════════════════════════════════════════════
//
// Es melden sich mehr Leute an, als Plätze da sind (39 auf 20 + 10). Wer keinen
// bekommt, wird in der Anmeldung auf 'C' gesetzt. Damit das nicht Woche für
// Woche dieselben trifft, führt jede Allianz einen Zähler:
//
//   'C' beim Anmeldeschluss   →  +1
//   einen der 30 Plätze       →  -1   (nie unter 0)
//   gar nicht angemeldet      →  unverändert — die Prio bleibt für nächste Woche
//
// **Ein Zähler für beide Events.** Wüstensturm und Schluchtsturm zahlen auf
// dieselbe Zahl ein: wer sich in derselben Woche für beide meldet und beide Male
// auf 'C' landet, hat zweimal zugeschaut und steht mit einer 2 da. Mit getrennten
// Zählern stünde er zweimal mit einer 1 in zwei Listen, und beide sähen harmlos
// aus — genau die Auskunft, die man nicht will.
//
// Getrennt bleibt nur der Idempotenz-Stempel (`last_ws_date` / `last_cs_date`):
// die beiden Anmeldeschlüsse können auf denselben Tag fallen, und mit einer
// gemeinsamen Datumsspalte blockierte der eine den anderen.
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
// Zeile, an die man ihn hängen könnte (siehe db/2026-09-01_ws_priority.sql und
// db/2026-09-02_ws_priority_gemeinsam.sql).

// Welche Spalte den Anmeldeschluss eines Events stempelt.
export const PRIO_STEMPEL={ws:'last_ws_date',cs:'last_cs_date'};

export function prioRows(){return APP.data.priority||[];}
export function prioOf(name){
  const r=prioRows().find(x=>x.player_name===name);
  return r?(r.counter||0):0;
}
// Nur wer wirklich wartet. Größter Zähler zuerst, bei Gleichstand alphabetisch —
// die Datenbank-Reihenfolge wäre sonst Zufall und die Liste spränge bei jedem Laden.
export function prioListe(){
  return prioRows().filter(r=>(r.counter||0)>0)
    .sort((a,b)=>(b.counter-a.counter)||a.player_name.localeCompare(b.player_name));
}

export async function prioPull(){
  try{APP.data.priority=await sbGet('ws_priority?order=counter.desc');}
  catch(e){APP.data.priority=[];console.warn('Prioliste nicht ladbar:',(e&&e.message)||e);}
}

// Verrechnet einen Anmeldeschluss. `mode` ist 'ws' oder 'cs' und entscheidet nur,
// welche Datumsspalte gestempelt wird — gezählt wird in beiden Fällen auf
// denselben `counter`. `eventDate` ist der Tag, für den eingeteilt wurde
// (Wüstensturm: der Freitag, Schluchtsturm: der Tag des Schließens).
//
// Idempotent über den Stempel: ein zweiter Durchlauf für denselben Tag und
// dasselbe Event — zwei Geräte laden gleichzeitig, oder die Anmeldung wird
// geschlossen, geöffnet und wieder geschlossen — zählt nicht doppelt. Der Preis:
// eine nach dem Schließen geänderte C-Liste wird nicht nachgetragen. Dafür gibt
// es die Stepper im Reiter „Prio".
export async function prioVerrechnen({mode,eventDate,ohnePlatz,eingeteilt}){
  const stempel=PRIO_STEMPEL[mode];
  if(!stempel)throw new Error('Unbekanntes Event für die Prioliste: '+mode);
  // Erst frisch holen: ein anderes Gerät kann denselben Anmeldeschluss schon
  // verrechnet haben, und gegen einen veralteten Stand wäre der Stempel blind.
  // Bewusst ohne catch — schlägt die Abfrage fehl, bricht die Verrechnung ab.
  // Mit einer leeren Liste weiterzurechnen hieße, jeden gewachsenen Zähler auf 1
  // zurückzusetzen.
  APP.data.priority=await sbGet('ws_priority?order=counter.desc');
  const vorher=new Map(prioRows().map(r=>[r.player_name,r]));
  const neu=[];
  const bump=(name,d)=>{
    const r=vorher.get(name);
    if(r&&r[stempel]===eventDate)return;    // für diesen Anmeldeschluss schon verrechnet
    const alt=r?(r.counter||0):0;
    const wert=Math.max(0,alt+d);
    // Für einen Zähler, der auf 0 bleibt, wird keine Zeile angelegt — sonst
    // stünde die halbe Allianz mit einer Null in der Tabelle.
    if(wert===alt)return;
    neu.push({player_name:name,counter:wert,[stempel]:eventDate});
  };
  [...new Set(ohnePlatz||[])].forEach(n=>bump(n,+1));
  [...new Set(eingeteilt||[])].forEach(n=>bump(n,-1));
  if(!neu.length)return[];
  await sbUpsert('ws_priority',neu,'alliance_id,player_name');
  await prioPull();
  return neu;
}

// Korrektur von Hand aus dem Reiter „Prio". Die Stempel bleiben bewusst
// unangetastet: die Korrektur soll die Idempotenz des Anmeldeschlusses nicht
// aufheben, sonst zählte ein erneutes Schließen doch wieder doppelt.
export async function prioSetzen(name,wert){
  const w=Math.max(0,Math.round(Number(wert)||0));
  await sbUpsert('ws_priority',[{player_name:name,counter:w}],'alliance_id,player_name');
  await prioPull();
}
