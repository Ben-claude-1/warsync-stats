import { nav } from '../app/render.js';
import { canAccess } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { isInactive } from '../core/players.js';
import { APP } from '../core/state.js';

// ========== HOME ==========
export function pageHome(){
  const u=APP.user;const isP=['r1','r2','r3'].includes(u.role);
  const activePl=APP.data.players.filter(p=>!isInactive(p.name)).length;
  let h=`<div style="margin-bottom:18px"><div style="font-size:20px;font-weight:800">${u.playerName} – Hallo!</div><div style="font-size:13px;color:var(--tx3);margin-top:3px">${new Date().toLocaleDateString(LOC(),{weekday:'long',day:'numeric',month:'long'})}</div></div>`;
  if(canAccess('admin'))h+=`<div class="note info" style="cursor:pointer" onclick="nav('admin')">⚙️ <strong>Admin-Panel</strong> — Allianz-Verwaltung</div>`;
  if(!isP)h+=`<div class="sg" style="cursor:pointer" onclick="nav('allianz')"><div class="sb"><div class="sb-l">Spieler</div><div class="sb-v" style="color:var(--primary)">${activePl}</div><div class="sb-s">in der Allianz →</div></div></div>`;
  h+=`<div class="qg">
    <div class="qc" onclick="nav('ws')"><div class="qc-ico" style="background:#fdedec;color:var(--oil)"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><div class="qc-t">Wüstensturm</div><div class="qc-s">Anmeldung & Planung</div></div>
    ${canAccess('cs')?`<div class="qc" onclick="nav('cs')"><div class="qc-ico" style="background:#f5f0ff;color:var(--ass)"><svg viewBox="0 0 24 24"><path d="M4 22l5-19 3 8 3-5 5 16z"/><line x1="12" y1="11" x2="12" y2="22"/></svg></div><div class="qc-t">Schluchtsturm</div><div class="qc-s">2v1 · Aufstellung & Phasen</div></div>`:''}
    <div class="qc" onclick="nav('profil')"><div class="qc-ico" style="background:var(--pri-l);color:var(--primary)"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="qc-t">Mein Profil</div><div class="qc-s">Stats & Stärken</div></div>
    ${!isP?`<div class="qc" onclick="nav('allianz')"><div class="qc-ico" style="background:var(--acc-l);color:var(--acc)"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div><div class="qc-t">Allianz</div><div class="qc-s">Mitglieder & Rollen</div></div>`:''}
    <div class="qc" onclick="nav('zugfahrt')"><div class="qc-ico" style="background:#f0f8ff;color:#2980b9"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg></div><div class="qc-t">Zugfahrt</div><div class="qc-s">Einteilung & Rotation</div></div>
    ${!isP?`<div class="qc" onclick="showHive()"><div class="qc-ico" style="background:#fff6e0;color:#d99100"><svg viewBox="0 0 24 24"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"/><polygon points="12 7 16.5 9.5 16.5 14.5 12 17 7.5 14.5 7.5 9.5 12 7"/></svg></div><div class="qc-t">Hive-Aufstellung</div><div class="qc-s">Bauplan nach Heldenkraft</div></div>`:''}
  </div>`;
  return h;
}
