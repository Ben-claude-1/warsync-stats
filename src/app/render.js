import { renderShell } from './shell.js';
import { APP } from '../core/state.js';
import { pageAdmin } from '../ui/admin.js';
import { pageAllianz } from '../ui/allianz.js';
import { pageCS } from '../ui/cs.js';
import { pageHome } from '../ui/home.js';
import { renderLogin } from '../ui/login.js';
import { pageProfil } from '../ui/profil.js';
import { pageRankings } from '../ui/rankings.js';
import { pageUmfragen } from '../ui/umfragen.js';
import { pageVS } from '../ui/vs.js';
import { pageWS } from '../ui/ws.js';
import { pageZugfahrt } from '../ui/zugfahrt.js';

// ====== RENDER ENGINE ======
export function render(){if(!APP.user){renderLogin();return;}renderShell();}
export function renderPage(){const el=document.getElementById('pc');if(!el)return;switch(APP.page){case'home':el.innerHTML=pageHome();break;case'ws':el.innerHTML=pageWS();break;case'cs':el.innerHTML=pageCS();break;case'vs':el.innerHTML=pageVS();break;case'zugfahrt':el.innerHTML=pageZugfahrt();break;case'allianz':el.innerHTML=pageAllianz();break;case'umfragen':el.innerHTML=pageUmfragen();break;case'profil':el.innerHTML=pageProfil();break;case'admin':el.innerHTML=pageAdmin();break;case'rankings':pageRankings(el);break;default:el.innerHTML=pageHome();}}
export function nav(p){APP.page=p;renderShell();}
export function setTeam(t){APP.team=t;APP.wsEventId=null;renderPage();}
export function setWSView(v){APP.wsView=v;APP.wsEventId=null;APP.selectedPlayer=null;APP.wsErfassen=false;renderPage();}
