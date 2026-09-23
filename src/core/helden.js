import { APP } from './state.js';
import { T1_TYP } from './players.js';
import { sbUpsert, sbDelete } from './api.js';

// ── HELDEN-BESETZUNG ─────────────────────────────────────────────────────
// Welcher Held (Name) in welchem Platz einer der vier Truppen steht, siehe
// db/2026-09-20_ws_player_heroes.sql. Der Typ (Tank/Air/Missile) kommt aus
// dem serverweiten Katalog lw_helden (db/2026-09-20_lw_helden.sql) — ein Held
// heißt in jeder Allianz gleich.
export function heldenKatalog(){return APP.data.heldenKatalog||[];}
export function heldTyp(name){
  const h=heldenKatalog().find(x=>x.name===name);
  return h?h.typ:null;
}
export function heldenVon(playerName){
  return(APP.data.heldenBesetzung||[]).filter(h=>h.player_name===playerName);
}

// Ein Auswahlfeld für einen Heldenslot: Katalog + der aktuell gespeicherte
// Name, auch wenn er (noch) nicht im Katalog steht — sonst verschwindet ein
// unbekannter, aber schon zugeordneter Name beim nächsten Rendern.
export function heldSelect(id,val){
  const namen=heldenKatalog().map(h=>h.name).sort((a,b)=>a.localeCompare(b));
  if(val&&!namen.includes(val))namen.push(val);
  const mark=n=>{const t=T1_TYP[heldTyp(n)];return t?t.s+' ':'';};
  return`<select class="fi" id="${id}" style="padding:6px 8px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:12px;font-family:inherit;outline:none;background:#fff">
    <option value=""${val?'':' selected'}>– unbekannt –</option>
    ${namen.map(n=>`<option value="${n.replace(/"/g,'&quot;')}"${val===n?' selected':''}>${mark(n)}${n}</option>`).join('')}
  </select>`;
}

// zuordnung: [{truppe,slot,held}] für alle 20 Plätze, held='' heißt leer.
// Gesetzte Plätze werden upgeserted, geleerte gezielt gelöscht — sonst hängt
// eine zurückgenommene Zuordnung als alte Zeile weiter herum.
export async function saveHeldenBesetzung(playerName,zuordnung){
  const gesetzt=zuordnung.filter(z=>z.held);
  const leer=zuordnung.filter(z=>!z.held);
  if(gesetzt.length){
    await sbUpsert('ws_player_heroes',gesetzt.map(z=>({
      player_name:playerName,truppe:z.truppe,slot:z.slot,held:z.held,typ:heldTyp(z.held)||null,
    })),'alliance_id,player_name,truppe,slot');
  }
  for(const z of leer){
    await sbDelete('ws_player_heroes','player_name=eq.'+encodeURIComponent(playerName)+'&truppe=eq.'+z.truppe+'&slot=eq.'+z.slot).catch(()=>{});
  }
}
