import { sbDelete, sbGet, sbPost } from './api.js';
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
//   - steht eine Zeile vom Kader-Lock (quelle='lock') für IRGENDEINEN Spieler
//     dieser Woche → die Woche gilt als vollständig erfasst; fehlt ein
//     bestimmter Name, ist das ein echtes "nicht angemeldet".
//   - sonst → nur aus ws_participation rekonstruierbar (A/AE/B/BE); wer AC/BC
//     war oder sich gar nicht angemeldet hat, sieht beides Mal gleich aus
//     (keine Zeile) und wird als "unbekannt" markiert — nicht als "leer",
//     sonst sähe die Vergangenheit falsch vollständig aus.
//
// Dazwischen stehen die **nachgetragenen** Zeilen (quelle='nachtrag',
// scripts/anmeldestand_nachtragen.py, Migration
// db/2026-10-16_ws_anmeldestand_nachtrag.sql): die AC/BC der Wochen vor dem
// 16.10.2026, rekonstruiert aus den Scan- und Planungsstand-Belegen des
// Dienstes. Sie tragen positives Wissen ("er stand auf BC") und **deckeln die
// Woche nicht ab**: ein Nachtrag ist ein Stand zu einem Zeitpunkt, und wer
// sich danach noch angemeldet hat, steht in keinem Beleg. Belegt ist das an
// `Ben_the_men` am 09.10.2026 — der Suchlauf von 16 h vor dem Anmeldeschluss
// führt ihn nicht, `ws_priority` hat für die Woche trotzdem seinen Stempel.
// Darum gilt: fehlt ein Name in einer nachgetragenen Woche, bleibt es bei
// "unbekannt" statt "nicht angemeldet".

// Acht Wochen, nicht sechs: der Nachtrag vom 16.10.2026 reicht bis zum
// 04.09.2026 zurück (sieben Freitage), und eine Spalte, die niemand sehen
// kann, ist keine Historie. Die Tabelle steht in `.scroll-x` — am Handy wird
// sie gewischt, nicht gequetscht.
export const ANM_WOCHEN=8;

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

// Nur eine Zeile vom **Kader-Lock** deckt eine Woche ab. Ein Nachtrag zählt
// hier ausdrücklich nicht: er ist ein Stand zu einem Zeitpunkt und kennt
// niemanden, der sich danach noch gemeldet hat (siehe Kopf, `Ben_the_men`).
function anmWocheGedeckt(mode,eventDate){
  return(APP.data.anmeldestand||[]).some(
    r=>r.mode===mode&&r.event_date===eventDate&&(r.quelle||'lock')==='lock');
}

// Der Zeitpunkt, für den ein Nachtrag dieser Woche gilt — der jüngste, wenn
// mehrere Belege zusammenkamen. `null`, wenn die Woche keinen Nachtrag hat.
// Die Oberfläche nennt ihn im Titel: ein Stand von Mittwoch ist nicht der
// Schlussstand vom Donnerstag 04:00.
export function anmWocheStand(mode,eventDate){
  return(APP.data.anmeldestand||[])
    .filter(r=>r.mode===mode&&r.event_date===eventDate&&r.quelle==='nachtrag'&&r.stand_um)
    .map(r=>r.stand_um).sort().pop()||null;
}

// Wert eines Spielers an einem Freitag. Rückgabe {wert,quelle}:
//   quelle 'anmeldestand' → voller Wert, inkl. AC/BC/ABC, vom Kader-Lock.
//   quelle 'nachtrag'     → derselbe Wert, aber aus einem Beleg rekonstruiert;
//                           gilt für `anmWocheStand()`, nicht für den Schluss.
//   quelle 'teilnahme'    → aus ws_participation rekonstruiert, nur A/AE/B/BE.
//   quelle 'leer'         → Woche ist per Kader-Lock erfasst, dieser Name fehlt
//                           darin → echt nicht angemeldet.
//   quelle 'unbekannt'    → kein Beleg und keine Teilnahme-Zeile: könnte
//                           AC/BC/ABC oder "gar nicht angemeldet" sein.
export function anmWert(name,mode,eventDate){
  const snap=(APP.data.anmeldestand||[]).find(
    r=>r.player_name===name&&r.mode===mode&&r.event_date===eventDate);
  if(snap)return{wert:snap.wert,quelle:snap.quelle==='nachtrag'?'nachtrag':'anmeldestand'};
  // **Die Teilnahme-Zeile steht vor dem "leer".** Sie ist der fixierte Kader
  // und damit härter als "steht nicht in der Liste" — ein Nachtrag schreibt
  // für eine fixierte Woche ohnehin nur die C-Werte
  // (scripts/anmeldestand_nachtragen.py), die Plätze kommen von hier.
  // Beide Team-Events desselben Tages durchsuchen — nicht nur das erste
  // gefundene. Ein Freitag hat immer zwei Events (Team A und B).
  const evs=(APP.data.events||[]).filter(e=>e.event_date===eventDate&&e.mode===mode);
  for(const ev of evs){
    const p=(APP.data.participation||[]).find(x=>x.event_id===ev.id&&x.player_name===name);
    if(p)return{wert:p.substitute?ev.team+'E':ev.team,quelle:'teilnahme'};
  }
  if(anmWocheGedeckt(mode,eventDate))return{wert:null,quelle:'leer'};
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

// Die Beweisbilder für eine Zelle (Spieler × Woche) — neueste zuerst. Mehrere
// sind normal: ein Suchlauf und ein Scroll-Lauf können beide etwas zu
// derselben Woche sagen, und auch ein einzelner Scan-Typ läuft öfter als
// einmal die Woche. Ohne `bild` — das holt `anmBelegBild` erst beim Ansehen.
export function anmBelegeFuer(name,mode,eventDate){
  return(APP.data.anmeldebeleg||[])
    .filter(r=>r.player_name===name&&r.mode===mode&&r.event_date===eventDate)
    .sort((a,b)=>b.erkannt_um.localeCompare(a.erkannt_um));
}

const _bildCache=new Map();
// Das Bild selbst, erst auf Nachfrage geholt (id aus anmBelegeFuer). Gecacht
// für die Sitzung — dasselbe Bild zweimal anzusehen soll nicht zweimal laden.
export async function anmBelegBild(id){
  if(_bildCache.has(id))return _bildCache.get(id);
  const rows=await sbGet('ws_anmeldebeleg?id=eq.'+id+'&select=bild');
  const bild=rows&&rows[0]?rows[0].bild:null;
  if(bild)_bildCache.set(id,bild);
  return bild;
}

// Schreibt den vollen Anmeldestand einer Woche fest — jeden Eintrag aus dem
// übergebenen teamAssign (APP.teamAssign bzw. APP.csTeamAssign), nicht nur die
// mit Platz. `on_conflict` macht aus einem zweiten Aufruf für dieselbe Woche
// ein No-Op: schon geschriebene Zeilen bleiben die endgültige Fassung, eine
// spätere Umplanung schreibt die Historie nicht um — dieselbe Haltung wie bei
// ws_participation.
// **Der Schlussstand verdrängt einen Nachtrag — ein zweiter Lock aber nicht
// den ersten.** Beides zugleich geht mit `ignore-duplicates` allein nicht: eine
// nachgetragene Zeile (quelle='nachtrag') würde die echte still abweisen, und
// in der Historie stünde für immer der Stand von Mittwoch statt der vom
// Anmeldeschluss. Deshalb erst die Nachträge dieser Woche weg, dann schreiben.
export async function anmeldestandSchreiben(teamAssign,mode,eventDate){
  const rows=Object.entries(teamAssign||{})
    .filter(([,w])=>REG_WERTE.includes(w))
    .map(([player_name,wert])=>({player_name,mode,event_date:eventDate,wert}));
  if(!rows.length)return;
  // Scheitert das Löschen, wird trotzdem geschrieben: eine Woche ohne
  // Historie ist schlechter als eine mit dem älteren Nachtrag.
  await sbDelete('ws_anmeldestand',
    `mode=eq.${mode}&event_date=eq.${eventDate}&quelle=eq.nachtrag`)
    .catch(e=>console.warn('Nachtrag nicht ersetzbar:',(e&&e.message)||e));
  await sbPost('ws_anmeldestand?on_conflict=alliance_id,player_name,mode,event_date',
    rows,{prefer:'resolution=ignore-duplicates,return=minimal'});
  APP.data.anmeldestand=[...(APP.data.anmeldestand||[]).filter(
    r=>!(r.mode===mode&&r.event_date===eventDate
         &&(r.quelle==='nachtrag'||rows.some(x=>x.player_name===r.player_name)))),
    ...rows];
}
