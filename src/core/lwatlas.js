import { sbGet } from './api.js';
import { serverOf, suchmuster } from './basen.js';

// ══════════════════════════════════════════════════════════════════
//  SPIELER UND ALLIANZEN DES SERVERS — Leseseite von LW Atlas
// ══════════════════════════════════════════════════════════════════
// Gefüllt werden `lwa_spieler` und `lwa_allianzen` von `scripts/lwatlas/sync.py`
// aus api.lwatlas.com. Anders als `karte_basen` stammt das nicht aus unserer
// Texterkennung, sondern aus den Spieldaten selbst — Namen in japanischer,
// kyrillischer und chinesischer Schrift stehen deshalb richtig da.
//
// **Der Zuschnitt ist der Server, nicht die Allianz** — dieselbe Begründung wie
// bei `basen.js`, und genau wie dort steht jede Abfrage hier an einer Stelle.
// Die Tabellen stehen nicht in `TENANT_TABLES`; `api.js` hängt ihnen also keine
// `alliance_id` an, und alle Aufrufe laufen mit `{scoped:false}`.
//
// **Der Schlüssel ist `player_uid`, nicht der Name.** Wer sich umbenennt, bleibt
// dieselbe Zeile. Das ist keine Feinheit: beim ersten Abgleich am 12.09.2026 war
// die Hälfte der vermeintlichen Abgänge in Wahrheit eine Umbenennung mit
// Sonderzeichen (`SINNER` → `ꜱɪɴɴᴇʀ`, `ERZAN` → `ΞRζλη`).

export { serverOf, suchmuster };

const FELDER='player_uid,name,level,allianz,alliance_id,rang,x,y,power,army_power,army_kill,last_active_at,gesehen_at';

// `muster` ist das Ergebnis von `suchmuster` — null heißt „alles zeigen".
//
// Gesucht wird **in der Datenbank**: ein Server hat achttausend Spieler, und die
// alle zu laden, um zwanzig zu zeigen, wäre am Handy spürbar. Sortiert wird nach
// Kills, denn danach wird hier gesucht — wer gefährlich ist, steht oben.
export async function lwaSpielerSuchen(muster,{limit=200,allianz=null,sortierung='army_kill'}={}){
  const srv=serverOf();
  if(!srv)return {rows:[],server:null};
  let p=`lwa_spieler?server=eq.${encodeURIComponent(srv)}&select=${FELDER}`;
  if(muster)p+=`&name=ilike.${encodeURIComponent(muster)}`;
  if(allianz)p+=`&alliance_id=eq.${encodeURIComponent(allianz)}`;
  p+=`&order=${sortierung}.desc.nullslast,name.asc&limit=${limit+1}`;
  const rows=await sbGet(p,{scoped:false});
  // Eine Zeile mehr geholt als gezeigt wird: nur so ist zu erkennen, ob die
  // Liste abgeschnitten ist. Ohne das stünde „200 Treffer" da, wenn es 8000 sind.
  const mehr=rows.length>limit;
  return {rows:mehr?rows.slice(0,limit):rows,mehr,server:srv};
}

// Die Allianzen des Servers, die stärksten zuerst. Es sind rund achtzig — die
// passen in eine Anfrage, anders als die Spieler.
export async function lwaAllianzen(){
  const srv=serverOf();
  if(!srv)return {rows:[],server:null};
  const rows=await sbGet(
    `lwa_allianzen?server=eq.${encodeURIComponent(srv)}`
    +`&select=alliance_id,tag,mitglieder,gemeldet,power,kills,gescannt_at`
    +`&order=kills.desc.nullslast,tag.asc&limit=300`,{scoped:false});
  return {rows,server:srv};
}

export async function lwaAllianz(allianceId){
  const srv=serverOf();
  if(!srv)return null;
  const r=await sbGet(
    `lwa_allianzen?server=eq.${encodeURIComponent(srv)}`
    +`&alliance_id=eq.${encodeURIComponent(allianceId)}`
    +`&select=alliance_id,tag,mitglieder,gemeldet,power,kills,gescannt_at`,{scoped:false});
  return Array.isArray(r)&&r.length?r[0]:null;
}

// Wie viele Spieler der Server kennt — für die leere Seite („noch kein Abruf").
export async function lwaAnzahl(){
  const srv=serverOf();
  if(!srv)return 0;
  const r=await sbGet(`lwa_spieler?server=eq.${encodeURIComponent(srv)}&select=player_uid&limit=1`,
                      {scoped:false});
  return Array.isArray(r)?r.length:0;
}
