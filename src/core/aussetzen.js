import { renderPage } from '../app/render.js';
import { sbDelete, sbGet } from './api.js';
import { canAccess } from './helpers.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  AUSSETZEN — wer beim nächsten Wüstensturm nicht eingeplant wird
// ══════════════════════════════════════════════════════════════════
//
// Wer im fixierten Kader stand und im Kampfergebnis fehlt, setzt beim nächsten
// Event aus. Eingetragen wird das vom Dienst, der das Ergebnis aus dem Spiel
// liest (scripts/ws_service/eintragen.py) — eine Zeile je Spieler und Event,
// bei dem er aussetzt (db/2026-09-11_ws_aussetzen.sql).
//
// **Die Marke schlägt vor, sie teilt nicht ein** — dieselbe Haltung wie die
// Prioliste. Eingeteilt wird im Spiel; das Tool zeigt neben dem Namen, wer
// diesmal aussetzt und warum. Die Knöpfe bleiben bedienbar: wer sich nachträglich
// entschuldigt hat, soll trotzdem eingeplant werden können.
//
// Aufheben löscht die Zeile. Das ist Absicht und keine Geschichtsfälschung:
// dass er gefehlt hat, steht weiter in ws_participation (played=false).

export function aussetzenRows(){return APP.data.aussetzen||[];}
// Die Zeile für genau dieses Event — `eventDate` ist der Freitag, um den es geht.
export function aussetzenFuer(name,mode,eventDate){
  return aussetzenRows().find(r=>r.player_name===name&&r.mode===mode&&r.event_date===eventDate)||null;
}

export async function aussetzenPull(){
  try{APP.data.aussetzen=await sbGet('ws_aussetzen?order=event_date.desc');}
  catch(e){APP.data.aussetzen=[];console.warn('Aussetzen nicht ladbar:',(e&&e.message)||e);}
}

// Reihenfolge (mode, eventDate, name): die Anmeldezeile hängt den Namen hinten an
// einen Aufruf-Präfix, den die jeweilige Ansicht vorgibt (ctx.aussetzenAuf).
export async function aussetzenAufheben(mode,eventDate,name){
  if(!canAccess(mode==='cs'?'cs':'ws'))return;
  if(!confirm(`Aussetzen für ${name} aufheben? Danach lässt sich der Spieler wieder einplanen.`))return;
  try{
    await sbDelete('ws_aussetzen',
      `player_name=eq.${encodeURIComponent(name)}&mode=eq.${mode}&event_date=eq.${eventDate}`);
    await aussetzenPull();
    renderPage();
  }catch(e){alert('Fehler: '+((e&&e.message)||e));}
}
