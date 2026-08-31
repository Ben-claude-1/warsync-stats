import { renderPage } from '../app/render.js';
import { sbDelete, sbGet, sbPatch, sbPost } from '../core/api.js';
import { sha256 } from '../core/auth.js';
import { VISION_URL } from '../core/config.js';
import { badge, canAccess, roleRank } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { isInactive } from '../core/players.js';
import { PRESENCE_ONLINE_MS, presencePull, presenceRefreshCard } from '../core/presence.js';
import { APP } from '../core/state.js';
import { copyPlayerToAlliance, createAlliance, setAllianceActive } from '../core/alliance.js';
import { currentAlliance } from '../core/tenant.js';
import { saveWSState } from './buildings.js';
import { csSaveState } from './cs.js';

// ========== ADMIN ==========
export function pageAdmin(){
  if(!canAccess('admin'))return`<div class="loader" style="color:var(--tx3)">Kein Zugriff.</div>`;
  const evts=APP.data.events;const pl=APP.data.players;
  const active=pl.filter(p=>!isInactive(p.name));
  const r4r5=active.filter(p=>['R4','R5'].includes(p.role||'R3'));

  return`
  <div class="card" style="margin-bottom:12px"><div class="ch">Übersicht</div><div style="padding:12px">
    <div class="sg" style="margin-bottom:0">
      <div class="sb"><div class="sb-l">Spieler</div><div class="sb-v">${active.length}</div></div>
      <div class="sb"><div class="sb-l">Events</div><div class="sb-v">${evts.length}</div></div>
      <div class="sb"><div class="sb-l">Siege</div><div class="sb-v" style="color:var(--win)">${evts.filter(e=>e.result==='win').length}</div></div>
      <div class="sb"><div class="sb-l">Niederlagen</div><div class="sb-v" style="color:var(--loss)">${evts.filter(e=>e.result==='loss').length}</div></div>
    </div>
  </div></div>

  ${presenzKarte()}

  <!-- NEUEN SPIELER ANLEGEN -->
  <div class="card" style="margin-bottom:12px;border:2px solid var(--win)">
    <div class="ch">➕ Neuen Spieler anlegen</div>
    <div class="cb">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="grid-column:1/-1">
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Spielername *</label>
          <input type="text" id="new-pl-name" class="fi" placeholder="Spielername" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit">
        </div>
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Rang</label>
          <select id="new-pl-role" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            <option value="R3" selected>R3 · Mitglied</option>
            <option value="R4">R4 · Offizier</option>
            <option value="R5">R5 · Präsident</option>
            <option value="R2">R2</option>
            <option value="R1">R1</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Beruf</label>
          <select id="new-pl-prof" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            <option value="Ingenieur" selected>🔧 Ingenieur</option>
            <option value="Kriegsführer">⚔ Kriegsführer</option>
          </select>
        </div>
        ${['T1','T2','T3','T4'].map(t=>`<div><label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">${t} (Mio.)</label><input type="number" step="0.01" id="new-pl-${t.toLowerCase()}" class="fi" placeholder="–" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit"></div>`).join('')}
        <div style="grid-column:1/-1">
          <label style="font-size:11px;color:var(--ass);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">🦸 Gesamtkraft der Helden (Mio.)</label>
          <input type="number" step="0.1" id="new-pl-hp" class="fi" placeholder="–" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit;border:1.5px solid var(--ass)">
        </div>
      </div>
      <button class="btn btn-sol" style="width:100%;background:var(--win)" id="new-pl-btn" onclick="adminCreatePlayer()">➕ Spieler anlegen</button>
      <div id="new-pl-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
    </div>
  </div>

  <!-- VISION SERVER URL -->
  <div class="card" style="margin-bottom:12px;border:2px solid #e67e22">
    <div class="ch">🤖 Vision-Server URL <span class="ch-sub">Für Screenshot-Analyse (VS + Wüstensturm)</span></div>
    <div class="cb">
      <div style="font-size:12px;color:var(--tx3);margin-bottom:8px">Lokaler Ollama-Proxy via Tailscale Funnel. Standard: mac-studio.taild5562c.ts.net:10000</div>
      <div style="display:flex;gap:6px">
        <input type="text" id="adm-vision-url" class="fi" placeholder="https://mac-studio.taild5562c.ts.net:10000" style="flex:1;font-size:12px;padding:8px 10px;margin:0" value="${localStorage.getItem('visionUrl')||''}">
        <button class="btn btn-sol" onclick="adminSetVisionUrl()">Speichern</button>
        ${localStorage.getItem('visionUrl')?`<button class="btn btn-out" onclick="localStorage.removeItem('visionUrl');renderPage()">Reset</button>`:''}
      </div>
      <div style="font-size:11px;margin-top:6px;color:var(--tx3)">
        Aktiv: ${localStorage.getItem('visionUrl')||'https://mac-studio.taild5562c.ts.net:10000'} · <a href="javascript:adminCheckVision()" style="color:var(--acc)">Health prüfen</a>
      </div>
      <div id="adm-vision-health" style="font-size:11px;margin-top:4px"></div>
    </div>
  </div>

  <!-- SPIELER VEREINEN -->
  <div class="card" style="margin-bottom:12px;border:2px solid #c0392b">
    <div class="ch">🔀 Spieler vereinen <span class="ch-sub">Doppelte Namen zusammenführen</span></div>
    <div class="cb">
      <div style="font-size:12px;color:var(--tx3);margin-bottom:10px">Alle Daten (WS-Teilnahme, VS-Einträge) werden auf den Ziel-Spieler übertragen, der Quell-Spieler danach gelöscht.</div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:10px">
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Quelle (löschen)</label>
          <select id="merge-src" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            ${pl.sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}">${p.name} (${p.role||'R3'})</option>`).join('')}
          </select>
        </div>
        <div style="text-align:center;font-size:20px;padding-top:18px">→</div>
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Ziel (behalten)</label>
          <select id="merge-dst" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            ${pl.sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}">${p.name} (${p.role||'R3'})</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-sol" style="background:#c0392b;width:100%" id="merge-btn" onclick="adminMergePlayers()">🔀 Zusammenführen</button>
      <div id="merge-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
    </div>
  </div>

  <!-- PASSWORT SETZEN -->
  <div class="card" style="margin-bottom:12px;border:2px solid var(--ass,#7c3aed)">
    <div class="ch">🔑 Passwort setzen <span class="ch-sub">Für dich oder andere Spieler</span></div>
    <div class="cb">
      <div class="fl2" style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Spieler</label>
        <select id="pw-player" style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
          ${pl.filter(p=>!isInactive(p.name)).sort((a,b)=>{const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');return rr||a.name.localeCompare(b.name);}).map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}">${p.name} (${p.role||'R3'})${p.password_hash?'':' · Kein PW'}</option>`).join('')}
        </select>
      </div>
      <div class="fl2" style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px">Neues Passwort</label>
        <input class="fi" id="pw-new" type="text" placeholder="Neues Passwort eingeben (min. 4 Zeichen)"
          style="width:100%;padding:9px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none">
      </div>
      <button class="btn btn-sol" id="pw-save-btn" style="width:100%" onclick="adminSetPassword()">🔑 Passwort speichern</button>
      <div id="pw-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
    </div>
  </div>

  <!-- ZUGANGSVERWALTUNG -->
  <div class="card" style="margin-bottom:12px">
    <div class="ch">Zugangsverwaltung <span class="ch-sub">Wer darf sich einloggen</span></div>
    <div style="padding:0 14px">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
        <span style="font-size:10px;font-weight:700;color:var(--tx3);text-align:right;min-width:24px">#</span>
        <span style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase">Spieler</span>
        <span style="font-size:10px;font-weight:700;color:var(--win);text-align:center;width:66px">Zugang</span>
        <span style="font-size:10px;font-weight:700;color:#c0392b;text-align:center;width:104px">Admin</span>
        <span style="font-size:10px;font-weight:700;color:var(--ass,#7c3aed);text-align:center;width:90px">PW&nbsp;Reset</span>
      </div>
      ${pl.filter(p=>!isInactive(p.name)).sort((a,b)=>{const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');return rr||a.name.localeCompare(b.name);}).map((p,i)=>{
        const rc={R5:'#f39c12',R4:'#9b59b6',R3:'#27ae60',R2:'#2980b9',R1:'#8892a4'}[p.role]||'#8892a4';
        const on=p.access_enabled;
        // Dem Super-Admin lässt sich der Zugang nicht entziehen — sonst könnte ein
        // Allianz-Admin denjenigen aussperren, der über ihm steht.
        const isSelf=!!p.super_admin;
        function toggle(val,onChange,color){
          return`<label style="position:relative;display:inline-block;width:40px;height:22px">
            <input type="checkbox" ${val?'checked':''} onchange="${onChange}"
              style="opacity:0;width:0;height:0;position:absolute">
            <span style="position:absolute;cursor:pointer;inset:0;border-radius:11px;background:${val?color:'#ccc'};transition:.2s">
              <span style="position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;left:${val?'21':'3'}px;top:3px;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
            </span>
          </label>`;}
        const safeName=p.name.replace(/'/g,"\\'");
        const isAdm=!!p.alliance_admin;
        return`<div style="display:grid;grid-template-columns:auto 1fr auto auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd)">
          <span style="font-size:11px;color:var(--tx3);font-variant-numeric:tabular-nums;min-width:24px;text-align:right">${i+1}.</span>
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:10px;font-weight:800;color:${rc};background:${rc}22;padding:2px 5px;border-radius:4px">${p.role||'R3'}</span>
            <span style="font-size:13px;font-weight:600">${p.name}${isSelf?' 👑':''}</span>
            ${p.password_hash?'':'<span style="font-size:10px;color:var(--loss);background:#fdecea;padding:1px 5px;border-radius:4px">Kein PW</span>'}
          </div>
          <div style="text-align:center;width:66px">
            ${isSelf?`<span style="font-size:11px;color:var(--tx3)">immer</span>`:toggle(on,`adminSetAccess('${safeName}',this.checked)`,'var(--win)')}
          </div>
          <div style="text-align:center;width:104px">
            ${isSelf
              ?`<span style="font-size:11px;color:var(--tx3)" title="Super-Admin steht ohnehin über der Allianz">immer</span>`
              :`<button onclick="adminToggleAllianceAdmin('${safeName}')"
                  title="${isAdm?`„${p.name}" die Admin-Rechte für diese Allianz entziehen`:`„${p.name}" zum Admin dieser Allianz machen`}"
                  style="padding:5px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.2;white-space:nowrap;
                    background:${isAdm?'#c0392b':'#fff'};color:${isAdm?'#fff':'var(--tx3)'};border:1.5px solid ${isAdm?'#c0392b':'var(--bd)'}">
                  ${isAdm?'👑 Admin':'Admin geben'}</button>`}
          </div>
          <div style="text-align:center;width:90px">
            <button onclick="adminPromptSetPassword('${safeName}')" title="Neues Passwort für ${p.name} setzen"
              style="padding:5px 10px;background:var(--ass,#7c3aed);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;line-height:1.2;white-space:nowrap">🔑 Reset</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:10px 14px;background:#f8f9fc;border-top:1px solid var(--bd);font-size:11px;color:var(--tx3)">
      <strong>Zugang:</strong> Darf sich einloggen &nbsp;·&nbsp;
      <strong>Admin:</strong> Verwaltet diese Allianz vollständig — dieses Panel eingeschlossen. Wirkt nur hier, nie in einer anderen Allianz. &nbsp;·&nbsp;
      <strong>PW Reset:</strong> Klick → neues Passwort für diesen Spieler vergeben
    </div>
  </div>

  <!-- BERECHTIGUNGEN -->
  <div class="card" style="margin-bottom:12px">
    <div class="ch">Berechtigungen <span class="ch-sub">R4 · R5 Spieler</span></div>
    <div style="padding:0 14px">
      <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
        <span style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase">Spieler</span>
        <span style="font-size:10px;font-weight:700;color:var(--ass);text-align:center;width:80px">WS-Admin</span>
        <span style="font-size:10px;font-weight:700;color:var(--primary);text-align:center;width:80px">Profil Edit</span>
        <span style="font-size:10px;font-weight:700;color:#c0392b;text-align:center;width:92px">Allianz-Admin</span>
      </div>
      ${r4r5.length?r4r5.map(p=>{
        const rc={R5:'#f39c12',R4:'#9b59b6'}[p.role]||'#7f8c8d';
        return`<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd)">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:10px;font-weight:800;color:${rc};background:${rc}22;padding:2px 5px;border-radius:4px">${p.role}</span>
            <span style="font-size:13px;font-weight:600">${p.name}</span>
            ${p.super_admin?'<span title="Super-Admin — über allen Allianzen" style="font-size:10px">👑</span>':''}
          </div>
          <div style="text-align:center;width:80px">
            <label style="position:relative;display:inline-block;width:40px;height:22px">
              <input type="checkbox" ${p.ws_admin?'checked':''} onchange="adminSetPerm('${p.name.replace(/'/g,"\\'")}','ws_admin',this.checked)"
                style="opacity:0;width:0;height:0;position:absolute">
              <span style="position:absolute;cursor:pointer;inset:0;border-radius:11px;background:${p.ws_admin?'var(--ass)':'#ccc'};transition:.2s">
                <span style="position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;left:${p.ws_admin?'21':'3'}px;top:3px;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
              </span>
            </label>
          </div>
          <div style="text-align:center;width:80px">
            <label style="position:relative;display:inline-block;width:40px;height:22px">
              <input type="checkbox" ${p.profile_edit?'checked':''} onchange="adminSetPerm('${p.name.replace(/'/g,"\\'")}','profile_edit',this.checked)"
                style="opacity:0;width:0;height:0;position:absolute">
              <span style="position:absolute;cursor:pointer;inset:0;border-radius:11px;background:${p.profile_edit?'var(--primary)':'#ccc'};transition:.2s">
                <span style="position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;left:${p.profile_edit?'21':'3'}px;top:3px;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
              </span>
            </label>
          </div>
          <div style="text-align:center;width:92px">
            ${p.super_admin?`<span style="font-size:11px;color:var(--tx3)" title="Super-Admin steht ohnehin über der Allianz">immer</span>`:`
            <label style="position:relative;display:inline-block;width:40px;height:22px">
              <input type="checkbox" ${p.alliance_admin?'checked':''} onchange="adminSetPerm('${p.name.replace(/'/g,"\\'")}','alliance_admin',this.checked)"
                style="opacity:0;width:0;height:0;position:absolute">
              <span style="position:absolute;cursor:pointer;inset:0;border-radius:11px;background:${p.alliance_admin?'#c0392b':'#ccc'};transition:.2s">
                <span style="position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;left:${p.alliance_admin?'21':'3'}px;top:3px;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
              </span>
            </label>`}
          </div>
        </div>`;
      }).join(''):`<div style="padding:14px;text-align:center;font-size:12px;color:var(--tx3)">Keine R4/R5 Spieler vorhanden.</div>`}
    </div>
    <div style="padding:10px 14px;background:#f8f9fc;border-top:1px solid var(--bd);font-size:11px;color:var(--tx3)">
      <strong>WS-Admin:</strong> Darf Aufstellungen und WS-Einstellungen ändern &nbsp;·&nbsp;
      <strong>Profil Edit:</strong> Darf eigene und fremde Spielerprofile bearbeiten &nbsp;·&nbsp;
      <strong>Allianz-Admin:</strong> Verwaltet diese Allianz vollständig — dieses Panel eingeschlossen. Wirkt nur hier, nie in einer anderen Allianz.
    </div>
  </div>

  <!-- DATEN EXPORT -->
  <div class="card" style="margin-bottom:12px">
    <div class="ch">Daten-Export <span class="ch-sub">Aktueller Stand aller Spieler</span></div>
    <div class="cb">
      <div class="note info" style="margin-bottom:12px">Exportiert alle Spielerprofile als Excel-Datei. Nur der aktuelle Stand — keine Verlaufshistorie.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sol" style="flex:1" onclick="exportPlayersExcel()">
          <svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;vertical-align:middle;margin-right:5px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Excel exportieren (.xlsx)
        </button>
      </div>
      <div id="export-info" style="display:none;margin-top:10px;font-size:12px;color:var(--win);font-weight:600"></div>
    </div>
  </div>

  ${allianzKarte(active.length)}
  ${spielerKopierenKarte(pl)}

  <!-- MITGLIEDERLISTE AKTUALISIEREN -->
  <div class="card" style="margin-bottom:12px">
    <div class="ch">👥 Mitgliederliste aktualisieren <span class="ch-sub">Screenshots der Allianz-Mitgliederliste</span></div>
    <div class="cb">
      <div class="note info" style="margin-bottom:12px">Screenshots aller aktiven Mitglieder hochladen. Die Namen werden erkannt und mit der Datenbank abgeglichen.</div>
      <label style="font-size:12px;color:var(--tx3);display:block;margin-bottom:4px">Screenshots hochladen</label>
      <input type="file" id="adm-mem-shots" multiple accept="image/*" onchange="admMemPreview()" style="width:100%;padding:6px 0">
      <div id="adm-mem-previews" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
        <button class="btn btn-sol" id="adm-mem-btn" onclick="admAnalyzeMembers()">🔍 Analysieren</button>
        <span id="adm-mem-status" style="font-size:12px;color:var(--tx3)"></span>
      </div>
      <div id="adm-mem-result" style="margin-top:12px"></div>
    </div>
  </div>`;}
// ══════════════════════════════════════════════════════════════════
//  WER IST GERADE ANGEMELDET
// ══════════════════════════════════════════════════════════════════
// Die Daten kommen aus ws_presence — jeder angemeldete Tab meldet sich dort
// minütlich (core/presence.js). Angezeigt wird deshalb nie „online/offline",
// sondern wann jemand zuletzt gemeldet hat: wer den Browser zumacht, sagt es
// niemandem, und ein Ampelpunkt, der bis zum nächsten Neustart auf Grün steht,
// wäre schlimmer als gar keiner.
//
// Die Karte frischt sich alle 30 Sekunden selbst auf (presenceRefreshCard) und
// nicht über renderPage() — sonst verlöre der Admin bei jedem Takt, was er
// gerade in „Neuen Spieler anlegen" getippt hat.
const SEITEN_NAMEN={home:'Home',ws:'Wüstensturm',cs:'Schluchtsturm',vs:'VS',zugfahrt:'Zugfahrt',
  allianz:'Allianz',umfragen:'Umfragen',profil:'Profil',rankings:'Rangliste',admin:'Admin'};
// Gröber, je länger es her ist: auf die Minute genau interessiert nur die letzte Stunde.
export function seitWann(ms){
  const min=Math.floor(ms/60000);
  if(min<1)return'gerade eben';
  if(min<60)return'vor '+min+' Min';
  const std=Math.floor(min/60);
  if(std<24)return std===1?'vor 1 Std':'vor '+std+' Std';
  const tage=Math.floor(std/24);
  return tage===1?'vor 1 Tag':'vor '+tage+' Tagen';
}
function uhrzeit(iso){
  const d=iso?new Date(iso):null;
  return d&&!isNaN(d)?d.toLocaleTimeString(LOC(),{hour:'2-digit',minute:'2-digit'}):'–';
}
// Eine Zeile je Mensch, nicht je Gerät: „Ben · iPhone, Mac" liest sich besser als
// zweimal Ben untereinander. Maßgeblich ist immer das zuletzt aktive Gerät.
function presenzProSpieler(){
  const proSpieler=new Map();
  (APP.presence||[]).forEach(r=>{
    if(!r.player_name)return;
    const t=Date.parse(r.last_seen)||0;
    const e=proSpieler.get(r.player_name)||{name:r.player_name,letzte:0,seit:null,page:null,geraete:[]};
    if(!e.geraete.includes(r.device||'Browser'))e.geraete.push(r.device||'Browser');
    if(t>=e.letzte){e.letzte=t;e.page=r.page;e.seit=r.first_seen;}
    proSpieler.set(r.player_name,e);
  });
  return[...proSpieler.values()].sort((a,b)=>b.letzte-a.letzte);
}
export function presenzListeHtml(){
  const jetzt=Date.now();
  const alle=presenzProSpieler();
  const da=alle.filter(e=>jetzt-e.letzte<PRESENCE_ONLINE_MS);
  const weg=alle.filter(e=>jetzt-e.letzte>=PRESENCE_ONLINE_MS).slice(0,12);
  const ich=APP.user?.playerName;
  const punkt=c=>`<span style="width:9px;height:9px;border-radius:50%;background:${c};flex-shrink:0;display:inline-block"></span>`;
  const zeile=(e,online)=>{
    const p=SEITEN_NAMEN[e.page]||'';
    return`<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--bd)">
      ${punkt(online?'var(--win)':'#ccc')}
      <div style="min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600">${e.name}${e.name===ich?' <span style="font-size:10px;color:var(--tx3);font-weight:600">· du</span>':''}</div>
        <div style="font-size:11px;color:var(--tx3)">${e.geraete.join(' · ')}${p?' · <span>'+p+'</span>':''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:600;color:${online?'var(--win)':'var(--tx3)'}">${online?'seit '+uhrzeit(e.seit):seitWann(jetzt-e.letzte)}</div>
        ${online?`<div style="font-size:11px;color:var(--tx3)">${seitWann(jetzt-e.letzte)}</div>`:''}
      </div>
    </div>`;};
  let h=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div style="font-size:13px;font-weight:700">${da.length===1?'1 Mitglied gerade da':da.length+' Mitglieder gerade da'}</div>
    <button class="btn btn-out btn-sm" onclick="adminRefreshPresence()">↻ Aktualisieren</button>
  </div>`;
  h+=da.length?da.map(e=>zeile(e,true)).join('')
    :`<div style="padding:10px 0;font-size:12px;color:var(--tx3)">Gerade ist niemand angemeldet.</div>`;
  if(weg.length){
    h+=`<div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin:12px 0 2px">Zuletzt gesehen</div>`
      +weg.map(e=>zeile(e,false)).join('');
  }
  h+=`<div style="font-size:11px;color:var(--tx3);margin-top:10px">
    Jeder angemeldete Tab meldet sich einmal pro Minute. Wer den Browser zumacht, verschwindet nach etwa drei Minuten aus der oberen Liste — abgemeldet ist er damit nicht.
  </div>`;
  return h;
}
export function presenzKarte(){
  return`<div class="card" style="margin-bottom:12px">
    <div class="ch">🟢 Gerade angemeldet <span class="ch-sub">Aktualisiert sich alle 30 Sekunden</span></div>
    <div class="cb" id="adm-presence-body">${presenzListeHtml()}</div>
  </div>`;
}
export async function adminRefreshPresence(){
  const el=document.getElementById('adm-presence-body');
  if(el)el.style.opacity='.5';
  await presencePull();
  presenceRefreshCard();
  if(el)el.style.opacity='';
}

// ══════════════════════════════════════════════════════════════════
//  ALLIANZ-VERWALTUNG
// ══════════════════════════════════════════════════════════════════
// Zwei Sichten auf dieselbe Karte:
//
//  · Allianz-Admin sieht seine Allianz — Name, Server, Mitgliederzahl. Mehr gibt
//    es für ihn nicht zu tun; andere Allianzen existieren für ihn nicht.
//  · Super-Admin sieht alle, kann umschalten, anlegen und stilllegen.
//
// Die Trennung ist nicht bloß Anzeige: canAccess('alliances') hängt an der Rolle,
// und die Daten selbst filtert core/api.js. Ein Allianz-Admin, der die Knöpfe von
// Hand aufriefe, käme trotzdem nicht an eine fremde Allianz.
export function allianzKarte(aktive){
  const hier=currentAlliance();
  const darf=canAccess('alliances');
  if(!darf){
    return`<div class="card" style="margin-bottom:12px"><div class="ch">Allianz</div>
      <div class="mi"><div class="mav" style="background:var(--win-l);color:var(--win)">${(hier?.tag||'?').slice(0,1)}</div>
        <div><div class="mn">${hier?.tag||'–'}</div><div class="mm">${hier?.name?hier.name+' · ':''}Server ${hier?.server||'–'} · ${aktive} aktive Mitglieder</div></div>
        <div class="mr">${badge('Deine Allianz','var(--win)')}</div>
      </div>
      <div style="padding:10px 14px;background:#f8f9fc;border-top:1px solid var(--bd);font-size:11px;color:var(--tx3)">
        Du verwaltest diese Allianz. Andere Allianzen im Werkzeug sind davon vollständig getrennt — weder einsehbar noch änderbar.
      </div>
    </div>`;
  }
  const zeilen=(APP.alliances||[]).map(a=>{
    const hierSchon=a.id===APP.allianceId;
    const sicher=a.id.replace(/'/g,"\\'");
    return`<div class="mi" style="${hierSchon?'background:#f4f7ff':''}">
      <div class="mav" style="background:${a.active===false?'#eee':'var(--win-l)'};color:${a.active===false?'#999':'var(--win)'}">${a.tag.slice(0,1)}</div>
      <div style="min-width:0">
        <div class="mn">${a.tag}${hierSchon?' <span style="font-size:10px;color:var(--acc);font-weight:700">· angezeigt</span>':''}</div>
        <div class="mm">${a.name?a.name+' · ':''}Server ${a.server||'–'}${hierSchon?' · '+aktive+' aktive Mitglieder':''}</div>
      </div>
      <div class="mr" style="display:flex;gap:6px;align-items:center">
        ${a.active===false?badge('Stillgelegt','#8892a4'):badge('Aktiv','var(--win)')}
        ${hierSchon?'':`<button class="btn btn-out btn-sm" onclick="switchAlliance('${sicher}')">Ansehen</button>`}
        <button class="btn btn-out btn-sm" title="${a.active===false?'Wieder aktivieren':'Stilllegen'}" onclick="admToggleAlliance('${sicher}')">${a.active===false?'↩':'⏸'}</button>
      </div>
    </div>`;}).join('');
  return`<div class="card" style="margin-bottom:12px"><div class="ch">Allianzen <span class="ch-sub">Super-Admin · Ansicht umschalten</span></div>
    ${zeilen||'<div style="padding:14px;font-size:12px;color:var(--tx3)">Keine Allianz angelegt.</div>'}
    <div class="cb" style="border-top:1px solid var(--bd)">
      <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Neue Allianz anlegen</div>
      <div style="display:grid;grid-template-columns:1fr 1.4fr .8fr;gap:8px;margin-bottom:8px">
        <input type="text" id="new-al-tag" class="fi" placeholder="Tag · z.B. XP33" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit">
        <input type="text" id="new-al-name" class="fi" placeholder="Name (optional)" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit">
        <input type="text" id="new-al-server" class="fi" placeholder="#1668" style="width:100%;padding:8px 10px;font-size:13px;font-family:inherit">
      </div>
      <button class="btn btn-sol" style="width:100%" id="new-al-btn" onclick="adminCreateAlliance()">➕ Allianz anlegen</button>
      <div id="new-al-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
      <div style="font-size:11px;color:var(--tx3);margin-top:8px">
        Eine neue Allianz startet leer: keine Spieler, keine Events, keine Aufstellung. Setze dort zuerst über „Spieler kopieren“ oder die Mitgliederliste jemanden ein, der sich anmelden kann.
      </div>
    </div>
  </div>`;
}
// Spieler in eine andere Allianz übernehmen — der Weg für einen Wechsel des
// Menschen, nicht der Daten. Die Zeile in der alten Allianz bleibt stehen: an ihr
// hängen Teilnahmen und Stärkeverlauf, die dorthin gehören.
export function spielerKopierenKarte(pl){
  if(!canAccess('alliances'))return'';
  const ziele=(APP.alliances||[]).filter(a=>a.id!==APP.allianceId);
  if(!ziele.length)return'';
  const sortiert=[...pl].filter(p=>!isInactive(p.name)).sort((a,b)=>{const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');return rr||a.name.localeCompare(b.name);});
  return`<div class="card" style="margin-bottom:12px;border:2px solid #2980b9">
    <div class="ch" style="color:#2980b9">🚚 Spieler in andere Allianz kopieren <span class="ch-sub">Profil und Passwort, ohne Historie</span></div>
    <div class="cb">
      <div class="note info" style="margin-bottom:10px">Legt den Spieler in der Zielallianz neu an. Teilnahmen, Ereignisse und Stärkeverlauf bleiben in dieser Allianz — sie gehören dorthin, wo sie entstanden sind. Die Zeile hier bleibt ebenfalls stehen.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Spieler</label>
          <select id="cp-player" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            ${sortiert.map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}">${p.name} (${p.role||'R3'})</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--tx3);font-weight:700;text-transform:uppercase;display:block;margin-bottom:4px">Zielallianz</label>
          <select id="cp-ziel" style="width:100%;padding:8px 10px;border:1.5px solid var(--bd);border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff">
            ${ziele.map(a=>`<option value="${a.id}">${a.tag}${a.server?' '+a.server:''}</option>`).join('')}
          </select>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:10px">
        <input type="checkbox" id="cp-admin" style="width:16px;height:16px"> Dort als <strong>Allianz-Admin</strong> einsetzen
      </label>
      <button class="btn btn-sol" style="width:100%;background:#2980b9" id="cp-btn" onclick="adminCopyPlayer()">🚚 Kopieren</button>
      <div id="cp-result" style="display:none;margin-top:10px;padding:9px 12px;border-radius:8px;font-size:13px"></div>
    </div>
  </div>`;
}
function meldung(id,msg,ok){
  const el=document.getElementById(id);
  if(!el)return;
  el.style.display='block';
  el.style.background=ok?'#eafaf1':'#fdecea';
  el.style.color=ok?'var(--win)':'var(--loss)';
  el.textContent=msg;
}
export async function adminCreateAlliance(){
  const tag=(document.getElementById('new-al-tag')?.value||'').trim();
  const name=(document.getElementById('new-al-name')?.value||'').trim();
  const server=(document.getElementById('new-al-server')?.value||'').trim();
  if(!tag){meldung('new-al-result','Bitte einen Allianz-Tag eingeben.',false);return;}
  const btn=document.getElementById('new-al-btn');
  if(btn){btn.textContent='Wird angelegt…';btn.disabled=true;}
  try{
    const neu=await createAlliance(tag,name,server);
    meldung('new-al-result','✓ Allianz „'+neu.tag+'" angelegt. Über „Ansehen" wechselst du hinein.',true);
    ['new-al-tag','new-al-name','new-al-server'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
    setTimeout(()=>renderPage(),900);
  }catch(e){
    // Der Unique-Index auf tag ist die häufigste Ursache — im Klartext statt als PostgREST-Brocken.
    meldung('new-al-result',/duplicate|unique/i.test(e.message)?'Es gibt bereits eine Allianz mit dem Tag „'+tag+'".':'Fehler: '+e.message,false);
  }
  if(btn){btn.textContent='➕ Allianz anlegen';btn.disabled=false;}
}
export async function admToggleAlliance(id){
  const a=(APP.alliances||[]).find(x=>x.id===id);
  if(!a)return;
  const an=a.active===false;
  if(!an&&id===APP.allianceId){alert('Die gerade angezeigte Allianz lässt sich nicht stilllegen. Wechsle zuerst in eine andere.');return;}
  if(!confirm(an?'Allianz „'+a.tag+'" wieder aktivieren?':'Allianz „'+a.tag+'" stilllegen?\n\nDie Daten bleiben vollständig erhalten; Mitglieder können sich nur nicht mehr anmelden.'))return;
  try{await setAllianceActive(id,an);renderPage();}
  catch(e){alert('Fehler: '+e.message);}
}
export async function adminCopyPlayer(){
  const name=document.getElementById('cp-player')?.value;
  const ziel=document.getElementById('cp-ziel')?.value;
  const alsAdmin=!!document.getElementById('cp-admin')?.checked;
  if(!name||!ziel){meldung('cp-result','Bitte Spieler und Zielallianz wählen.',false);return;}
  const zielTag=(APP.alliances||[]).find(a=>a.id===ziel)?.tag||'?';
  if(!confirm('„'+name+'" nach '+zielTag+' kopieren'+(alsAdmin?' und dort als Allianz-Admin einsetzen':'')+'?'))return;
  const btn=document.getElementById('cp-btn');
  if(btn){btn.textContent='Kopiere…';btn.disabled=true;}
  try{
    await copyPlayerToAlliance(name,ziel,{allianceAdmin:alsAdmin});
    meldung('cp-result','✓ „'+name+'" steht jetzt auch in '+zielTag+(alsAdmin?' — als Allianz-Admin.':'.'),true);
  }catch(e){meldung('cp-result','Fehler: '+e.message,false);}
  if(btn){btn.textContent='🚚 Kopieren';btn.disabled=false;}
}

export function exportPlayersExcel(){
  if(typeof XLSX==='undefined'){alert('Excel-Bibliothek noch nicht geladen. Bitte kurz warten und nochmal versuchen.');return;}
  const all=APP.data.players;
  if(!all.length){alert('Keine Spielerdaten vorhanden.');return;}

  // Aktive Spieler zuerst, dann inaktive; innerhalb nach Rolle sortiert
  const sorted=[...all].sort((a,b)=>{
    const ia=isInactive(a.name),ib=isInactive(b.name);
    if(ia!==ib)return ia?1:-1;
    const rr=roleRank(b.role||'R3')-roleRank(a.role||'R3');
    return rr||a.name.localeCompare(b.name);
  });

  const rows=sorted.map(p=>({
    'Name':p.name,
    'Rolle':p.role||'R3',
    'Status':isInactive(p.name)?'Ausgetreten':'Aktiv',
    'Beruf':p.profession||'',
    'Beruf-Level':p.profession_level||'',
    'Kills':p.kills||'',
    'Beliebtheit':p.popularity||'',
    'T1 (Mio.)':p.t1||'',
    'T2 (Mio.)':p.t2||'',
    'T3 (Mio.)':p.t3||'',
    'T4 (Mio.)':p.t4||'',
    'Gesamtkampfkraft':p.total_power||'',
    'Gesamtkraft der Helden (Mio.)':p.hero_power?p.hero_power/1e6:'',
    'T1 zuletzt aktualisiert':p.t1_updated_at?p.t1_updated_at.slice(0,10):'',
  }));

  const ws=XLSX.utils.json_to_sheet(rows);

  // Auto column widths
  const colWidths=Object.keys(rows[0]).map(k=>({wch:Math.max(k.length,12)}));
  ws['!cols']=colWidths;

  // Style header row bold (basic)
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c;C<=range.e.c;C++){
    const addr=XLSX.utils.encode_cell({r:0,c:C});
    if(!ws[addr])continue;
    ws[addr].s={font:{bold:true},fill:{fgColor:{rgb:'2C3E6B'}},};
  }

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Spielerprofile');

  const date=new Date().toISOString().slice(0,10);
  const tag=(currentAlliance()?.tag||'allianz').toLowerCase().replace(/[^a-z0-9]+/g,'');
  XLSX.writeFile(wb,`warsync_${tag}_spieler_${date}.xlsx`);

  const info=document.getElementById('export-info');
  if(info){info.style.display='block';info.textContent=`✓ ${rows.length} Spieler exportiert (${sorted.filter(p=>!isInactive(p.name)).length} aktiv, ${sorted.filter(p=>isInactive(p.name)).length} ausgetreten)`;}
}
// Welche Rechte über dieses Panel überhaupt vergeben werden dürfen. `super_admin`
// steht bewusst NICHT darin: wer über allen Allianzen steht, wird nicht aus einer
// einzelnen Allianz heraus ernannt, sondern in der Datenbank.
const PERM_FELDER=new Set(['ws_admin','profile_edit','alliance_admin']);
export async function adminSetPerm(name,field,val){
  if(!PERM_FELDER.has(field)){console.warn('Unbekanntes Recht:',field);return;}
  if(!canAccess('admin'))return;
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{[field]:val});
    const pl=APP.data.players.find(p=>p.name===name);
    if(pl)pl[field]=val;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
// Admin-Rechte aus der Zugangsverwaltung heraus vergeben. Bewusst mit Rückfrage:
// der Empfänger darf danach alles in dieser Allianz, dieses Panel eingeschlossen.
// Es geht über adminSetPerm und damit durch dieselbe Prüfung wie die Schalter
// unter „Berechtigungen" — ein zweiter Schreibweg entstünde sonst daneben.
export async function adminToggleAllianceAdmin(name){
  if(!canAccess('admin'))return;
  const pl=APP.data.players.find(p=>p.name===name);
  if(!pl)return;
  // Der Super-Admin steht über der Allianz; sein Recht hängt nicht an dieser Spalte.
  if(pl.super_admin)return;
  const an=!pl.alliance_admin;
  const al=currentAlliance();
  const wo=al?.tag?` der Allianz ${al.tag}`:' dieser Allianz';
  const frage=an
    ?`„${name}" zum Admin${wo} machen?\n\nDarf danach alles in dieser Allianz: Aufstellungen, Ergebnisse, Zugänge, Passwörter und Rechte — dieses Panel eingeschlossen.`
    :`„${name}" die Admin-Rechte${wo} entziehen?`;
  if(!confirm(frage))return;
  await adminSetPerm(name,'alliance_admin',an);
}
export async function adminSetAccess(name,val){
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{access_enabled:val});
    const pl=APP.data.players.find(p=>p.name===name);
    if(pl)pl.access_enabled=val;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function adminSetCanResetPw(name,val){
  try{
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{can_reset_password:val});
    const pl=APP.data.players.find(p=>p.name===name);
    if(pl)pl.can_reset_password=val;
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function adminPromptSetPassword(name){
  const pw=(prompt(`Neues Passwort für „${name}":\n(min. 4 Zeichen — wird im Klartext angezeigt)`,'')||'').trim();
  if(!pw)return; // abgebrochen oder leer
  if(pw.length<4){alert('Passwort muss mindestens 4 Zeichen haben.');return;}
  try{
    const hash=await sha256(pw);
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{password_hash:hash,access_enabled:true});
    const pl=APP.data.players.find(p=>p.name===name);
    if(pl){pl.password_hash=hash;pl.access_enabled=true;}
    alert(`✓ Passwort für „${name}" gesetzt. Zugang aktiviert.`);
    renderPage();
  }catch(e){alert('Fehler: '+e.message);}
}
export async function adminMergePlayers(){
  const src=document.getElementById('merge-src')?.value;
  const dst=document.getElementById('merge-dst')?.value;
  const res=document.getElementById('merge-result');
  const btn=document.getElementById('merge-btn');
  function showRes(msg,ok){if(res){res.style.display='block';res.style.background=ok?'#eafaf1':'#fdecea';res.style.color=ok?'var(--win)':'var(--loss)';res.innerHTML=msg;}}
  if(!src||!dst){showRes('Bitte beide Spieler auswählen.',false);return;}
  if(src===dst){showRes('Quelle und Ziel sind identisch.',false);return;}
  if(!confirm(`"${src}" → "${dst}" zusammenführen?\n\nAlle Daten von "${src}" werden auf "${dst}" übertragen, dann wird "${src}" gelöscht.`))return;
  if(btn){btn.textContent='Läuft…';btn.disabled=true;}
  try{
    const srcE=encodeURIComponent(src);
    // Alle drei Aufrufe laufen über die API-Schicht und damit ausschließlich
    // innerhalb der gerade gezeigten Allianz — ein gleichnamiger Spieler in einer
    // anderen Allianz bleibt unberührt.
    try{await sbPatch('ws_participation','player_name=eq.'+srcE,{player_name:dst});}
    catch(e){throw new Error('ws_participation: '+e.message);}
    try{await sbPatch('vs_entries','player_name=eq.'+srcE,{player_name:dst});}
    catch(e){throw new Error('vs_entries: '+e.message);}
    await sbPatch('ws_player_history','player_name=eq.'+srcE,{player_name:dst});
    try{await sbDelete('ws_players','name=eq.'+srcE);}
    catch(e){throw new Error('Löschen: '+e.message);}
    APP.data.players=await sbGet('ws_players?order=name.asc&select=name,role,access_enabled,password_hash');
    showRes(`✓ "${src}" wurde mit "${dst}" vereint und gelöscht.`,true);
    setTimeout(()=>renderPage(),1500);
  }catch(e){showRes('Fehler: '+e.message,false);}
  if(btn){btn.textContent='🔀 Zusammenführen';btn.disabled=false;}
}
export async function adminCreatePlayer(){
  const name=(document.getElementById('new-pl-name')?.value||'').trim();
  if(!name){alert('Bitte Spielername eingeben.');return;}
  if(APP.data.players.find(p=>p.name.toLowerCase()===name.toLowerCase())){alert('Spieler mit diesem Namen existiert bereits.');return;}
  const role=document.getElementById('new-pl-role')?.value||'R3';
  const profession=document.getElementById('new-pl-prof')?.value||'Ingenieur';
  const v=k=>{const n=parseFloat(document.getElementById('new-pl-'+k)?.value);return isNaN(n)||n<=0?null:n;};
  const t1=v('t1'),t2=v('t2'),t3=v('t3'),t4=v('t4');
  // Eingetragen wird in Mio, gespeichert absolut — wie im Profil (`manHP`).
  const hpMio=v('hp');
  const hero_power=hpMio?Math.round(hpMio*1e6):null;
  const btn=document.getElementById('new-pl-btn');
  const res=document.getElementById('new-pl-result');
  if(btn){btn.textContent='Wird angelegt…';btn.disabled=true;}
  try{
    const payload={name,role,profession,active:true};
    if(t1)payload.t1=t1;if(t2)payload.t2=t2;if(t3)payload.t3=t3;if(t4)payload.t4=t4;
    if(hero_power)payload.hero_power=hero_power;
    if(t1||t2||t3||t4||hero_power)payload.t1_updated_at=new Date().toISOString();
    await sbPost('ws_players',[payload]);
    // History-Eintrag wenn Stärke angegeben — die Heldenkraft zählt mit, sonst
    // beginnt ihr Verlauf erst beim ersten Bearbeiten statt beim Anlegen.
    if(t1||t2||t3||t4||hero_power){
      await sbPost('ws_player_history',[{player_name:name,t1,t2,t3,t4,hero_power,changed_by:APP.user?.playerName||APP.user?.username||'admin'}]);
    }
    // Lokalen Cache aktualisieren
    APP.data.players.push({...payload,id:Date.now()});
    if(res){res.style.display='block';res.style.background='#eafaf1';res.style.borderLeft='4px solid var(--win)';res.textContent='✓ Spieler "'+name+'" wurde angelegt.';}
    // Felder zurücksetzen
    ['new-pl-name','new-pl-t1','new-pl-t2','new-pl-t3','new-pl-t4','new-pl-hp'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('new-pl-role').value='R3';
    document.getElementById('new-pl-prof').value='Ingenieur';
  }catch(e){
    if(res){res.style.display='block';res.style.background='#fdf2f2';res.style.borderLeft='4px solid var(--loss)';res.textContent='Fehler: '+e.message;}
  }
  if(btn){btn.textContent='➕ Spieler anlegen';btn.disabled=false;}
}
export function adminSetVisionUrl(){
  const v=(document.getElementById('adm-vision-url')?.value||'').trim();
  if(v)localStorage.setItem('visionUrl',v.replace(/\/$/,''));
  renderPage();
}
export function admMemPreview(){
  const files=document.getElementById('adm-mem-shots')?.files;
  const box=document.getElementById('adm-mem-previews');
  if(!files||!box)return;
  box.innerHTML='';
  Array.from(files).forEach(f=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=document.createElement('img');
      img.src=e.target.result;
      img.style.cssText='height:100px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer';
      img.onclick=()=>window.open(e.target.result);
      box.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}
export async function admAnalyzeMembers(){
  const files=document.getElementById('adm-mem-shots')?.files;
  if(!files||!files.length){alert('Bitte zuerst Screenshots auswählen.');return;}
  const btn=document.getElementById('adm-mem-btn');
  const statusEl=document.getElementById('adm-mem-status');
  const resultEl=document.getElementById('adm-mem-result');
  if(btn){btn.disabled=true;btn.textContent='⏳ Analysiere…';}
  if(statusEl)statusEl.textContent='';
  if(resultEl)resultEl.innerHTML='';
  try{
    const images=await Promise.all(Array.from(files).map(f=>new Promise((res,rej)=>{
      const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(f);
    })));
    const knownPlayers=APP.data.players.map(p=>p.name);
    const resp=await fetch(VISION_URL()+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,known_players:knownPlayers})});
    if(!resp.ok)throw new Error(`Vision-Server: HTTP ${resp.status}`);
    const data=await resp.json();
    if(data.error)throw new Error(data.error);
    const detected=new Set((data.players||[]).map(p=>{
      const n=p.name||'';
      return n.replace(/^\[[^\]]+\]\s*/,'').replace(/\s*\[[^\]]+\]$/,'').trim();
    }).filter(Boolean));
    // Vergleich mit aktiven DB-Spielern
    const activePlayers=APP.data.players.filter(p=>p.active!==false);
    const activeNames=new Set(activePlayers.map(p=>p.name));
    // Neu: in Screenshots, nicht in DB
    const neuList=[...detected].filter(n=>!APP.data.players.find(p=>p.name===n));
    // Rückkehrer: in Screenshots, aber in DB als inaktiv geführt
    const backList=APP.data.players.filter(p=>p.active===false&&detected.has(p.name));
    // Nicht mehr gesehen: aktiv in DB, nicht in Screenshots
    const weggList=activePlayers.filter(p=>!detected.has(p.name));
    if(resultEl)resultEl.innerHTML=admMemDiffHtml(detected.size,neuList,weggList,backList);
    if(statusEl)statusEl.innerHTML=`<span style="color:var(--win)">✓ ${detected.size} Spieler erkannt</span>`;
  }catch(e){
    if(statusEl)statusEl.innerHTML=`<span style="color:var(--loss)">❌ ${e.message}</span>`;
  }
  if(btn){btn.disabled=false;btn.textContent='🔍 Analysieren';}
}
export function admMemDiffHtml(total,neuList,weggList,backList){
  backList=backList||[];
  let h=`<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--tx3)">${total} Spieler auf Screenshots erkannt</div>`;
  if(!neuList.length&&!weggList.length&&!backList.length){
    return h+`<div class="note" style="color:var(--win)">✓ Keine Unterschiede — Mitgliederliste ist aktuell.</div>`;
  }
  if(backList.length){
    const rows=backList.map(p=>`<tr>
      <td style="font-weight:600">${p.name}</td>
      <td><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" class="adm-mem-back-chk" data-name="${p.name.replace(/"/g,'&quot;')}" checked style="width:16px;height:16px">
        Reaktivieren
      </label></td></tr>`).join('');
    h+=`<div class="card" style="margin-bottom:10px;border-left:3px solid var(--win)">
      <div class="ch" style="color:var(--win)">↩ Rückkehrer (${backList.length})</div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Als ausgetreten geführt, aber wieder auf den Screenshots — Daten und Historie bleiben erhalten.</div>
      <div class="scroll-x"><table style="width:100%"><thead><tr><th>Spieler</th><th>Aktion</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }
  if(neuList.length){
    const rows=neuList.map(n=>`<tr>
      <td style="font-weight:600">${n}</td>
      <td><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" class="adm-mem-neu-chk" data-name="${n.replace(/"/g,'&quot;')}" checked style="width:16px;height:16px">
        Neu anlegen
      </label></td></tr>`).join('');
    h+=`<div class="card" style="margin-bottom:10px;border-left:3px solid #2980b9">
      <div class="ch" style="color:#2980b9">➕ Neu in Screenshots (${neuList.length})</div>
      <div class="scroll-x"><table style="width:100%"><thead><tr><th>Spieler</th><th>Aktion</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }
  if(weggList.length){
    const rows=weggList.map(p=>`<tr>
      <td style="font-weight:600">${p.name}</td>
      <td><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" class="adm-mem-inakt-chk" data-name="${p.name.replace(/"/g,'&quot;')}" checked style="width:16px;height:16px">
        Inaktiv setzen
      </label></td></tr>`).join('');
    h+=`<div class="card" style="margin-bottom:10px;border-left:3px solid var(--loss)">
      <div class="ch" style="color:var(--loss)">⚠️ Nicht auf Screenshots (${weggList.length})</div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Diese aktiven Spieler wurden auf keinem Screenshot erkannt.</div>
      <div class="scroll-x"><table style="width:100%"><thead><tr><th>Spieler</th><th>Aktion</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }
  h+=`<button class="btn btn-sol" style="width:100%;margin-top:4px" onclick="admApplyMemberChanges()">✅ Änderungen übernehmen</button>`;
  return h;
}
export async function admApplyMemberChanges(){
  const neuChecked=[...document.querySelectorAll('.adm-mem-neu-chk:checked')].map(el=>el.dataset.name);
  const inaktChecked=[...document.querySelectorAll('.adm-mem-inakt-chk:checked')].map(el=>el.dataset.name);
  const backChecked=[...document.querySelectorAll('.adm-mem-back-chk:checked')].map(el=>el.dataset.name);
  if(!neuChecked.length&&!inaktChecked.length&&!backChecked.length){alert('Keine Änderungen ausgewählt.');return;}
  const btn=document.querySelector('[onclick="admApplyMemberChanges()"]');
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    for(const name of neuChecked){
      try{await sbPost('ws_players',{name,role:'R3',access_enabled:false,active:true});}
      catch(e){throw new Error('Neu anlegen ('+name+'): '+e.message);}
    }
    for(const name of backChecked){
      try{await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{active:true});}
      catch(e){throw new Error('Reaktivieren ('+name+'): '+e.message);}
    }
    for(const name of inaktChecked){
      try{await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{active:false});}
      catch(e){throw new Error('Inaktiv ('+name+'): '+e.message);}
      delete APP.teamAssign[name];
      delete APP.csTeamAssign[name];
    }
    if(inaktChecked.length){saveWSState();csSaveState();}
    const players=await sbGet('ws_players?order=name.asc');
    APP.data.players=players;
    renderPage();
    // Kurz warten bis DOM neu gerendert, dann Erfolgsmeldung einblenden
    setTimeout(()=>{
      const resultEl=document.getElementById('adm-mem-result');
      if(resultEl)resultEl.innerHTML=`<div class="note" style="color:var(--win)">✓ ${neuChecked.length} Spieler angelegt, ${backChecked.length} reaktiviert, ${inaktChecked.length} inaktiv gesetzt.</div>`;
    },50);
  }catch(e){
    alert('Fehler: '+e.message);
    if(btn){btn.textContent='✅ Änderungen übernehmen';btn.disabled=false;}
  }
}
export async function adminCheckVision(){
  const el=document.getElementById('adm-vision-health');
  if(el)el.innerHTML='<span style="color:var(--tx3)">⏳ Prüfe…</span>';
  try{
    const r=await fetch(VISION_URL()+'/health',{signal:AbortSignal.timeout(5000)});
    const d=await r.json();
    if(el)el.innerHTML=`<span style="color:var(--win)">✓ Server erreichbar · Ollama: ${d.ollama?'✓':'✗'} · Modelle: ${(d.models||[]).join(', ')||'–'}</span>`;
  }catch(e){
    if(el)el.innerHTML=`<span style="color:var(--loss)">✗ Nicht erreichbar: ${e.message}</span>`;
  }
}
export async function adminSetPassword(){
  const name=document.getElementById('pw-player')?.value;
  const pw=document.getElementById('pw-new')?.value?.trim();
  const res=document.getElementById('pw-result');
  const btn=document.getElementById('pw-save-btn');
  if(!name||!pw){if(res){res.style.display='block';res.style.background='#fdecea';res.style.color='var(--loss)';res.textContent='Bitte Spieler und Passwort eingeben.';}return;}
  if(pw.length<4){if(res){res.style.display='block';res.style.background='#fdecea';res.style.color='var(--loss)';res.textContent='Passwort muss mindestens 4 Zeichen haben.';}return;}
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    const hash=await sha256(pw);
    await sbPatch('ws_players','name=eq.'+encodeURIComponent(name),{password_hash:hash,access_enabled:true});
    const pl=APP.data.players.find(p=>p.name===name);
    if(pl){pl.password_hash=hash;pl.access_enabled=true;}
    document.getElementById('pw-new').value='';
    if(res){res.style.display='block';res.style.background='#eafaf1';res.style.color='var(--win)';res.textContent=`✓ Passwort für „${name}" gesetzt. Zugang wurde automatisch aktiviert.`;}
    renderPage();
  }catch(e){if(res){res.style.display='block';res.style.background='#fdecea';res.style.color='var(--loss)';res.textContent='Fehler: '+e.message;}}
  finally{if(btn){btn.textContent='🔑 Passwort speichern';btn.disabled=false;}}
}
