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
