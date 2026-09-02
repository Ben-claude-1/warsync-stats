import { APP } from './state.js';

export const DEMO_USERS=[
  {username:'ben_the_men',playerName:'Ben_the_men',role:'superadmin',wsResp:true,label:'Ben · Super-Admin',desc:'Alle Rechte, alle Allianzen'},
  {username:'r5_phoenix',playerName:'GeneralBlücher',role:'r5',wsResp:true,label:'R5 · Präsident',desc:'Alle Stats, R4 zuweisen, Seasons'},
  {username:'r4_ws',playerName:'xArticulate',role:'r4',wsResp:true,label:'R4 · Wüstensturm',desc:'WS-Planung, Aufstellung, Stärken'},
  {username:'spieler_demo',playerName:'Dani3371',role:'r1',wsResp:false,label:'Spieler (R1–R3)',desc:'Eigene Stats & Teilnahme'},
];
export const ROLES={superadmin:'Super-Admin',r5:'R5',r4:'R4',r3:'R3',r2:'R2',r1:'R1'};
export const ROLE_C={superadmin:'#7c3aed',r5:'#c0392b',r4:'#e8a020',r3:'#27ae60',r2:'#2980b9',r1:'#8892a4'};

export function isInactive(n){
  const p=APP.data.players.find(x=>x.name===n);
  return p?p.active===false:false;
}

// ── BASIS-LEVEL & GESCHLECHT ──
// ws_players.level ist der Basis-/HQ-Level aus der Spiel-Mitgliederliste und
// hat nichts mit profession_level (Beruf-Lvl) zu tun — deshalb überall als
// "HQ" beschriftet, sonst stehen zwei verschiedene "Lv." nebeneinander.
export function hqBadge(p,style){
  if(!p?.level)return'';
  return`<span style="white-space:nowrap;font-weight:700;color:var(--tx3);${style||''}" title="Basis-Level">HQ ${p.level}</span>`;
}
export const GENDER_SYM={m:{s:'♂',c:'#3498db',t:'männlich'},w:{s:'♀',c:'#e91e8c',t:'weiblich'}};
export function genderMark(p,size){
  const g=GENDER_SYM[p?.gender];
  if(!g)return'';   // im Spiel nicht angegeben -> nichts anzeigen
  return`<span title="${g.t}" style="color:${g.c};font-size:${size||12}px;font-weight:700;flex-shrink:0">${g.s}</span>`;
}

// ── T1-TYP ────────────────────────────────────────────────────────────────────
// Welche Truppengattung der T1-Trupp ist. Die Stärke allein reicht für die
// Aufstellung nicht: 48 Mio Tank und 48 Mio Air gehören an verschiedene Gebäude.
//
// Gespeichert wird der Kurzcode ('T'/'A'/'M') in ws_players.t1_type, siehe
// db/2026-09-02_ws_players_t1_type.sql. Die Namen Tank/Air/Missile bleiben auch
// auf Deutsch stehen — so heißen sie im Spiel, wie die Gebäude im Schluchtsturm.
export const T1_TYP={
  T:{l:'Tank',   s:'🛡', c:'#2980b9'},
  A:{l:'Air',    s:'✈', c:'#16a085'},
  M:{l:'Missile',s:'🚀', c:'#c0392b'},
};
export const T1_TYP_CODES=Object.keys(T1_TYP);
// Nicht gesetzt heißt "unbekannt" und wird nirgends geraten — ein Vorgabewert
// wäre eine Behauptung über den Spieler.
export function t1TypMark(p,size){
  const t=T1_TYP[p?.t1_type];
  if(!t)return'';
  return`<span title="T1: ${t.l}" style="color:${t.c};font-size:${size||11}px;font-weight:800;flex-shrink:0">${t.s} ${t.l}</span>`;
}
// Ein einziges Auswahlfeld für alle drei Eingabestellen (Profil, Allianz-Detail,
// Spieler anlegen). Getrennte Listen liefen sonst irgendwann auseinander.
export function t1TypSelect(id,val){
  return`<div><label style="font-size:11px;color:var(--tx3);display:block;margin-bottom:4px">T1-Typ</label>
    <select class="fi" id="${id}" style="padding:8px 10px;width:100%;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
      <option value=""${val?'':' selected'}>– unbekannt</option>
      ${T1_TYP_CODES.map(k=>`<option value="${k}"${val===k?' selected':''}>${T1_TYP[k].s} ${T1_TYP[k].l}</option>`).join('')}
    </select></div>`;
}

// ── SPIELER-AVATARE ──
// Bilder liegen unter assets/avatars/<spieler-uuid>.jpg, der Pfad steht in
// ws_players.avatar_url. Bewusst nach UUID und nicht nach Name benannt —
// Umbenennungen im Spiel sind häufig und würden namensbasierte Pfade brechen.
export function avatarUrl(name){
  const p=APP.data.players.find(x=>x.name===name);
  return p?.avatar_url||null;
}
// Avatar oder, wenn keines hinterlegt ist, das bisherige Ersatz-Element.
export function avatarImg(name,size,style,fallback){
  const u=avatarUrl(name);
  if(!u)return fallback;
  const inact=isInactive(name);
  return`<img src="${u}" alt="" loading="lazy" style="width:${size}px;height:${size}px;`
    +`object-fit:cover;flex-shrink:0;background:var(--bg2);${inact?'filter:grayscale(1);opacity:.5;':''}${style||''}"`
    +` onerror="this.style.display='none'">`;
}
