import { KEY, SB } from './config.js';
import { AID, isTenant, tableOf } from './tenant.js';

// ====== SUPABASE ======
//
// ── Mandantentrennung ─────────────────────────────────────────────────────────
// Jede Anfrage an eine Tabelle aus TENANT_TABLES bekommt die aktuelle Allianz
// automatisch mitgegeben: GET/PATCH/DELETE als Filter, POST/UPSERT als Spalte im
// Datensatz.
//
// Der Filter sitzt bewusst HIER und nicht an den rund sechzig Aufrufstellen. Eine
// vergessene Stelle wäre still: sie lieferte die Daten der jeweils anderen Allianz
// mit oder überschriebe sie. An einer Stelle kann man es dagegen nicht vergessen.
//
// Wer bewusst über alle Allianzen hinweg arbeiten muss — die Anmeldung sucht den
// Spieler, bevor eine Allianz feststeht, und die Allianz-Verwaltung selbst —
// setzt `{scoped:false}`. Eine bestimmte fremde Allianz adressiert `{alliance:id}`.
const H={'apikey':KEY,'Authorization':'Bearer '+KEY};
const HJ={...H,'Content-Type':'application/json'};

function aidFor(opt){
  const aid=(opt&&opt.alliance)||AID();
  if(!aid)throw new Error('Keine Allianz gewählt — Abfrage abgebrochen.');
  return aid;
}
// Hängt den Allianz-Filter an einen Pfad. Ein bereits vorhandener Filter bleibt
// stehen: dann hat der Aufrufer bewusst eine Allianz benannt.
function scoped(path,opt){
  if(opt&&opt.scoped===false)return path;
  if(!isTenant(path))return path;
  if(/[?&]alliance_id=/.test(path))return path;
  return path+(path.includes('?')?'&':'?')+'alliance_id=eq.'+aidFor(opt);
}
// Schreibt die Allianz in jeden Datensatz. Ein Datensatz, der sie schon mitbringt,
// bleibt unangetastet — so kann die Verwaltung gezielt in eine andere Allianz
// schreiben (Spieler kopieren).
function stamped(table,data,opt){
  if(opt&&opt.scoped===false)return data;
  if(!isTenant(table))return data;
  const aid=aidFor(opt);
  const mark=r=>(r&&typeof r==='object'&&r.alliance_id)?r:{...r,alliance_id:aid};
  return Array.isArray(data)?data.map(mark):mark(data);
}
async function req(url,init){
  const r=await fetch(url,init);
  if(!r.ok)throw new Error(await r.text());
  return r;
}

export async function sbGet(p,opt){return(await req(SB+'/rest/v1/'+scoped(p,opt),{headers:H})).json();}
// Holt eine Tabelle vollständig, in Blöcken. PostgREST deckelt jede Antwort
// (PGRST_DB_MAX_ROWS=1000), und ein festes `limit=N` im Aufruf schneidet still
// ab: der Verlauf hörte dann einfach vorne auf, ohne Fehlermeldung. Genau das
// war bei ws_player_history der Fall, sobald die Tabelle über 500 Zeilen wuchs.
// `max` ist nur die Reißleine gegen eine Tabelle, die niemand mehr überblickt.
export async function sbGetAll(p,{chunk=1000,max=20000,...opt}={}){
  const sep=p.includes('?')?'&':'?';
  const out=[];
  for(let off=0;off<max;off+=chunk){
    const teil=await sbGet(`${p}${sep}limit=${chunk}&offset=${off}`,opt);
    out.push(...teil);
    if(teil.length<chunk)return out;
  }
  console.warn(`sbGetAll: Obergrenze von ${max} Zeilen erreicht — ${p} wird abgeschnitten.`);
  return out;
}
// `t` darf eine Abfrage mitbringen ('ws_events?on_conflict=…'); der Tabellenname
// davor entscheidet über die Mandantenprüfung.
export async function sbPost(t,d,opt){
  const prefer=(opt&&opt.prefer)||'return=minimal';
  return req(SB+'/rest/v1/'+t,{method:'POST',headers:{...HJ,'Prefer':prefer},body:JSON.stringify(stamped(tableOf(t),d,opt))});
}
// Wie sbPost, gibt aber die angelegten Zeilen zurück — für alles, was danach mit
// der erzeugten id weiterarbeitet (Event anlegen, Umfrage anlegen, VS-Woche).
export async function sbPostRet(t,d,opt){
  return(await sbPost(t,d,{...opt,prefer:'return=representation'})).json();
}
export async function sbPatch(t,q,d,opt){
  return req(SB+'/rest/v1/'+scoped(t+'?'+q,opt),{method:'PATCH',headers:HJ,body:JSON.stringify(d)});
}
// PATCH mit Rückgabe der geänderten Zeilen. Der Anmeldeschluss braucht das: nur
// wer eine Zeile zurückbekommt, hat die Sperre tatsächlich gesetzt.
export async function sbPatchRet(t,q,d,opt){
  return(await req(SB+'/rest/v1/'+scoped(t+'?'+q,opt),{method:'PATCH',headers:{...HJ,'Prefer':'return=representation'},body:JSON.stringify(d)})).json();
}
export async function sbDelete(t,q,opt){
  return req(SB+'/rest/v1/'+scoped(t+'?'+q,opt),{method:'DELETE',headers:H});
}
export async function sbUpsert(t,d,onConflict,opt){
  const url=SB+'/rest/v1/'+t+(onConflict?'?on_conflict='+encodeURIComponent(onConflict):'');
  return req(url,{method:'POST',headers:{...HJ,'Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(stamped(tableOf(t),d,opt))});
}
