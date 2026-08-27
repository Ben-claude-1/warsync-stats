import { renderPage } from '../app/render.js';
import { LANG, LOC } from './i18n.js';
import { ROLES, ROLE_C, isInactive } from './players.js';
import { APP } from './state.js';
import { saveWSState } from '../ui/buildings.js';
import { csSaveState } from '../ui/cs.js';

// ====== HELPERS ======
export function fmt(n){return n?Number(n).toLocaleString(LOC()):'–';}
export function fmtMio(n){if(!n&&n!==0)return'–';const m=n/1000000;return m.toLocaleString(LOC(),{minimumFractionDigits:1,maximumFractionDigits:1})+(LANG==='en'?'M':' Mio');}
export function badge(t,c){return`<span class="badge" style="background:${c}22;color:${c}">${t}</span>`;}
export function roleBadge(r){return badge(ROLES[r]||r,ROLE_C[r]||'#8892a4');}
// ── RECHTE ────────────────────────────────────────────────────────────────────
// Drei Stufen, seit die App mehrere Allianzen kennt:
//
//   superadmin      · über allen Allianzen. Darf umschalten, anlegen, stilllegen.
//   allianceAdmin   · Verwalter GENAU EINER Allianz. Innerhalb seiner Allianz
//                     alles, außerhalb nichts — er sieht die andere gar nicht.
//   Rang R1–R5      · wie bisher, aus dem Spiel übernommen.
//
// Die Trennung zwischen den Allianzen macht nicht diese Funktion, sondern der
// Filter in core/api.js: ein Allianz-Admin kann fremde Zeilen nicht einmal
// adressieren. canAccess entscheidet nur, WAS jemand darf, nicht WORAN.
export function isSuperAdmin(){return APP.user?.role==='superadmin';}
export function isAllianceAdmin(){return isSuperAdmin()||!!APP.user?.allianceAdmin;}

export function canAccess(f){
  const u=APP.user;if(!u)return false;
  // Nur der Super-Admin: Allianzen anlegen, stilllegen, Ansicht umschalten,
  // Spieler zwischen Allianzen kopieren, jemanden zum Super-Admin machen.
  if(f==='alliances')return u.role==='superadmin';
  // Alles Übrige gilt innerhalb der gerade gezeigten Allianz — und dort steht der
  // Allianz-Admin dem Super-Admin gleich.
  if(u.role==='superadmin'||u.allianceAdmin)return true;
  if(f==='ws')return u.role==='r5'||u.role==='r4';
  if(f==='cs')return u.role==='r5'||u.role==='r4';
  if(f==='ws_admin'){
    // WS-Admin: Verwalter oder Spieler mit ws_admin=true in DB
    const pl=APP.data.players.find(p=>p.name===u.playerName);
    return u.role==='r5'||(pl&&pl.ws_admin);
  }
  if(f==='profile_edit'){
    // Profil bearbeiten: Verwalter, r5, oder Spieler mit profile_edit=true
    const pl=APP.data.players.find(p=>p.name===u.playerName);
    return u.role==='r5'||(pl&&pl.profile_edit);
  }
  if(f==='allianz')return u.role==='r5'||u.role==='r4';
  if(f==='umfragen')return u.role==='r5'||u.role==='r4';
  if(f==='zugfahrt')return u.role==='r5'||u.role==='r4';
  // Der R5 führt die Allianz im Spiel und verwaltet sie deshalb auch hier: Zugänge,
  // Passwörter, Rechte. Super-Admin und Allianz-Admin sind oben schon durch.
  // Vergeben kann er nur, was in PERM_FELDER steht — `super_admin` gehört bewusst
  // nicht dazu und bleibt der Datenbank vorbehalten.
  if(f==='admin')return u.role==='r5';
  return true;
}
// Quote = gespielt / gemeldet. Ersatzspieler, die nicht gebraucht wurden, bleiben
// draußen — sonst drückt die Ersatzbank die Quote, obwohl niemand gefehlt hat.
// Ein eingesetzter Ersatzspieler zählt dagegen als gespielt.
export function reliability(name){
  const p=APP.data.participation.filter(x=>{const ev=APP.data.events.find(e=>e.id===x.event_id);return ev&&x.player_name===name;});
  const basis=p.filter(x=>!x.substitute||x.played);
  if(!basis.length)return null;
  return Math.round(basis.filter(x=>x.played).length/basis.length*100);
}
export function relColor(pct){if(pct===null)return'var(--tx3)';if(pct>=80)return'var(--win)';if(pct>=50)return'var(--acc)';return'var(--loss)';}
export function avgPts(name){const p=APP.data.participation.filter(x=>x.player_name===name&&x.played&&x.individual_pts);if(!p.length)return 0;return Math.round(p.reduce((s,x)=>s+(x.individual_pts||0),0)/p.length);}
export function getT1(name){return parseFloat(APP.data.players.find(p=>p.name===name)?.t1)||0;}

// ── KENNZAHL FÜR DIE AUTO-VERTEILUNG ──
// Wüstensturm und Schluchtsturm verteilen die Spieler nach Stärke. Welche
// Stärke gemeint ist, lässt sich pro Event umstellen: T1-Truppenstärke oder
// Gesamtkraft der Helden. Die Verteil-Logik selbst bleibt unberührt — sie
// arbeitet ausschließlich auf der Reihenfolge des Pools.
// Beide Werte werden in Mio geführt, damit Sortierung und Anzeige dieselbe
// Größenordnung haben (t1 steht so schon in der DB, hero_power absolut).
export function powerOf(name,mode){
  const p=APP.data.players.find(x=>x.name===name);
  if(!p)return 0;
  return mode==='hero'?(p.hero_power||0)/1e6:(parseFloat(p.t1)||0);
}
export function wsPower(n){return powerOf(n,APP.wsStrength);}
export function csPower(n){return powerOf(n,APP.csStrength);}
// Beschriftung am Spieler-Chip, passend zur gewählten Kennzahl
export function powerTag(name,mode){
  const v=powerOf(name,mode);
  if(!v)return'–';
  return mode==='hero'
    ?'🦸 '+v.toLocaleString(LOC(),{maximumFractionDigits:1})
    :'T1 '+(APP.data.players.find(x=>x.name===name)?.t1);
}
export function setWsStrength(m){APP.wsStrength=m==='hero'?'hero':'t1';saveWSState();renderPage();}
export function setCsStrength(m){APP.csStrength=m==='hero'?'hero':'t1';csSaveState();renderPage();}
// Umschalter über den Auto-Verteilen-Knöpfen
export function strengthPicker(mode,setter){
  return`<div class="card" style="margin-bottom:10px">
    <div class="cb" style="padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Verteilung nach</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${mode==='t1'?'btn-sol':'btn-out'}" style="flex:1" onclick="${setter}('t1')">T1 Truppenstärke</button>
        <button class="btn btn-sm ${mode==='hero'?'btn-sol':'btn-out'}" style="flex:1;${mode==='hero'?'background:var(--ass);border-color:var(--ass)':'color:var(--ass);border-color:var(--ass)'}" onclick="${setter}('hero')">🦸 Heldenkraft</button>
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-top:7px">Greift beim nächsten Auto-Verteilen. Die bestehende Aufstellung bleibt stehen.</div>
    </div>
  </div>`;
}
export function fmtK(n){if(!n)return'–';if(n>=1000000)return(n/1000000).toLocaleString(LOC(),{maximumFractionDigits:1})+'M';if(n>=1000)return Math.round(n/1000)+'K';return String(n);}

// ── EVENT-ZEITEN: europäisch und Serverzeit ──
// Geplant wird nach europäischer Zeit, im Spiel läuft alles nach Serverzeit —
// die liegt vier Stunden zurück (16:00 EU = 12:00 Server · 03:00 EU = 23:00
// Server des Vortags). Deshalb steht in jeder Aufstellung beides nebeneinander.
// Uhrzeiten werden als 'HH:MM' geführt, nicht als Date: es geht um die Zeit im
// Spiel, nicht um die des Geräts — sonst zöge die Sommerzeit sie mit.
export const SERVER_DIFF_H=-4;
export function serverZeit(eu){
  const[h,m]=String(eu||'').split(':').map(Number);
  if(!Number.isFinite(h))return'';
  return String(((h+SERVER_DIFF_H)%24+24)%24).padStart(2,'0')+':'+String(m||0).padStart(2,'0');
}
// „13:00 EU · 09:00 Server" — die vollständige Fassung für Aufstellung, Bilder und Mail.
export function zeitLang(eu){return eu+' EU · '+serverZeit(eu)+' Server';}
export function roleRank(r){return{R5:5,R4:4,R3:3,R2:2,R1:1}[r]||2;}
// Reihenfolge der Anmeldelisten (Wüstensturm und Schluchtsturm): erst Rang
// (R5 → R1), innerhalb eines Rangs die Heldenkraft absteigend. Wer noch keinen
// Heldenwert hat, landet am Ende seiner Rang-Gruppe; dort entscheidet der Name,
// damit die Reihenfolge stabil bleibt.
export function byRankThenHero(a,b){
  const rr=roleRank(b.role)-roleRank(a.role);
  if(rr!==0)return rr;
  const hp=(b.hero_power||0)-(a.hero_power||0);
  return hp!==0?hp:a.name.localeCompare(b.name);
}
export function rankBadge(r){const c={R5:'#f39c12',R4:'#9b59b6',R3:'#7f8c8d',R2:'#95a5a6',R1:'#bdc3c7'}[r||'R3']||'#7f8c8d';return`<span style="font-size:10px;font-weight:800;color:${c};background:${c}22;padding:2px 6px;border-radius:4px;flex-shrink:0">${r||'R3'}</span>`;}
export function sortPlayers(list){
  const s=APP.playerSort;
  return[...list].sort((a,b)=>{
    const ai=isInactive(a.name),bi=isInactive(b.name);
    if(ai!==bi)return ai?1:-1; // inactive always last
    // Primary: role rank descending
    const rra=roleRank(a.role),rrb=roleRank(b.role);
    if(rra!==rrb)return rrb-rra;
    // Secondary: selected sort
    if(s==='t1')return(parseFloat(b.t1)||0)-(parseFloat(a.t1)||0);
    if(s==='hero_power')return(b.hero_power||0)-(a.hero_power||0);
    if(s==='kills')return(b.kills||0)-(a.kills||0);
    if(s==='popularity')return(b.popularity||0)-(a.popularity||0);
    if(s==='profession_level')return(b.profession_level||0)-(a.profession_level||0);
    if(s==='reliability'){const ra=reliability(a.name)??-1,rb=reliability(b.name)??-1;return rb-ra;}
    return a.name.localeCompare(b.name);
  });
}
export function getLineup(t){return t==='B'?APP.lineupB:APP.lineupA;}
export function setLineup(t,v){if(t==='B')APP.lineupB=v;else APP.lineupA=v;}
export function getBldSlots(t){return (t||APP.team)==='B'?APP.bldSlotsB:APP.bldSlotsA;}
// Zone-Slots werden aus bldSlots ABGELEITET — Summe der Gebäude in der Zone bzw. das einzelne Phase-2-Gebäude.
export function getZoneSlots(t){
  const bs=getBldSlots(t);
  return {
    ass:bs.silo||0,
    ars:bs.arsenal||0,
    sold:bs.soeldner||0,
    sup:bs.oelquellen||0,
    z1:(bs.oelraf1||0)+(bs.infozentrum||0),
    z2:(bs.laz2||0)+(bs.laz4||0),
    z3:(bs.oelraf2||0)+(bs.sciencehub||0),
    z4:(bs.laz1||0)+(bs.laz3||0),
  };
}
export function getLineupReady(t){return t==='B'?APP.lineupReadyB:APP.lineupReadyA;}
export function setLineupReady(t,v){if(t==='B')APP.lineupReadyB=v;else APP.lineupReadyA=v;}
export function allZonePlayers(){return Object.values(getLineup(APP.team)).flat();}
