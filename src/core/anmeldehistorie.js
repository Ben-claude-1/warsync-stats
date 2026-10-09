import { sbPost } from './api.js';
import { REG_WERTE } from './rotation.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  ANMELDEHISTORIE — wie stand jemand in den letzten Wochen
// ══════════════════════════════════════════════════════════════════
//
// ws_participation kennt nur die 30 Spieler je Team, die beim Kader-Lock einen
// Platz bekommen (A/AE/B/BE) — wsFreezeTeam() (src/ui/ws.js) schreibt nur für
// sie eine Zeile. Wer AC/BC/ABC war (angemeldet, aber ausgeschlossen), bekommt
// dort nie eine Zeile, und rückwirkend ist das von „gar nicht angemeldet"
// nicht mehr zu unterscheiden — am Beispiel ΧΑΣΑΠΗΣ (02.10.2026) hat genau das
// die Rotation unfair gemacht: ihr tatsächlicher Ausschluss blieb unsichtbar,
// weil der Kader-Lock dieser Woche gar nicht lief.
//
// ws_anmeldestand (db/2026-10-09_ws_anmeldestand.sql) schließt die Lücke, aber
// erst ab dem Tag, an dem sie angelegt wurde — für jede Woche davor gibt es dort
// keine Zeile. Die Historie zeigt deshalb für jede Woche ehrlich, was sie weiß:
//
//   - steht eine Zeile in ws_anmeldestand für IRGENDEINEN Spieler dieser Woche
//     → die Woche gilt als vollständig erfasst; fehlt ein bestimmter Name, ist
//       das ein echtes "nicht angemeldet".
//   - sonst → nur aus ws_participation rekonstruierbar (A/AE/B/BE); wer AC/BC
//     war oder sich gar nicht angemeldet hat, sieht beides Mal gleich aus
//     (keine Zeile) und wird als "unbekannt" markiert — nicht als "leer",
//     sonst sähe die Vergangenheit falsch vollständig aus.

export const ANM_WOCHEN=6;

function fridayStr(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

// Die letzten `n` Freitage, der kommende/aktuelle zuerst. Reine Datumsrechnung,
// bewusst ohne Import aus ui/ws.js — core darf nicht auf ui zugreifen.
export function anmLetzteFreitage(n=ANM_WOCHEN){
  const now=new Date();
  const day=now.getDay(); // 0=So..5=Fr..6=Sa
  const add=day<=5?5-day:6;
  const naechster=new Date(now.getFullYear(),now.getMonth(),now.getDate()+add);
  const out=[];
  for(let i=0;i<n;i++)out.push(fridayStr(new Date(naechster.getFullYear(),naechster.getMonth(),naechster.getDate()-7*i)));
  return out;
}

function anmWocheGedeckt(mode,eventDate){
  return(APP.data.anmeldestand||[]).some(r=>r.mode===mode&&r.event_date===eventDate);
}

// Wert eines Spielers an einem Freitag. Rückgabe {wert,quelle}:
//   quelle 'anmeldestand' → voller Wert, inkl. AC/BC/ABC, aus dem Snapshot.
//   quelle 'teilnahme'    → aus ws_participation rekonstruiert, nur A/AE/B/BE.
//   quelle 'leer'         → Woche ist per Snapshot erfasst, dieser Name fehlt
//                           darin → echt nicht angemeldet.
//   quelle 'unbekannt'    → vor dem Snapshot und keine Teilnahme-Zeile: könnte
//                           AC/BC/ABC oder "gar nicht angemeldet" sein.
export function anmWert(name,mode,eventDate){
  const snap=(APP.data.anmeldestand||[]).find(
    r=>r.player_name===name&&r.mode===mode&&r.event_date===eventDate);
  if(snap)return{wert:snap.wert,quelle:'anmeldestand'};
  if(anmWocheGedeckt(mode,eventDate))return{wert:null,quelle:'leer'};
  // Beide Team-Events desselben Tages durchsuchen — nicht nur das erste
  // gefundene. Ein Freitag hat immer zwei Events (Team A und B).
  const evs=(APP.data.events||[]).filter(e=>e.event_date===eventDate&&e.mode===mode);
  for(const ev of evs){
    const p=(APP.data.participation||[]).find(x=>x.event_id===ev.id&&x.player_name===name);
    if(p)return{wert:p.substitute?ev.team+'E':ev.team,quelle:'teilnahme'};
  }
  return{wert:null,quelle:'unbekannt'};
}

// Jeder Name, der im Fenster irgendwo auftaucht: der aktuelle Kader plus wer
// in einer der gezeigten Wochen eine Zeile hat, auch wenn er inzwischen
// ausgetreten ist — sonst verschwindet er aus seiner eigenen Historie.
export function anmAlleNamen(mode,n=ANM_WOCHEN){
  const freitage=new Set(anmLetzteFreitage(n));
  const namen=new Set((APP.data.players||[]).map(p=>p.name));
  (APP.data.anmeldestand||[]).forEach(r=>{if(r.mode===mode&&freitage.has(r.event_date))namen.add(r.player_name);});
  const evIds=new Set((APP.data.events||[]).filter(e=>e.mode===mode&&freitage.has(e.event_date)).map(e=>e.id));
  (APP.data.participation||[]).forEach(p=>{if(evIds.has(p.event_id))namen.add(p.player_name);});
  return[...namen].sort((a,b)=>a.localeCompare(b));
}

// Eine Zeile je Spieler, eine Spalte je Woche (neueste zuerst).
export function anmHistorie(names,mode='ws',n=ANM_WOCHEN){
  const freitage=anmLetzteFreitage(n);
  return names.map(name=>({name,wochen:freitage.map(d=>({datum:d,...anmWert(name,mode,d)}))}));
}

// Schreibt den vollen Anmeldestand einer Woche fest — jeden Eintrag aus dem
// übergebenen teamAssign (APP.teamAssign bzw. APP.csTeamAssign), nicht nur die
// mit Platz. `on_conflict` macht aus einem zweiten Aufruf für dieselbe Woche
// ein No-Op: schon geschriebene Zeilen bleiben die endgültige Fassung, eine
// spätere Umplanung schreibt die Historie nicht um — dieselbe Haltung wie bei
// ws_participation.
export async function anmeldestandSchreiben(teamAssign,mode,eventDate){
  const rows=Object.entries(teamAssign||{})
    .filter(([,w])=>REG_WERTE.includes(w))
    .map(([player_name,wert])=>({player_name,mode,event_date:eventDate,wert}));
  if(!rows.length)return;
  await sbPost('ws_anmeldestand?on_conflict=alliance_id,player_name,mode,event_date',
    rows,{prefer:'resolution=ignore-duplicates,return=minimal'});
  APP.data.anmeldestand=[...(APP.data.anmeldestand||[]).filter(
    r=>!(r.mode===mode&&r.event_date===eventDate&&rows.some(x=>x.player_name===r.player_name))),
    ...rows];
}
