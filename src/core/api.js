import { KEY, SB } from './config.js';

// ====== SUPABASE ======
export async function sbGet(p){const r=await fetch(SB+'/rest/v1/'+p,{headers:{'apikey':KEY,'Authorization':'Bearer '+KEY}});if(!r.ok)throw new Error(await r.text());return r.json();}
// Holt eine Tabelle vollständig, in Blöcken. PostgREST deckelt jede Antwort
// (PGRST_DB_MAX_ROWS=1000), und ein festes `limit=N` im Aufruf schneidet still
// ab: der Verlauf hörte dann einfach vorne auf, ohne Fehlermeldung. Genau das
// war bei ws_player_history der Fall, sobald die Tabelle über 500 Zeilen wuchs.
// `max` ist nur die Reißleine gegen eine Tabelle, die niemand mehr überblickt.
export async function sbGetAll(p,{chunk=1000,max=20000}={}){
  const sep=p.includes('?')?'&':'?';
  const out=[];
  for(let off=0;off<max;off+=chunk){
    const teil=await sbGet(`${p}${sep}limit=${chunk}&offset=${off}`);
    out.push(...teil);
    if(teil.length<chunk)return out;
  }
  console.warn(`sbGetAll: Obergrenze von ${max} Zeilen erreicht — ${p} wird abgeschnitten.`);
  return out;
}
export async function sbPost(t,d){const r=await fetch(SB+'/rest/v1/'+t,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbPatch(t,q,d){const r=await fetch(SB+'/rest/v1/'+t+'?'+q,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbDelete(t,q){const r=await fetch(SB+'/rest/v1/'+t+'?'+q,{method:'DELETE',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY}});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbUpsert(t,d,onConflict){const url=SB+'/rest/v1/'+t+(onConflict?'?on_conflict='+encodeURIComponent(onConflict):'');const r=await fetch(url,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
