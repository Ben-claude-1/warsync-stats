import { render } from '../app/render.js';
import { renderShell } from '../app/shell.js';
import { doLogin, loadData } from '../core/auth.js';
import { LANG, setLang } from '../core/i18n.js';
import { DEMO_USERS } from '../core/players.js';
import { APP } from '../core/state.js';

// ====== LOGIN ======
export function renderLogin(){
  document.getElementById('app').innerHTML=`
    <div class="login-wrap"><div class="login-card">
      <div class="login-icon"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
      <div class="login-title">WarSync Stats</div>
      <div class="login-sub">Phoenix R1sing #1668</div>
      <div id="login-err" style="display:none;background:#fdecea;border-left:3px solid var(--loss);padding:9px 12px;border-radius:8px;font-size:13px;color:var(--loss);margin-bottom:12px"></div>
      <div class="fl"><label>Spielername</label><input class="inp" id="lu" type="text" placeholder="Dein Spielername" onkeydown="if(event.key==='Enter')document.getElementById('lp').focus()"></div>
      <div class="fl"><label>Passwort</label><input class="inp" id="lp" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')doLogin()"></div>
      <button class="btn-pri" id="login-btn" onclick="doLogin()">Anmelden</button>
      <div class="lang-sw">
        <button class="lang-b${LANG==='de'?' on':''}" onclick="setLang('de')">🇩🇪 Deutsch</button>
        <button class="lang-b${LANG==='en'?' on':''}" onclick="setLang('en')">🇬🇧 English</button>
      </div>
      <div style="margin-top:14px;font-size:11px;color:#aaa;text-align:center">Keinen Zugang? Wende dich an den Admin.</div>
    </div></div>`;}
export function demoLogin(un){const u=DEMO_USERS.find(x=>x.username===un);if(!u)return;APP.user={...u};renderShell();loadData();}
export function logout(){APP.user=null;APP.page='home';APP.synced=false;render();}
