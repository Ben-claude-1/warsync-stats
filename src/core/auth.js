import { renderPage } from '../app/render.js';
import { renderShell } from '../app/shell.js';
import { sbGet, sbUpsert } from './api.js';
import { canAccess } from './helpers.js';
import { APP } from './state.js';
import { loadWSState, saveWSState } from '../ui/buildings.js';
import { csLoadState } from '../ui/cs.js';
import { wsRosterCheck } from '../ui/ws.js';

// ====== AUTH ======
// ── Geteilter Planungsstand (ws_planner_state) ─────────────────────────────────
// Aufstellung, Gebäude-Zuordnung, Kartenbild und Label-Positionen lagen früher nur
// im localStorage. Ergebnis: auf jedem Gerät eine andere Aufstellung — am Laptop die
// echte Planung, am Handy der leere Default. Jetzt ist die Tabelle die gemeinsame
// Quelle, localStorage bleibt als Offline-Puffer erhalten.
//
// Schreiben darf nur, wer die Sektion ohnehin bearbeiten darf. Der Check sitzt im
// Client (canAccess) — die Tabelle selbst steht wie alle anderen offen. Das ist keine
// echte Absicherung, sondern dieselbe Rechte-Logik wie im Rest der App.
export const PLANNER_KEYS=['ws','cs','karte','hive'];   // karte_bg wird bewusst erst beim Öffnen der Karte geholt (Base64, groß)
export const _plannerTimers={};
export function plannerCanWrite(key){return canAccess(key==='cs'?'cs':'ws');}
export function plannerPush(key,data,delay){
  if(!plannerCanWrite(key))return;
  // savedAt steckt im Payload selbst — verglichen wird später lokaler gegen geteilten
  // Stand, beides derselbe Feldtyp. Die Spalte updated_at setzt ein Trigger in der DB
  // und dient nur der Nachvollziehbarkeit, nicht dem Vergleich.
  const payload=data.savedAt?data:{...data,savedAt:new Date().toISOString()};
  // Entprellt: Slider und Drag&Drop lösen sonst pro Pixel einen Upsert aus.
  clearTimeout(_plannerTimers[key]);
  _plannerTimers[key]=setTimeout(async()=>{
    try{
      await sbUpsert('ws_planner_state',{key,data:payload,updated_by:APP.user?APP.user.playerName:null},'key');
      APP.planner[key]=payload;
    }catch(e){console.warn('Planungsstand nicht gespeichert ('+key+'):',e.message);setSyncDot('err');}
  },delay===undefined?900:delay);
}
export async function plannerPull(keys){
  try{
    const rows=await sbGet('ws_planner_state?key=in.('+keys.join(',')+')');
    rows.forEach(r=>{APP.planner[r.key]=r.data;});
  }catch(e){console.warn('Planungsstand nicht ladbar:',e.message);}
}
// Welcher Stand gilt: der aus der DB, außer der lokale wurde nachweislich später
// gespeichert (offline weitergeplant). Alte localStorage-Stände ohne savedAt zählen
// als älter — die DB gewinnt. Fehlt der DB-Satz ganz, gilt der lokale und wird
// hochgeschoben; dieses Gerät setzt damit den gemeinsamen Startstand.
// Ein leerer Stand darf einen gefüllten nie automatisch verdrängen. Sonst würde beim
// ersten Aufruf nach dem Umstieg das Gerät gewinnen, das zufällig zuerst lädt — und
// ein frisch geöffnetes Handy hätte die Planung vom Laptop gelöscht. Bewusstes Leeren
// (Aufstellung zurücksetzen, Wochen-Reset) läuft über saveWSState und ist davon nicht
// betroffen — dort will der Nutzer es ja.
export function plannerIsEmpty(key,d){
  if(!d)return true;
  if(key==='ws')return !['lineupA','lineupB'].some(k=>d[k]&&Object.values(d[k]).some(a=>Array.isArray(a)&&a.length));
  if(key==='cs')return !['csPlanA','csPlanB'].some(k=>d[k]&&Object.keys(d[k]).length);
  return false;
}
export function plannerResolve(key,lsKey){
  let local=null;
  try{const raw=localStorage.getItem(lsKey);local=raw?JSON.parse(raw):null;}catch(e){}
  const remote=APP.planner[key];
  if(!remote){if(local&&!plannerIsEmpty(key,local))plannerPush(key,local,0);return local;}
  if(plannerIsEmpty(key,local)&&!plannerIsEmpty(key,remote)){
    try{localStorage.setItem(lsKey,JSON.stringify(remote));}catch(e){}
    return remote;
  }
  const stamp=o=>(o&&o.savedAt&&Date.parse(o.savedAt))||0;
  // Lokal darf nur gewinnen, wenn dieses Gerät auch schreiben dürfte (offline weitergeplant).
  // Für alle anderen zählt immer der geteilte Stand, sonst sähe jeder seine eigenen Verschiebungen.
  if(local&&stamp(local)>stamp(remote)&&plannerCanWrite(key))return local;
  // DB gewinnt → lokal spiegeln, damit die App auch ohne Netz den richtigen Stand zeigt
  try{localStorage.setItem(lsKey,JSON.stringify(remote));}catch(e){}
  return remote;
}
export async function sha256(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function doLogin(){
  const name=(document.getElementById('lu')?.value||'').trim();
  const pw=document.getElementById('lp')?.value||'';
  if(!name||!pw){showLoginErr('Bitte Name und Passwort eingeben.');return;}
  const btn=document.getElementById('login-btn');
  if(btn){btn.textContent='Anmelden…';btn.disabled=true;}
  try{
    const hash=await sha256(pw);
    // ilike = case-insensitive name match
    const rows=await sbGet('ws_players?name=ilike.'+encodeURIComponent(name)+'&select=name,role,ws_admin,profile_edit,password_hash,access_enabled,can_reset_password');
    if(!rows||!rows.length){showLoginErr('Spieler „'+name+'" nicht gefunden.');if(btn){btn.textContent='Anmelden';btn.disabled=false;}return;}
    const pl=rows[0];
    if(!pl.access_enabled){showLoginErr('Kein Zugang — wende dich an den Admin.');if(btn){btn.textContent='Anmelden';btn.disabled=false;}return;}
    if(!pl.password_hash){showLoginErr('Kein Passwort gesetzt — Admin muss zuerst eines vergeben.');if(btn){btn.textContent='Anmelden';btn.disabled=false;}return;}
    if(pl.password_hash!==hash){showLoginErr('Falsches Passwort.');if(btn){btn.textContent='Anmelden';btn.disabled=false;}return;}
    const roleMap={R5:'r5',R4:'r4',R3:'r3',R2:'r2',R1:'r1'};
    const isSuperAdmin=pl.name==='Ben_the_men';
    APP.user={
      username:pl.name.toLowerCase().replace(/\s/g,'_'),
      playerName:pl.name,
      role:isSuperAdmin?'superadmin':(roleMap[pl.role]||'r3'),
      ws_admin:pl.ws_admin||false,
      profile_edit:pl.profile_edit||false,
      can_reset_password:pl.can_reset_password||false,
    };
    renderShell();loadData();
  }catch(e){showLoginErr('Fehler: '+e.message);if(btn){btn.textContent='Anmelden';btn.disabled=false;}}
}
export function showLoginErr(msg){
  const el=document.getElementById('login-err');
  if(el){el.textContent=msg;el.style.display='block';}
}

export async function loadData(){
  setSyncDot('wait');
  try{
    const[ev,pa,pl,hist,vsw,vse,zug]=await Promise.all([
      sbGet('ws_events?order=event_date.desc,team.asc'),
      sbGet('ws_participation?order=rank.asc'),
      sbGet('ws_players?order=t1.desc.nullslast&select=*,access_enabled,password_hash'),
      sbGet('ws_player_history?order=recorded_at.desc&limit=500'),
      sbGet('vs_weeks?order=week_start.desc'),
      sbGet('vs_entries?order=pts.desc'),
      sbGet('zug_rides?order=ride_date.asc').catch(()=>[]),
      plannerPull(PLANNER_KEYS),
    ]);
    APP.data={events:ev,participation:pa,players:pl,vsWeeks:vsw,vsEntries:vse,zugRides:zug};
    // Index history by player_name
    APP.playerHistory={};
    hist.forEach(h=>{
      if(!APP.playerHistory[h.player_name])APP.playerHistory[h.player_name]=[];
      APP.playerHistory[h.player_name].push(h);
    });
    APP.synced=true;APP.syncErr=false;setSyncDot('ok');
    loadWSState();
    csLoadState();
    if(!APP.accepted.length){APP.accepted=pl.filter(p=>p.active!==false).map(p=>p.name);}
    else{const _accSet=new Set(APP.accepted.map(n=>n.toLowerCase()));pl.filter(p=>p.active!==false&&!_accSet.has(p.name.toLowerCase())).forEach(p=>APP.accepted.push(p.name));}
    renderPage();
    // Anmeldeschluss Donnerstag 04:00 — nachgelagert, damit ein Fehler hier nie
    // das Rendern der Seite verhindert.
    wsRosterCheck().catch(e=>console.warn('Anmeldeschluss:',e&&e.message||e));
  }catch(err){APP.syncErr=true;setSyncDot('err');console.error(err);renderPage();}
}
export function setSyncDot(s){const d=document.getElementById('sd');if(d)d.className='sync-dot'+(s==='err'?' err':s==='wait'?' wait':'');}
