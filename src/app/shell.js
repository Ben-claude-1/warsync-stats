import { nav, render, renderPage } from './render.js';
import { loadData } from '../core/auth.js';
import { canAccess } from '../core/helpers.js';
import { ROLES } from '../core/players.js';
import { APP } from '../core/state.js';
import { renderOverlay } from '../ui/overlay.js';

// ====== SHELL ======
export function pageTitle(){return{home:'Dashboard',ws:'Wüstensturm',cs:'Schluchtsturm',vs:'VS-Duell',zugfahrt:'Zugfahrt',allianz:'Allianz',umfragen:'Umfragen',profil:'Mein Profil',admin:'Admin-Panel',rankings:'Ranglisten'}[APP.page]||'WarSync';}
export function renderShell(){
  const u=APP.user;
  document.getElementById('app').innerHTML=`
    <div class="hd">
      <div><div class="hd-sub">AR1S #1668</div><div class="hd-title">${pageTitle()}</div></div>
      <div class="hd-r"><div id="sd" class="sync-dot wait"></div><div class="role-pill">${ROLES[u.role]||u.role}</div></div>
    </div>
    <div class="main" id="pc"><div class="loader"><span class="spin"></span>Lade…</div></div>
    <nav class="bnav">
      <button class="bni${APP.page==='home'?' on':''}" onclick="nav('home')"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Home</button>
      <button class="bni${APP.page==='ws'?' on':''}" onclick="nav('ws')"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Wüstensturm</button>
      ${canAccess('cs')?`<button class="bni${APP.page==='cs'?' on':''}" onclick="nav('cs')"><svg viewBox="0 0 24 24"><path d="M4 22l5-19 3 8 3-5 5 16z"/><line x1="12" y1="11" x2="12" y2="22"/></svg>Schluchtsturm</button>`:''}
      <button class="bni${APP.page==='vs'?' on':''}" onclick="nav('vs')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>VS</button>
      <button class="bni${APP.page==='zugfahrt'?' on':''}" onclick="nav('zugfahrt')"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>Zugfahrt</button>
      <button class="bni${APP.page==='allianz'?' on':''}" onclick="nav('allianz')"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>Allianz</button>
      ${canAccess('umfragen')?`<button class="bni${APP.page==='umfragen'?' on':''}" onclick="nav('umfragen')"><svg viewBox="0 0 24 24"><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/><path d="M9 11l3 3L22 4"/></svg>Umfragen</button>`:''}
      <button class="bni${APP.page==='profil'?' on':''}" onclick="nav('profil')"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Profil</button>
      <button class="bni${APP.page==='rankings'?' on':''}" onclick="nav('rankings')"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>Rangliste</button>
    </nav>`;
  navHeightSync();
  if(!APP.synced&&!APP.syncErr)loadData();else renderPage();
  // Re-render overlay if open
  if(APP.overlayPlayer)renderOverlay();
}
// Die Leiste steht fest am unteren Rand; der Inhalt braucht darunter genau so viel
// Platz, wie sie hoch ist. Fest verdrahtet waren es 72px — das reichte für eine Reihe.
// Wie viele Reihen es werden, hängt von der Fensterbreite *und* davon ab, wie viele
// Punkte die Rolle freischaltet, also wird gemessen statt geraten.
export function navHeightSync(){
  const nav=document.querySelector('.bnav');
  if(!nav)return;
  document.body.style.paddingBottom=(nav.offsetHeight+8)+'px';
}
// Beim Drehen des Handys ändert sich die Spaltenzahl und damit die Höhe.
window.addEventListener('resize',navHeightSync);
