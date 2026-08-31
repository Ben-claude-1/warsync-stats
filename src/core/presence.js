import { sbDelete, sbGet, sbUpsert } from './api.js';
import { APP } from './state.js';
import { AID } from './tenant.js';
import { presenzListeHtml } from '../ui/admin.js';

// ══════════════════════════════════════════════════════════════════
//  ANWESENHEIT — wer ist gerade angemeldet
// ══════════════════════════════════════════════════════════════════
// Die Anmeldung lebt ausschließlich im Browser-Tab (APP.user); es gibt keine
// Sitzung auf dem Server, die man abfragen könnte. Wer gerade da ist, kann
// deshalb nur der Client selbst melden: jeder angemeldete Tab schreibt im
// Minutentakt seine Zeile in `ws_presence` fort.
//
// Drei Entscheidungen, die zusammengehören:
//
// · **Zeitstempel statt Flag.** Wer den Tab zumacht oder das Netz verliert,
//   meldet sich nicht ab. Ein Flag `online` stünde danach für immer auf „an";
//   ein `last_seen` verfällt von selbst.
// · **Nur der sichtbare Tab schlägt.** Ein Tab im Hintergrund heißt nicht, dass
//   jemand am Gerät sitzt. Ein weggelegtes Handy fällt so nach ein paar Minuten
//   aus der Liste und steht danach als „vor 10 Min" da — das ist die ehrlichere
//   Auskunft.
// · **Je Gerät eine Zeile.** Derselbe Mensch an Handy und Laptop sind zwei
//   Sitzungen. Ohne `device_id` im Schlüssel überschrieben sie sich gegenseitig
//   und die Anzeige zeigte willkürlich eines von beiden.
export const PRESENCE_BEAT_MS=60000;       // Herzschlag: einmal pro Minute
export const PRESENCE_TICK_MS=30000;       // Takt des Wächters (Anzeige nachladen)
export const PRESENCE_ONLINE_MS=180000;    // bis 3 Min ohne Herzschlag gilt als „gerade da"
const DEVICE_LS='ws_device_id';

// Die Geräte-ID gehört dem Browser, nicht der Allianz — sie bleibt über einen
// Wechsel hinweg dieselbe und trägt deshalb kein lsKey()-Suffix.
export function deviceId(){
  try{
    let id=localStorage.getItem(DEVICE_LS);
    if(!id){
      id=(crypto.randomUUID?crypto.randomUUID():'d'+Math.random().toString(36).slice(2)+Date.now().toString(36));
      localStorage.setItem(DEVICE_LS,id);
    }
    return id;
  }catch(e){
    // Privates Fenster ohne localStorage: dann eben je Seitenaufruf ein neues Gerät.
    if(!_fallbackId)_fallbackId='tmp-'+Math.random().toString(36).slice(2);
    return _fallbackId;
  }
}
let _fallbackId=null;

// Grobes Etikett statt des vollen User-Agent. Für „Ben ist am Handy dran" reicht
// das; die vollständige Kennung im Klartext bei jedem Mitglied zu speichern wäre
// mehr, als die Anzeige braucht.
export function deviceLabel(){
  const ua=navigator.userAgent||'';
  if(/iPhone/i.test(ua))return'iPhone';
  if(/iPad/i.test(ua))return'iPad';
  if(/Android/i.test(ua))return/Mobile/i.test(ua)?'Android':'Android-Tablet';
  if(/Macintosh/i.test(ua))return'Mac';
  if(/Windows/i.test(ua))return'Windows';
  if(/Linux/i.test(ua))return'Linux';
  return'Browser';   // sprachneutral: die Etiketten laufen nicht durch die Übersetzung
}

let _beatTimer=null,_lastBeat=0,_lastAid=null,_seit=null;

// Ein Herzschlag. Bewusst leise: scheitert er, ist das die Anwesenheitsanzeige
// und nicht die Arbeit des Nutzers — eine Fehlermeldung wäre hier nur Lärm.
export async function presenceBeat(){
  const user=APP.user;const aid=AID();
  if(!user||!aid)return;
  // Nach einem Wechsel der Allianz bleibt sonst die Zeile in der alten stehen und
  // zeigt dort noch minutenlang jemanden an, der längst woanders schaut.
  if(_lastAid&&_lastAid!==aid)await presenceRemove(_lastAid);
  _lastAid=aid;_lastBeat=Date.now();
  try{
    await sbUpsert('ws_presence',{
      player_name:user.playerName,
      device_id:deviceId(),
      device:deviceLabel(),
      page:APP.page||'home',
      // Beginn DIESER Anmeldung, bei jedem Schlag mitgeschickt. Ließe man das Feld
      // weg, bliebe der Wert der vorigen Sitzung stehen — die Anzeige behauptete
      // dann „angemeldet seit gestern 09:00" für jemanden, der eben erst kam.
      first_seen:_seit||new Date().toISOString(),
      last_seen:new Date().toISOString(),
    },'alliance_id,player_name,device_id');
  }catch(e){console.warn('Anwesenheit nicht gemeldet:',e.message);}
}

// Zeile dieses Geräts wegräumen — beim Abmelden und beim Wechsel der Allianz.
export async function presenceRemove(aid){
  const user=APP.user;
  if(!user)return;
  try{
    await sbDelete('ws_presence',
      'player_name=eq.'+encodeURIComponent(user.playerName)+'&device_id=eq.'+encodeURIComponent(deviceId()),
      aid?{alliance:aid}:undefined);
  }catch(e){console.warn('Anwesenheit nicht abgemeldet:',e.message);}
}

export async function presencePull(){
  try{
    APP.presence=await sbGet('ws_presence?order=last_seen.desc');
  }catch(e){console.warn('Anwesenheit nicht ladbar:',e.message);}
  return APP.presence;
}

// Der Takt läuft, solange jemand angemeldet ist. Er tut zweierlei: den eigenen
// Herzschlag (höchstens einmal pro Minute) und — nur wenn die Anwesenheitsliste
// gerade offen ist — das Nachladen der fremden Zeilen.
function tick(){
  if(!APP.user)return;
  if(document.visibilityState==='visible'&&Date.now()-_lastBeat>=PRESENCE_BEAT_MS-1000)presenceBeat();
  if(APP.page==='admin'&&document.visibilityState==='visible')presencePull().then(presenceRefreshCard);
}
export function presenceStart(){
  presenceStop();
  _lastBeat=0;_lastAid=null;_seit=new Date().toISOString();
  presenceBeat();
  _beatTimer=setInterval(tick,PRESENCE_TICK_MS);
  document.addEventListener('visibilitychange',_onVis);
}
function _onVis(){if(document.visibilityState==='visible')tick();}
export function presenceStop(){
  if(_beatTimer){clearInterval(_beatTimer);_beatTimer=null;}
  document.removeEventListener('visibilitychange',_onVis);
}

// Die Karte im Admin-Bereich frischt sich selbst auf, statt die ganze Seite neu
// zu rendern: dort stehen Eingabefelder (neuer Spieler, Passwort), deren Inhalt
// ein renderPage() alle 30 Sekunden wegwerfen würde.
export function presenceRefreshCard(){
  const el=document.getElementById('adm-presence-body');
  if(el)el.innerHTML=presenzListeHtml();
}
