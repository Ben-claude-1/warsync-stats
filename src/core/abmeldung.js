import { renderPage } from '../app/render.js';
import { sbDelete, sbGet, sbUpsert } from './api.js';
import { canAccess } from './helpers.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  ABMELDUNG — wer vorher gesagt hat, dass er fehlen wird
// ══════════════════════════════════════════════════════════════════
//
// Das Gegenstück zur ⛔-Marke (core/aussetzen.js). Die entsteht **hinterher**,
// wenn jemand im Kader stand und nicht gespielt hat. Diese hier steht
// **vorher**: „ich kann diesen Freitag nicht".
//
// Sie ist nötig geworden, als der Fixplatz die ⛔-Marke schlagen durfte (siehe
// core/zuteilung.js). Ohne sie hieße „fest gesetzt" auch „darf folgenlos
// fehlen" — und genau das soll es nicht heißen. Wer vorher Bescheid gibt, wird
// nicht eingeplant und ist entschuldigt; wer wortlos wegbleibt, setzt weiterhin
// aus.
//
// **Eine eigene Tabelle, keine Spalte an ws_participation.** Die Aussage gilt
// einem künftigen Event, und dessen Teilnahme-Zeilen entstehen erst beim
// Anmeldeschluss — dieselbe Begründung wie bei der Prioliste und beim Aussetzen
// (db/2026-09-18_ws_abmeldung.sql).
//
// **Die Verbindung zu `excused` sitzt beim Einfrieren des Kaders**
// (wsFreezeTeam in ui/ws.js): steht ein Abgemeldeter trotzdem im Kader, wird
// seine Zeile mit `excused=true` geschrieben. Daran hängt die eigentliche
// Zusage — scripts/ws_service/eintragen.py schreibt für Entschuldigte keine
// ws_aussetzen-Zeile, er muss beim nächsten Mal also nicht aussetzen.

export function abmeldungRows(){return APP.data.abmeldung||[];}
// Die Zeile für genau dieses Event — `eventDate` ist der Tag, um den es geht.
export function abmeldungFuer(name,mode,eventDate){
  return abmeldungRows().find(r=>r.player_name===name&&r.mode===mode&&r.event_date===eventDate)||null;
}

export async function abmeldungPull(){
  try{APP.data.abmeldung=await sbGet('ws_abmeldung?order=event_date.desc');}
  catch(e){APP.data.abmeldung=[];console.warn('Abmeldungen nicht ladbar:',(e&&e.message)||e);}
}

// Ein Schalter, kein Formular: entweder steht die Abmeldung da oder nicht.
// Reihenfolge der Argumente wie bei aussetzenAufheben — die Anmeldezeile hängt
// den Namen hinten an einen Aufruf-Präfix, den die Ansicht vorgibt.
export async function abmeldungUmschalten(mode,eventDate,name){
  if(!canAccess(mode==='cs'?'cs':'ws'))return;
  const da=abmeldungFuer(name,mode,eventDate);
  try{
    if(da){
      await sbDelete('ws_abmeldung',
        `player_name=eq.${encodeURIComponent(name)}&mode=eq.${mode}&event_date=eq.${eventDate}`);
    }else{
      await sbUpsert('ws_abmeldung',[{player_name:name,mode,event_date:eventDate}],
        'alliance_id,player_name,mode,event_date');
    }
    await abmeldungPull();
    renderPage();
  }catch(e){alert('Fehler: '+((e&&e.message)||e));}
}
