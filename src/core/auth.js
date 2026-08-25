import { renderPage } from '../app/render.js';
import { renderShell } from '../app/shell.js';
import { sbGet, sbGetAll, sbUpsert } from './api.js';
import { canAccess } from './helpers.js';
import { APP } from './state.js';
import { AID } from './tenant.js';
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
  // Zu welcher Allianz dieser Stand gehört, entscheidet sich JETZT und nicht erst
  // beim Ausführen. Sonst schriebe ein Wechsel der Ansicht während der Wartezeit
  // die Aufstellung der einen Allianz in die andere.
  const aid=AID();
  // Entprellt: Slider und Drag&Drop lösen sonst pro Pixel einen Upsert aus.
  clearTimeout(_plannerTimers[key]);
  _plannerTimers[key]=setTimeout(async()=>{
    if(AID()!==aid)return;   // Ansicht ist inzwischen umgeschaltet — verworfen
    try{
      await sbUpsert('ws_planner_state',{key,data:payload,updated_by:APP.user?APP.user.playerName:null},'alliance_id,key',{alliance:aid});
      APP.planner[key]=payload;
    }catch(e){console.warn('Planungsstand nicht gespeichert ('+key+'):',e.message);setSyncDot('err');}
  },delay===undefined?900:delay);
}
// Beim Wechsel der Allianz: alles Ausstehende fällt weg. Der Stand liegt bereits
// im localStorage der alten Allianz, verloren geht dadurch nichts.
export function plannerCancelPending(){
  Object.keys(_plannerTimers).forEach(k=>clearTimeout(_plannerTimers[k]));
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
// ── ANMELDUNG ─────────────────────────────────────────────────────────────────
// Der Spielername ist seit der Trennung in Allianzen nur noch INNERHALB einer
// Allianz eindeutig — derselbe Mensch kann in zweien stehen. Die Anmeldung sucht
// deshalb über alle Allianzen (`scoped:false`) und entscheidet danach, welche
// Zeile gemeint ist.
export const ALLIANCE_LS='ws_alliance_id';
// Kandidaten aus dem letzten Anmeldeversuch, falls der Nutzer noch die Allianz
// wählen muss. Modul-lokal, weil die Auswahl aus einem onclick zurückkommt.
let _loginWahl=null;

function benutzerAus(pl){
  const roleMap={R5:'r5',R4:'r4',R3:'r3',R2:'r2',R1:'r1'};
  return{
    username:pl.name.toLowerCase().replace(/\s/g,'_'),
    playerName:pl.name,
    // Super-Admin steht als Spalte in der DB, nicht mehr als Name im Quelltext.
    role:pl.super_admin?'superadmin':(roleMap[pl.role]||'r3'),
    allianceId:pl.alliance_id,
    superAdmin:!!pl.super_admin,
    allianceAdmin:!!pl.alliance_admin,
    ws_admin:pl.ws_admin||false,
    profile_edit:pl.profile_edit||false,
    can_reset_password:pl.can_reset_password||false,
  };
}
// Welche Allianz nach der Anmeldung gezeigt wird: für alle die eigene, für den
// Super-Admin die zuletzt gewählte (er springt sonst bei jedem Laden zurück).
function starterAllianz(user,alle){
  if(user.superAdmin){
    const merk=localStorage.getItem(ALLIANCE_LS);
    if(merk&&alle.some(a=>a.id===merk))return merk;
  }
  return user.allianceId;
}
export function anmeldenAls(pl,alle){
  APP.user=benutzerAus(pl);
  // Wer kein Super-Admin ist, sieht nur die eigene Allianz — auch in der Auswahl.
  APP.alliances=APP.user.superAdmin?alle:alle.filter(a=>a.id===pl.alliance_id);
  APP.allianceId=starterAllianz(APP.user,alle);
  renderShell();loadData();
}
export function loginWaehleAllianz(i){
  if(!_loginWahl)return;
  const pl=_loginWahl.kandidaten[i];
  if(pl)anmeldenAls(pl,_loginWahl.alliances);
}
export async function doLogin(){
  const name=(document.getElementById('lu')?.value||'').trim();
  const pw=document.getElementById('lp')?.value||'';
  if(!name||!pw){showLoginErr('Bitte Name und Passwort eingeben.');return;}
  const btn=document.getElementById('login-btn');
  const fertig=()=>{if(btn){btn.textContent='Anmelden';btn.disabled=false;}};
  if(btn){btn.textContent='Anmelden…';btn.disabled=true;}
  try{
    const hash=await sha256(pw);
    // ilike = case-insensitive name match
    const[rows,alle]=await Promise.all([
      sbGet('ws_players?name=ilike.'+encodeURIComponent(name)+'&select=name,alliance_id,role,ws_admin,profile_edit,password_hash,access_enabled,can_reset_password,super_admin,alliance_admin',{scoped:false}),
      sbGet('alliances?active=is.true&order=tag.asc',{scoped:false}),
    ]);
    if(!rows||!rows.length){showLoginErr('Spieler „'+name+'" nicht gefunden.');fertig();return;}
    const passend=rows.filter(p=>p.password_hash&&p.password_hash===hash);
    if(!passend.length){
      showLoginErr(rows.every(p=>!p.password_hash)
        ?'Kein Passwort gesetzt — Admin muss zuerst eines vergeben.'
        :'Falsches Passwort.');
      fertig();return;
    }
    let frei=passend.filter(p=>p.access_enabled);
    if(!frei.length){showLoginErr('Kein Zugang — wende dich an den Admin.');fertig();return;}
    // Feste Reihenfolge nach Allianz-Tag: sonst hinge es an der Laune der Datenbank,
    // in welcher Allianz jemand landet, der in zweien steht.
    const tagVon=id=>alle.find(a=>a.id===id)?.tag||'';
    frei=[...frei].sort((a,b)=>tagVon(a.alliance_id).localeCompare(tagVon(b.alliance_id)));
    // Der Super-Admin kommt immer über seine Super-Admin-Zeile herein; er kann die
    // Ansicht danach ohnehin umschalten und soll nicht jedes Mal gefragt werden.
    const sa=frei.find(p=>p.super_admin);
    if(sa||frei.length===1){anmeldenAls(sa||frei[0],alle);return;}
    // Derselbe Name mit demselben Passwort in mehreren Allianzen: nachfragen statt
    // raten. Stillschweigend die erste zu nehmen hieße, jemanden in der falschen
    // Allianz arbeiten zu lassen, ohne dass er es merkt.
    _loginWahl={kandidaten:frei,alliances:alle};
    zeigeAllianzWahl(frei,alle);
    fertig();
  }catch(e){showLoginErr('Fehler: '+e.message);fertig();}
}
function zeigeAllianzWahl(kandidaten,alle){
  const el=document.getElementById('login-err');
  if(!el)return;
  const tag=id=>{const a=alle.find(x=>x.id===id);return a?(a.tag+(a.server?' '+a.server:'')):'?';};
  el.style.display='block';
  el.style.background='#f4f6fb';el.style.color='var(--tx)';el.style.borderLeftColor='var(--acc)';
  el.innerHTML='<div style="font-weight:700;margin-bottom:8px">Für welche Allianz anmelden?</div>'
    +kandidaten.map((p,i)=>`<button class="btn btn-out btn-sm" style="width:100%;margin-bottom:6px" onclick="loginWaehleAllianz(${i})">${tag(p.alliance_id)}</button>`).join('');
}
export function showLoginErr(msg){
  const el=document.getElementById('login-err');
  if(!el)return;
  // Zurück auf Fehler-Optik: die Allianz-Auswahl färbt dasselbe Feld um.
  el.style.background='#fdecea';el.style.color='var(--loss)';el.style.borderLeftColor='var(--loss)';
  el.textContent=msg;el.style.display='block';
}

export async function loadData(){
  setSyncDot('wait');
  if(!AID()){APP.syncErr=true;setSyncDot('err');console.error('loadData ohne Allianz');renderPage();return;}
  try{
    // Die Allianzliste kommt bei jedem Laden frisch mit: eine neu angelegte
    // Allianz soll ohne Neuanmeldung im Umschalter auftauchen.
    sbGet('alliances?order=tag.asc',{scoped:false})
      .then(all=>{APP.alliances=APP.user?.superAdmin?all:all.filter(a=>a.id===APP.user?.allianceId);})
      .catch(e=>console.warn('Allianzen nicht ladbar:',e.message));
    const[ev,pa,pl,hist,vsw,vse,zug]=await Promise.all([
      sbGet('ws_events?order=event_date.desc,team.asc'),
      sbGet('ws_participation?order=rank.asc'),
      sbGet('ws_players?order=t1.desc.nullslast&select=*,access_enabled,password_hash'),
      // Vollständig, nicht die jüngsten 500: sonst fehlt der Anfang jedes
      // Verlaufs, sobald die Tabelle über die Grenze wächst — siehe sbGetAll.
      sbGetAll('ws_player_history?order=recorded_at.desc'),
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
