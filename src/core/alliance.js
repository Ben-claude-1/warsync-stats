import { renderShell } from '../app/shell.js';
import { sbGet, sbPatch, sbPostRet } from './api.js';
import { ALLIANCE_LS, plannerCancelPending } from './auth.js';
import { canAccess } from './helpers.js';
import { APP, resetTenantState } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  ALLIANZEN — anlegen und zwischen ihnen umschalten
// ══════════════════════════════════════════════════════════════════
// Zwei Allianzen im selben Werkzeug sind vollständig getrennt: der Admin der
// einen sieht und ändert nichts an der anderen. Sichtbar wird das an genau zwei
// Stellen — der Filter in core/api.js trennt die Daten, canAccess('alliances')
// trennt die Verwaltung.
//
// Umschalten darf nur der Super-Admin. Für alle anderen ist APP.alliances
// ohnehin auf die eigene Allianz zusammengestrichen (siehe anmeldenAls).

export async function switchAlliance(id){
  if(!canAccess('alliances'))return;
  if(!id||id===APP.allianceId)return;
  if(!APP.alliances.some(a=>a.id===id)){alert('Unbekannte Allianz.');return;}
  // Erst die ausstehenden Schreibvorgänge abräumen, dann umschalten. Ein noch
  // wartender Planungsstand gehört der alten Allianz und hat in der neuen nichts
  // verloren; plannerPush prüft das zusätzlich beim Ausführen.
  plannerCancelPending();
  resetTenantState();
  APP.allianceId=id;
  try{localStorage.setItem(ALLIANCE_LS,id);}catch(e){}
  // Untersichten zurück auf Anfang: ein Ereignis-Aufriss der alten Allianz zeigt
  // in der neuen ins Leere.
  APP.wsView='anmeldung';APP.csView='aufstellung';APP.team='A';APP.csTeam='A';
  // renderShell startet loadData, weil resetTenantState synced auf false gesetzt hat.
  renderShell();
}

export async function createAlliance(tag,name,server){
  tag=(tag||'').trim();
  if(!tag)throw new Error('Allianz-Tag fehlt.');
  const[neu]=await sbPostRet('alliances',{tag,name:(name||'').trim()||null,server:(server||'').trim()||null},{scoped:false});
  APP.alliances=await sbGet('alliances?order=tag.asc',{scoped:false});
  return neu;
}

// Stilllegen statt löschen: an einer Allianz hängen Ereignisse, Teilnahmen und
// Verläufe. Ein Löschen risse die per ON DELETE CASCADE mit — das wäre kein
// Verwaltungsschritt mehr, sondern ein Datenverlust.
export async function setAllianceActive(id,val){
  await sbPatch('alliances','id=eq.'+encodeURIComponent(id),{active:!!val},{scoped:false});
  const a=APP.alliances.find(x=>x.id===id);
  if(a)a.active=!!val;
}
export async function renameAlliance(id,tag,name,server){
  const upd={};
  if(tag!==undefined)upd.tag=String(tag).trim();
  if(name!==undefined)upd.name=String(name).trim()||null;
  if(server!==undefined)upd.server=String(server).trim()||null;
  await sbPatch('alliances','id=eq.'+encodeURIComponent(id),upd,{scoped:false});
  APP.alliances=await sbGet('alliances?order=tag.asc',{scoped:false});
}

// ── Spieler in eine andere Allianz kopieren ──────────────────────────────────
// Für den Wechsel eines Menschen zwischen zwei Allianzen. Kopiert wird das
// Profil samt Passwort, NICHT die Historie: Teilnahmen und Stärkeverlauf gehören
// zu der Allianz, in der sie entstanden sind. Die alte Zeile bleibt stehen —
// sonst verlöre die alte Allianz die Namenszuordnung ihrer eigenen Statistik.
export async function copyPlayerToAlliance(name,zielId,{allianceAdmin=false}={}){
  if(!canAccess('alliances'))throw new Error('Nur der Super-Admin darf Spieler zwischen Allianzen kopieren.');
  const[src]=await sbGet('ws_players?name=eq.'+encodeURIComponent(name)+'&limit=1');
  if(!src)throw new Error('Spieler „'+name+'" nicht in dieser Allianz gefunden.');
  const vorhanden=await sbGet('ws_players?name=eq.'+encodeURIComponent(name)+'&select=name',{alliance:zielId});
  if(vorhanden.length)throw new Error('„'+name+'" steht in der Zielallianz bereits.');
  const{id,created_at,alliance_id,...rest}=src;
  await sbPostRet('ws_players',{...rest,alliance_id:zielId,alliance_admin:allianceAdmin,active:true},{alliance:zielId});
  return true;
}
