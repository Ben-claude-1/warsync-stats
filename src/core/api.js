import { KEY, SB } from './config.js';

// ====== SUPABASE ======
export async function sbGet(p){const r=await fetch(SB+'/rest/v1/'+p,{headers:{'apikey':KEY,'Authorization':'Bearer '+KEY}});if(!r.ok)throw new Error(await r.text());return r.json();}
export async function sbPost(t,d){const r=await fetch(SB+'/rest/v1/'+t,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbPatch(t,q,d){const r=await fetch(SB+'/rest/v1/'+t+'?'+q,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbDelete(t,q){const r=await fetch(SB+'/rest/v1/'+t+'?'+q,{method:'DELETE',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY}});if(!r.ok)throw new Error(await r.text());return r;}
export async function sbUpsert(t,d,onConflict){const url=SB+'/rest/v1/'+t+(onConflict?'?on_conflict='+encodeURIComponent(onConflict):'');const r=await fetch(url,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(d)});if(!r.ok)throw new Error(await r.text());return r;}
