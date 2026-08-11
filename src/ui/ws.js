import { renderPage, setWSView } from '../app/render.js';
import { sbGet, sbPatch } from '../core/api.js';
import { KEY, SB, VISION_URL, visionErr } from '../core/config.js';
import { badge, canAccess, fmt, fmtK, getLineup, serverZeit, wsPower, zeitLang } from '../core/helpers.js';
import { LOC } from '../core/i18n.js';
import { isInactive } from '../core/players.js';
import { APP } from '../core/state.js';
import { saveWSState, wsAnmeldung, wsErfassenView, wsMailExport, wsSpieler } from './buildings.js';
import { openPlayer } from './overlay.js';
import { resizeImageForOcr } from './profil.js';
import { _nameSimilarity, wsAufstellung } from './vs.js';

// ========== WÜSTENSTURM ==========
export function getNextFriday(){
  const now=new Date();
  const day=now.getDay(); // 0=So..5=Fr..6=Sa (Lokalzeit)
  const add=day<=5?5-day:6;
  // Lokales Datum verwenden (kein UTC-Offset-Problem)
  const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+add);
  return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// ── Startzeiten ───────────────────────────────────────────────────────────────
// Der Wüstensturm läuft zu einer von drei europäischen Zeiten. Üblich sind
// Team A um 13:00 und Team B um 22:00; das ist die Vorgabe, umstellbar ist es
// je Team. Die Serverzeit steht überall daneben (zeitLang) — im Spiel wird
// danach angesagt.
export const WS_ZEITEN=['13:00','22:00','03:00'];
export const WS_ZEIT_STD={A:'13:00',B:'22:00'};
export function wsZeit(t){
  const z=APP.wsTime&&APP.wsTime[t];
  return WS_ZEITEN.includes(z)?z:(WS_ZEIT_STD[t]||WS_ZEITEN[0]);
}
// Die Zeit gehört zum Event, nicht nur zur Anzeige: der kommende Freitag steht
// mit `time_slot` in ws_events und wird mitgezogen. Vergangene Events bleiben
// unberührt — dort gilt, wann tatsächlich gespielt wurde.
export async function setWsZeit(t,z){
  if(!WS_ZEITEN.includes(z))return;
  if(!APP.wsTime)APP.wsTime={...WS_ZEIT_STD};
  if(wsZeit(t)===z)return;
  APP.wsTime[t]=z;
  saveWSState();renderPage();
  if(!canAccess('ws'))return;
  const friday=getNextFriday();
  const ev=APP.data.events.find(e=>e.event_date===friday&&e.team===t);
  if(!ev)return;
  try{
    await sbPatch('ws_events','id=eq.'+ev.id,{time_slot:z});
    ev.time_slot=z;
  }catch(e){
    alert('Die Uhrzeit ist gespeichert, konnte aber nicht ans Event vom '+friday+' geschrieben werden:\n'+(e&&e.message||e));
  }
}
// Umschalter für die Startzeit — steht über der Aufstellung, wo beide Zeiten
// ohnehin ausgewiesen werden.
export function wsZeitPicker(t){
  const cur=wsZeit(t);
  return`<div class="card" style="margin-bottom:10px">
    <div class="cb" style="padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Startzeit Team ${t}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${WS_ZEITEN.map(z=>`<button class="btn btn-sm ${z===cur?'btn-sol':'btn-out'}" style="flex:1;min-width:104px;font-size:11px" onclick="setWsZeit('${t}','${z}')">
          ${z} EU<div style="font-size:10px;font-weight:600;opacity:.75">${serverZeit(z)} Server</div></button>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--tx3);margin-top:7px">Gilt für das Event am ${getNextFriday()} und für alle Aufstellungs-Bilder.</div>
    </div>
  </div>`;
}

// ── Ersatzspieler ─────────────────────────────────────────────────────────────
// Pro Team dürfen 20 Spieler gemeldet werden plus 10 Ersatzspieler. In
// APP.teamAssign steht deshalb 'A'/'B' für gesetzte und 'AE'/'BE' für
// Ersatzspieler. Die alten Werte 'A'/'B' bleiben damit gültig — gespeicherte
// Stände brauchen keine Migration.
export const WS_MAX_GESETZT=20, WS_MAX_ERSATZ=10;
export function wsTeamOf(v){return v==='A'||v==='AE'?'A':v==='B'||v==='BE'?'B':null;}
export function wsIstErsatz(v){return v==='AE'||v==='BE';}
export function wsSlot(team,ersatz){return team+(ersatz?'E':'');}
// Zählt die Einteilung: wsZaehle('A') = gesetzte in Team A, wsZaehle('A',true) = Ersatz
export function wsZaehle(team,ersatz){
  return Object.values(APP.teamAssign||{}).filter(v=>wsTeamOf(v)===team&&wsIstErsatz(v)===!!ersatz).length;
}
// Alle Namen eines Teams — gesetzte und Ersatz, oder gezielt eine der beiden Gruppen
export function wsNamen(team,ersatz){
  return Object.entries(APP.teamAssign||{})
    .filter(([,v])=>wsTeamOf(v)===team&&(ersatz===undefined||wsIstErsatz(v)===!!ersatz))
    .map(([n])=>n);
}
// Pool für Aufstellung und Auto-Verteilung: gesetzte und Ersatzspieler, ohne
// Ausgetretene. Ersatzspieler stehen ganz normal in der Aufstellung — ob sie
// wirklich spielen können, entscheidet sich erst am Eventtag.
export function wsTeamPool(team){
  return wsNamen(team).filter(n=>!isInactive(n));
}
// Reihenfolge im Pool: erst die Gesetzten, dann der Ersatz — innerhalb der
// Gruppe nach Stärke. Damit greifen die Auto-Verteilung und jede „stärkster
// zuerst"-Liste zuerst auf den gemeldeten Kader zu.
export function wsPoolSort(a,b){
  const ea=wsIstErsatz(APP.teamAssign&&APP.teamAssign[a])?1:0;
  const eb=wsIstErsatz(APP.teamAssign&&APP.teamAssign[b])?1:0;
  return ea!==eb?ea-eb:wsPower(b)-wsPower(a);
}

export async function ensureWeeklyEvents(){
  const friday=getNextFriday();
  // Nur anlegen wenn dieser Freitag noch gar nicht in der DB ist (weder pending noch abgeschlossen)
  const exists=APP.data.events.some(e=>e.event_date===friday);
  if(!exists){
    // Die Prüfung oben sieht nur den lokal geladenen Stand. Öffnen mehrere Geräte
    // die Seite gleichzeitig, kommen sie alle hier an — am 31.07. sind so sieben
    // Event-Paare für denselben Freitag entstanden. Der Unique-Index
    // ws_events_date_team_uidx fängt das jetzt ab, ignore-duplicates macht den
    // zweiten Schreiber zum No-Op statt zum Fehler.
    await fetch(SB+'/rest/v1/ws_events?on_conflict=event_date,team',{method:'POST',
      headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},
      body:JSON.stringify([{event_date:friday,team:'A',time_slot:wsZeit('A'),result:'pending'},{event_date:friday,team:'B',time_slot:wsZeit('B'),result:'pending'}])});
    const ev=await sbGet('ws_events?order=event_date.desc,team.asc');
    APP.data.events=ev;renderPage();
  }
}

// ── Anmeldeschluss: Donnerstag 04:00 ──────────────────────────────────────────
// Bis dahin kann sich jeder für den Freitags-Wüstensturm an- und abmelden.
// Danach steht der Kader fest: die angemeldeten Spieler werden als
// ws_participation-Zeilen (registered=true, played=false) an das Event geschrieben
// und sind damit fix — unabhängig davon, wer danach noch an der Team-Einteilung
// schiebt. Erst dieser Schritt macht aus der Einteilung eine belastbare
// Teilnahmestatistik: vorher lag der Kader nur im Planungsstand und wurde beim
// Erfassen des Ergebnisses aus der *aktuellen* Aufstellung neu abgeleitet.
//
// Der Schnitt läuft im Browser beim Laden. Idempotent ist er über
// ws_events.roster_locked_at: die Spalte wird per bedingtem PATCH
// (roster_locked_at=is.null) gesetzt. Laden zwei Geräte gleichzeitig, bekommt
// genau eines eine Zeile zurück — das andere lässt die Finger davon.
export const WS_CUTOFF_HOUR=4; // Donnerstag, Ortszeit
export function wsAnmeldeschluss(fridayStr){
  const[y,m,d]=fridayStr.split('-').map(Number);
  return new Date(y,m-1,d-1,WS_CUTOFF_HOUR,0,0,0); // Freitag minus 1 Tag = Donnerstag
}
export function wsSchlussVorbei(fridayStr){return new Date()>=wsAnmeldeschluss(fridayStr);}
export function wsIstFixiert(friday,team){
  const ev=APP.data.events.find(e=>e.event_date===friday&&e.team===team);
  return!!(ev&&ev.roster_locked_at);
}

// Schreibt den Kader eines Teams fest. `friday` ist das Event-Datum.
// Gibt zurück, was tatsächlich passiert ist — der Aufrufer entscheidet über die Meldung.
export async function wsFreezeTeam(ev,team){
  // Gesetzte und Ersatzspieler kommen beide in den Kader — der Unterschied steckt
  // in der Spalte `substitute`. Ein Ersatzspieler, der nicht zum Einsatz kam, ist
  // etwas anderes als ein gesetzter Spieler, der nicht angetreten ist.
  const gesetzt=wsNamen(team,false), ersatz=wsNamen(team,true);
  const names=[...gesetzt,...ersatz];
  // Ein leerer Kader darf nie fixiert werden. Sonst sperrt ausgerechnet das Gerät,
  // das die Einteilung noch nicht geladen hat, das Event mit null Spielern zu —
  // dieselbe Falle wie beim Planungsstand, wo ein leerer Stand nie einen gefüllten
  // verdrängen darf.
  if(!names.length)return{team,status:'leer'};
  if(names.length!==new Set(names).size)throw new Error('Doppelte Namen in der Einteilung für Team '+team);
  // Reihenfolge ist wichtig: erst sperren, dann schreiben. Andersherum könnten zwei
  // Geräte beide die Zeilen anlegen und erst danach merken, dass sie zu spät sind.
  const lockRes=await fetch(SB+'/rest/v1/ws_events?id=eq.'+ev.id+'&roster_locked_at=is.null',
    {method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=representation'},
     body:JSON.stringify({roster_locked_at:new Date().toISOString()})});
  if(!lockRes.ok)throw new Error(await lockRes.text());
  const locked=await lockRes.json();
  if(!locked.length)return{team,status:'schon-fixiert'};
  const ersatzSet=new Set(ersatz);
  const rows=names.map(n=>({event_id:ev.id,player_name:n,registered:true,played:false,excused:false,substitute:ersatzSet.has(n)}));
  try{
    // ignore-duplicates: liegt für einen Spieler schon eine Zeile am Event (z.B. weil
    // ein Ergebnis vorab erfasst wurde), bleibt sie unangetastet.
    const r=await fetch(SB+'/rest/v1/ws_participation?on_conflict=event_id,player_name',{method:'POST',
      headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},
      body:JSON.stringify(rows)});
    if(!r.ok)throw new Error(await r.text());
  }catch(e){
    // Sperre zurücknehmen, sonst steht das Event als fixiert da, ohne dass ein
    // Kader drin ist — und niemand käme mehr an die Fixierung heran.
    await sbPatch('ws_events','id=eq.'+ev.id,{roster_locked_at:null}).catch(()=>{});
    throw e;
  }
  return{team,status:'fixiert',count:names.length,gesetzt:gesetzt.length,ersatz:ersatz.length};
}

export async function wsFreezeRoster(friday){
  const evs=await sbGet('ws_events?event_date=eq.'+encodeURIComponent(friday));
  const res=[];
  for(const team of['A','B']){
    const ev=evs.find(e=>e.team===team);
    if(!ev){res.push({team,status:'kein-event'});continue;}
    if(ev.roster_locked_at){res.push({team,status:'schon-fixiert'});continue;}
    res.push(await wsFreezeTeam(ev,team));
  }
  return res;
}

// Beim Laden aufgerufen. Läuft nur bei Schreibrechten — wer nur lesen darf,
// soll den Kader nicht festschreiben.
export async function wsRosterCheck(){
  if(!canAccess('ws'))return;
  const friday=getNextFriday();
  if(!wsSchlussVorbei(friday))return;
  const res=await wsFreezeRoster(friday);
  const neu=res.filter(r=>r.status==='fixiert');
  const fix=res.filter(r=>r.status==='fixiert'||r.status==='schon-fixiert');
  if(neu.length){
    const[ev,pa]=await Promise.all([sbGet('ws_events?order=event_date.desc,team.asc'),sbGet('ws_participation?order=rank.asc')]);
    APP.data.events=ev;APP.data.participation=pa;
  }
  // Die Anzeige folgt der DB, nicht dem lokalen Flag: wer den Schnitt verpasst hat,
  // sieht die Anmeldung trotzdem als geschlossen.
  if(fix.length&&!APP.anmeldungClosed){
    APP.anmeldungClosed=true;
    APP.accepted=[...new Set(Object.entries(APP.teamAssign||{}).filter(([,v])=>v).map(([k])=>k))];
    saveWSState();
  }
  if(neu.length||fix.length)renderPage();
}
export function pageWS(){
  const hasWS=canAccess('ws');
  const v=APP.wsView;
  // Auto-create weekly events (fire and forget)
  if(hasWS)ensureWeeklyEvents().catch(()=>{});
  return`
    <div class="stabs">
      ${hasWS?`<button class="stab${v==='anmeldung'?' on':''}" onclick="setWSView('anmeldung')">Anmeldung</button>`:''}
      ${hasWS?`<button class="stab${v==='aufstellung'?' on':''}" onclick="setWSView('aufstellung')">Aufstellung</button>`:''}
      ${hasWS?`<button class="stab${v==='mail'?' on':''}" onclick="setWSView('mail')">Mail</button>`:''}
      <button class="stab${v==='ergebnis'?' on':''}" onclick="setWSView('ergebnis')">Ergebnisse</button>
      <button class="stab${v==='spieler'?' on':''}" onclick="setWSView('spieler')">Spieler</button>
    </div>
    ${v==='anmeldung'?wsAnmeldung():v==='aufstellung'?wsAufstellung():v==='mail'?wsMailExport():v==='ergebnis'?wsErgebnis():wsSpieler()}`;}

// --- ERGEBNIS (Event-Historie + Drill-Down) ---
export function wsErgebnis(){
  if(APP.wsErfassen)return wsErfassenView();
  if(APP.wsEventId)return wsErgebnisDrilldown(APP.wsEventId);
  const canEdit=canAccess('ws');
  const allEvts=[...APP.data.events].sort((a,b)=>b.event_date.localeCompare(a.event_date));
  // Heutiges Datum (lokal) als Trennlinie
  const now=new Date();
  const todayStr=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  // Pending Events ab heute → "Nächstes Event"
  const upcomingPending=allEvts.filter(e=>(!e.result||e.result==='pending')&&e.event_date>=todayStr);
  const nextDate=upcomingPending.length?[...upcomingPending].sort((a,b)=>a.event_date.localeCompare(b.event_date))[0].event_date:null;
  const nextEvts=nextDate?upcomingPending.filter(e=>e.event_date===nextDate):[];
  const nextIds=new Set(nextEvts.map(e=>e.id));
  // Vergangene Events + heutige Events mit Ergebnis → Ergebnisliste
  const pastEvts=allEvts.filter(e=>e.event_date<todayStr||(e.event_date===todayStr&&!nextIds.has(e.id)));
  // Statistiken nur auf Events mit echtem Ergebnis
  const done=allEvts.filter(e=>e.result&&e.result!=='pending');
  const wins=done.filter(e=>e.result==='win').length;
  const rate=done.length?Math.round(wins/done.length*100):0;
  let h='';
  if(canEdit)h+=`<button class="btn btn-sol btn-sm" onclick="APP.wsErfassen=true;renderPage()" style="margin-bottom:12px;width:100%">+ Ergebnis erfassen</button>`;
  h+=`<div class="sg"><div class="sb"><div class="sb-l">Siege</div><div class="sb-v" style="color:var(--win)">${wins}</div></div><div class="sb"><div class="sb-l">Niederlagen</div><div class="sb-v" style="color:var(--loss)">${done.length-wins}</div></div><div class="sb"><div class="sb-l">Siegquote</div><div class="sb-v" style="color:var(--win)">${rate}%</div></div><div class="sb"><div class="sb-l">Events</div><div class="sb-v">${done.length}</div></div></div>`;
  // Nächstes Event (nur zukünftige pending)
  if(nextEvts.length){
    const d=new Date(nextDate+'T12:00:00');
    const dStr=d.toLocaleDateString(LOC(),{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
    h+=`<div class="card"><div class="ch">Nächstes Event <span class="ch-sub">${dStr}</span></div>`;
    ['A','B'].forEach(team=>{
      const e=nextEvts.find(ev=>ev.team===team);if(!e)return;
      h+=`<div class="mi" style="cursor:pointer;padding-left:22px" onclick="APP.wsEventId='${e.id}';renderPage()">
        <div style="width:36px;height:36px;border-radius:9px;background:var(--acc)22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:var(--acc);flex-shrink:0">?</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700">Team ${team}${e.time_slot?' · '+zeitLang(e.time_slot):''}</div>
          <div style="font-size:11px;color:var(--tx3);margin-top:2px">Ergebnis noch offen</div>
        </div>
        <div style="flex-shrink:0">${badge('Ausstehend','var(--acc)')}</div>
      </div>`;
    });
    h+=`</div>`;
  }
  // Alle vergangenen Events (mit oder ohne Ergebnis)
  if(pastEvts.length){
    const dates=[...new Set(pastEvts.map(e=>e.event_date))];
    h+=`<div class="card"><div class="ch">Ergebnisse <span class="ch-sub">Tippen für Details</span></div>`;
    dates.forEach(date=>{
      const dayEvts=pastEvts.filter(e=>e.event_date===date);
      h+=`<div style="padding:8px 14px 4px;font-size:12px;font-weight:800;color:var(--tx3);background:var(--bg2);border-bottom:1px solid var(--bd);letter-spacing:.3px">${date}</div>`;
      ['A','B'].forEach(team=>{
        const _teamEvts=dayEvts.filter(ev=>ev.team===team);
        const e=_teamEvts.find(ev=>ev.result&&ev.result!=='pending')||_teamEvts[0];
        if(!e)return;
        const isPend=!e.result||e.result==='pending';
        const isW=e.result==='win';
        const c=isPend?'var(--tx3)':isW?'var(--win)':'var(--loss)';
        const label=isPend?'Kein Ergebnis':isW?'Sieg':'Niederlage';
        const icon=isPend?'–':isW?'S':'N';
        const ps=APP.data.participation.filter(p=>p.event_id===e.id);
        const played=ps.filter(p=>p.played).length;
        const diff=e.our_pts&&e.opp_pts?(e.our_pts>e.opp_pts?'+':'')+fmt(e.our_pts-e.opp_pts):'';
        h+=`<div class="mi" style="cursor:pointer;padding-left:22px" onclick="APP.wsEventId='${e.id}';renderPage()">
          <div style="width:36px;height:36px;border-radius:9px;background:${c}22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:${c};flex-shrink:0">${icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">Team ${team}${e.time_slot?' · '+e.time_slot:''}</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">${e.opponent||'Gegner unbekannt'}${diff?' · Diff: '+diff:''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
            ${badge(label,c)}
            ${ps.length?`<span style="font-size:10px;color:var(--tx3)">${played}/${ps.length}</span>`:''}
          </div>
        </div>`;
      });
    });
    h+=`</div>`;
  } else if(!nextEvts.length){
    h+=`<div class="loader">Noch keine Events vorhanden.</div>`;
  }
  h+=wsPlayerStats();
  return h;
}

export function wsPlayerStats(){
  const parts=APP.data.participation;
  if(!parts.length)return'';
  const pmap={};
  parts.forEach(p=>{
    if(!pmap[p.player_name])pmap[p.player_name]={name:p.player_name,reg:0,played:0,pts:0};
    const s=pmap[p.player_name];
    if(p.registered!==false)s.reg++;
    if(p.played){s.played++;if(p.individual_pts)s.pts+=p.individual_pts;}
  });
  const list=Object.values(pmap).filter(p=>p.reg>0&&!isInactive(p.name)).sort((a,b)=>(b.pts-a.pts)||(b.played-a.played));
  if(!list.length)return'';
  const rows=list.map(p=>{
    const ns=p.reg-p.played;
    const rate=p.reg?Math.round(p.played/p.reg*100):0;
    const nc=ns>=3?'var(--loss)':ns>=1?'#e67e22':'var(--win)';
    return`<tr><td><strong style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${p.name.replace(/'/g,"\\'")}')">${p.name}</strong></td><td style="text-align:center">${p.reg}</td><td style="text-align:center;color:var(--win)">${p.played}</td><td style="text-align:center;color:${nc};font-weight:${ns>0?700:400}">${ns}</td><td style="text-align:center">${rate}%</td><td style="text-align:right">${p.pts?fmt(p.pts):'–'}</td></tr>`;
  }).join('');
  return`<div class="card"><div class="ch">Spieler-Statistik <span class="ch-sub">sortiert nach Punkten</span></div><div class="scroll-x"><table><thead><tr><th>Spieler</th><th>Angem.</th><th>Gespielt</th><th>Gefehlt</th><th>Quote</th><th>Punkte ges.</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

export function wsErgebnisDrilldown(eventId){
  const ev=APP.data.events.find(e=>e.id===eventId);
  if(!ev)return`<div class="loader">Event nicht gefunden.</div>`;
  const ps=APP.data.participation.filter(p=>p.event_id===ev.id);
  const played=ps.filter(p=>p.played),missed=ps.filter(p=>!p.played);
  const excused=missed.filter(p=>p.excused),absent=missed.filter(p=>!p.excused);
  const tot=played.reduce((s,p)=>s+(p.individual_pts||0),0);
  const mx=Math.max(...played.map(p=>p.individual_pts||0),1);
  const isW=ev.result==='win',isP=!ev.result||ev.result==='pending';
  const bc=isP?'pend':isW?'win':'loss';
  const rt=isP?'Ausstehend':isW?'SIEG':'NIEDERLAGE';
  let h=`<button class="btn btn-out btn-sm" onclick="APP.wsEventId=null;renderPage()" style="margin-bottom:12px">← Alle Events</button>`;
  h+=`<div class="rbanner ${bc}">
    <div class="rb-date">${ev.event_date}${ev.time_slot?' · '+zeitLang(ev.time_slot):''}</div>
    <div class="rb-res ${bc}">${rt}</div>
    <div class="score-row">
      <div class="sc-block"><div class="sc-name">AR1S</div><div class="sc-pts" style="color:${isP?'var(--acc)':isW?'var(--win)':'var(--loss)'}">${fmt(ev.our_pts)}</div></div>
      <div class="sc-vs">VS</div>
      <div class="sc-block"><div class="sc-name">${ev.opponent||'Gegner'}</div><div class="sc-pts" style="color:var(--tx3)">${fmt(ev.opp_pts)}</div></div>
      ${ev.our_pts&&ev.opp_pts?`<div class="sc-block"><div class="sc-name">Differenz</div><div class="sc-pts" style="color:${ev.our_pts>ev.opp_pts?'var(--win)':'var(--loss)'}">${ev.our_pts>ev.opp_pts?'+':''}${fmt(ev.our_pts-ev.opp_pts)}</div></div>`:''}
    </div></div>`;
  h+=`<div class="sg"><div class="sb"><div class="sb-l">Gespielt</div><div class="sb-v" style="color:var(--win)">${played.length}</div></div><div class="sb"><div class="sb-l">Gefehlt</div><div class="sb-v" style="color:${absent.length?'var(--loss)':'var(--tx3)'}">${absent.length}</div></div><div class="sb"><div class="sb-l">Entschuldigt</div><div class="sb-v" style="color:var(--acc)">${excused.length}</div></div><div class="sb"><div class="sb-l">Quote</div><div class="sb-v" style="color:var(--win)">${ps.length?Math.round(played.length/ps.length*100):0}%</div></div></div>`;
  if(ps.length){
    // Gesamtkraft der Helden statt T1-Truppenstärke: sie ist bei allen Spielern
    // gepflegt (T1 fehlt bei einem Teil) und bildet die Kampfkraft vollständiger ab.
    // Wie zuvor gilt der jüngste Verlaufseintrag, sonst der aktuelle Stammwert.
    const getHeroLatest=name=>{
      const hist=APP.playerHistory[name];
      if(hist&&hist.length>0&&hist[0].hero_power)return hist[0].hero_power;
      return APP.data.players.find(p=>p.name===name)?.hero_power??null;
    };
    const rows=[...played].sort((a,b)=>(b.individual_pts||0)-(a.individual_pts||0)).map(p=>{
      const pct=Math.round((p.individual_pts||0)/mx*100);
      const share=tot?((p.individual_pts||0)/tot*100).toFixed(1):'0';
      const rc=p.rank===1?'#f1c40f':p.rank===2?'#aaa':p.rank===3?'#cd7f32':'var(--tx3)';
      const heroDisp=fmtK(getHeroLatest(p.player_name));
      const inact=isInactive(p.player_name);
      return`<tr style="${inact?'opacity:.45;background:#fafafa':''}"><td style="font-weight:800;color:${rc}">${p.rank||'–'}</td><td><strong style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${p.player_name.replace(/'/g,"\\'")}')"> ${p.player_name}</strong>${inact?` <span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>`:''}</td><td style="color:var(--ass);font-size:12px;white-space:nowrap">${heroDisp}</td><td style="font-weight:700">${fmt(p.individual_pts)}</td><td><div class="bar-w"><div class="bar-bg"><div class="bar-f" style="width:${pct}%;background:${p.rank<=3?'#f1c40f':'var(--primary)'}"></div></div><span style="font-size:10px;color:var(--tx3)">${share}%</span></div></td></tr>`;}).join('');
    const missedRows=missed.map(p=>{const inact=isInactive(p.player_name);const heroDisp=fmtK(getHeroLatest(p.player_name));return`<tr style="opacity:.55;${inact?'background:#fafafa':''}"><td>–</td><td>${p.player_name}${inact?` <span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>`:''}</td><td style="color:var(--ass);font-size:12px;white-space:nowrap">${heroDisp}</td><td>–</td><td>${badge(p.excused?'Entschuldigt':'Gefehlt',p.excused?'var(--acc)':'var(--loss)')}</td></tr>`;}).join('');
    const cqTop=played.find(p=>p.conquest_pts),gaTop=played.find(p=>p.gather_pts),kiTop=played.find(p=>p.kill_pts);
    const kampfRow=(label,color,winner,field)=>winner?`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:${color}0d;border-radius:6px;border-left:3px solid ${color}"><span style="font-size:12px;font-weight:700;color:${color}">${label}</span><span style="font-size:13px;font-weight:800">${winner.player_name}</span><span style="font-size:13px;font-weight:700;color:${color}">${fmt(winner[field])}</span></div>`:'';
    const kampfHtml=[kampfRow('⚔ Eroberung','#e67e22',cqTop,'conquest_pts'),kampfRow('📦 Sammeln','#27ae60',gaTop,'gather_pts'),kampfRow('💀 Kills','#e74c3c',kiTop,'kill_pts')].filter(Boolean).join('');
    if(kampfHtml)h+=`<div class="card"><div class="ch">🏆 Kampfstatus · Top-Scorer</div><div class="cb" style="display:flex;flex-direction:column;gap:5px">${kampfHtml}</div></div>`;
    h+=`<div class="card"><div class="ch">Individuelle Punkte</div><div class="scroll-x"><table><thead><tr><th>#</th><th>Spieler</th><th>🦸 Helden</th><th>Punkte</th><th>Anteil</th></tr></thead><tbody>${rows}${missedRows}</tbody></table></div></div>`;
  }else{h+=`<div class="note">Noch keine Teilnahme-Daten für dieses Event.</div>`;}
  if(canAccess('ws')){
    const eid=eventId;
    const isFuture=ev.event_date>new Date().toISOString().slice(0,10);
    if(isFuture){
      h+=`<div class="card" style="margin-top:12px"><div class="cb" style="color:var(--tx3);font-size:13px;text-align:center;padding:14px">🔒 Zukünftiges Event – Bearbeitung erst ab Eventtag möglich</div></div>`;
    }else{
    const wSel=ev.result==='win',lSel=ev.result==='loss';
    h+=`<div class="card" style="margin-top:12px">
      <div class="ch" style="cursor:pointer;user-select:none" onclick="ddToggleEdit('${eid}')">
        Ergebnis &amp; Spieler bearbeiten
        <span id="dd-arrow-${eid}" style="float:right;font-size:11px;color:var(--tx3);transition:transform .2s">▼</span>
      </div>
      <div id="dd-edit-${eid}" style="display:none" class="cb">
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:var(--tx3);display:block;margin-bottom:4px">Screenshots hochladen (Ergebnis- &amp; Ranking-Screen)</label>
          <input type="file" id="dd-shots-${eid}" multiple accept="image/*" onchange="ddShowPreviews('${eid}')" style="width:100%;padding:6px 0">
          <div id="dd-previews-${eid}" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"></div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
            <button class="btn btn-sol" id="dd-analyze-btn-${eid}" onclick="ddAnalyze('${eid}')">🔍 Analysieren</button>
            <span id="dd-analyze-status-${eid}" style="font-size:12px;color:var(--tx3)"></span>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid var(--bd);margin:12px 0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div class="fl2"><label>Gegner</label><input class="fi" id="dd-opp-${eid}" value="${ev.opponent||''}"></div>
          <div class="fl2"><label>Unsere Punkte</label><input class="fi" id="dd-our-${eid}" type="number" value="${ev.our_pts||''}" oninput="ddAutoRes('${eid}')"></div>
          <div class="fl2"><label>Gegner Punkte</label><input class="fi" id="dd-oppts-${eid}" type="number" value="${ev.opp_pts||''}" oninput="ddAutoRes('${eid}')"></div>
          <div class="fl2"><label>Ergebnis</label>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ok" id="dd-win-${eid}" style="flex:1${wSel?';background:var(--win);color:#fff':''}" onclick="ddSetRes('${eid}','win')">🏆 Sieg</button>
              <button class="btn btn-no" id="dd-loss-${eid}" style="flex:1${lSel?';background:var(--loss);color:#fff':''}" onclick="ddSetRes('${eid}','loss')">💀 Niederlage</button>
            </div>
          </div>
        </div>
        <div style="font-weight:700;font-size:13px;margin:12px 0 4px;color:var(--tx)">Spieler-Teilnahme</div>
        <div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Punkte aus Screenshot werden automatisch zugewiesen · grün = erkannt</div>
        <div class="scroll-x" id="dd-ptable-${eid}">${ddPlayerTableHtml(eid,ev,_ddAnalysis[eid]||[])}</div>
        <button class="btn btn-sol" id="dd-save-${eid}" style="width:100%;margin-top:12px" onclick="ddSave('${eid}')">Änderungen speichern</button>
      </div>
    </div>`;
    } // end !isFuture
  }
  return h;
}

// --- DRILLDOWN EDIT HELPERS ---
export const _ddRes={};
export const _ddExtra={}; // eid → [{name,pts,rank}] Spieler aus Screenshot die nicht im Lauf sind
export const _ddManual={}; // eid → [{name,pts}] manuell hinzugefügte Spieler
export const _ddLineupOnly={}; // eid → [name] Aufstellungs-Spieler ohne ws_participation-Eintrag
export const _ddAnalysis={}; // eid → analysisPlayers vom letzten Screenshot-Scan
// Setzt die Bearbeitung auf den gespeicherten Stand zurück.
//
// Ohne das legt sich eine frühere Screenshot-Auswertung wieder über die
// Datenbankwerte: `_ddAnalysis` überlebt jedes renderPage(), und in
// ddPlayerTableHtml gilt `absent = analysisRun && !aData` — jeder Spieler, den
// jener alte Durchlauf nicht erkannt hat, steht dann als „nicht gefunden" da,
// ohne Haken und mit leerem Punktefeld. Das ist nicht nur Anzeige: ddSave liest
// genau diese Felder und schreibt played=false / individual_pts=null in die
// Datenbank. Ein Klick auf Speichern hätte den echten Stand gelöscht.
export function ddResetEdit(eid){
  delete _ddAnalysis[eid];delete _ddExtra[eid];delete _ddManual[eid];delete _ddRes[eid];
  const ev=APP.data.events.find(e=>e.id===eid);
  const td=document.getElementById('dd-ptable-'+eid);
  if(ev&&td)td.innerHTML=ddPlayerTableHtml(eid,ev,[]);
  // Sieg/Niederlage zurück auf das, was gespeichert ist
  const wb=document.getElementById('dd-win-'+eid),lb=document.getElementById('dd-loss-'+eid);
  const gespeichert=ev&&ev.result;
  if(wb){wb.style.background=gespeichert==='win'?'var(--win)':'';wb.style.color=gespeichert==='win'?'#fff':'';}
  if(lb){lb.style.background=gespeichert==='loss'?'var(--loss)':'';lb.style.color=gespeichert==='loss'?'#fff':'';}
  // Bildauswahl und Statusmeldung des letzten Durchlaufs räumen
  const f=document.getElementById('dd-shots-'+eid);if(f)f.value='';
  const pv=document.getElementById('dd-previews-'+eid);if(pv)pv.innerHTML='';
  const st=document.getElementById('dd-analyze-status-'+eid);if(st)st.innerHTML='';
}
export function ddToggleEdit(eid){
  const box=document.getElementById('dd-edit-'+eid);
  const arr=document.getElementById('dd-arrow-'+eid);
  if(!box)return;
  const open=box.style.display==='none';
  box.style.display=open?'':'none';
  if(arr)arr.style.transform=open?'rotate(180deg)':'';
  // Jedes Öffnen setzt auf dem gespeicherten Stand auf.
  if(open)ddResetEdit(eid);
}
export function ddSetRes(eid,r){
  _ddRes[eid]=r;
  const wb=document.getElementById('dd-win-'+eid);
  const lb=document.getElementById('dd-loss-'+eid);
  if(wb){wb.style.background=r==='win'?'var(--win)':'';wb.style.color=r==='win'?'#fff':'';}
  if(lb){lb.style.background=r==='loss'?'var(--loss)':'';lb.style.color=r==='loss'?'#fff':'';}
}
export function ddAutoRes(eid){
  const our=parseInt(document.getElementById('dd-our-'+eid)?.value)||0;
  const opp=parseInt(document.getElementById('dd-oppts-'+eid)?.value)||0;
  if(our&&opp)ddSetRes(eid,our>opp?'win':'loss');
}
export function ddShowPreviews(eid){
  const files=document.getElementById('dd-shots-'+eid)?.files;
  const box=document.getElementById('dd-previews-'+eid);
  if(!files||!box)return;
  box.innerHTML='';
  Array.from(files).forEach(f=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=document.createElement('img');
      img.src=e.target.result;
      img.style.cssText='height:120px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:pointer';
      img.onclick=()=>window.open(e.target.result);
      box.appendChild(img);
    };
    r.readAsDataURL(f);
  });
}
export function ddPlayerTableHtml(eid,ev,analysisPlayers){
  const ps=APP.data.participation.filter(p=>p.event_id===ev.id);
  const apList=analysisPlayers||[];

  // Aufstellungs-Spieler die noch kein ws_participation-Eintrag haben.
  // Bei fixiertem Kader entfällt das: dann stehen die angemeldeten Spieler schon
  // als Zeilen am Event, und die aktuelle Aufstellung darf da nichts mehr
  // hineinreichen — sie kann sich nach dem Anmeldeschluss noch geändert haben.
  const lineup=ev.roster_locked_at?null:getLineup(ev.team||'A');
  const lineupNames=lineup?[...new Set([
    ...(lineup.z1||[]),...(lineup.z2||[]),...(lineup.z3||[]),...(lineup.z4||[]),
    ...(lineup.ass||[]),...(lineup.ars||[]),...(lineup.sold||[]),...(lineup.sup||[])
  ])].filter(n=>n&&!ps.find(p=>p.player_name===n)):[];
  _ddLineupOnly[eid]=lineupNames;

  // Alle erwarteten Teilnehmer: bestehende DB-Einträge + Aufstellungs-Spieler ohne Eintrag
  const allPs=[...ps,...lineupNames.map(n=>({player_name:n,played:false,individual_pts:null}))];

  // Matched-Map: versuche exakten Treffer, dann Fuzzy (≥85%) gegen allPs
  const aMap={};
  const extras=[];
  apList.forEach(ap=>{
    if(!ap.name)return;
    const name=ap.name.replace(/^\[[^\]]+\]\s*/,'').replace(/\s*\[[^\]]+\]$/,'').trim();
    if(!name)return;
    const cap={...ap,name};
    if(allPs.find(p=>p.player_name===name)){aMap[name]=cap;return;}
    let best=null,bestS=0;
    allPs.forEach(p=>{const s=_nameSimilarity(name,p.player_name);if(s>bestS){best=p;bestS=s;}});
    // Schwelle: längere Namen tolerieren mehr Zeichenfehler (mind. 0.75, bei kurzen Namen 0.85)
    const thresh=best?Math.max(0.75,0.85-Math.max(0,best.player_name.length-8)*0.01):0.85;
    if(bestS>=thresh){aMap[best.player_name]=cap;}
    else extras.push(cap);
  });
  // Manuell hinzugefügte Spieler → direkt in die Teilnahme-Tabelle (wie Lineup-Spieler)
  const manualPs=(_ddManual[eid]||[]).filter(m=>!allPs.find(p=>p.player_name===m.name));
  manualPs.forEach(m=>allPs.push({player_name:m.name,played:false,individual_pts:null,_manual:true}));
  // Manuell hinzugefügte ebenfalls in lineupOnly aufnehmen damit ddSave sie speichert
  _ddLineupOnly[eid]=[...lineupNames,...manualPs.map(m=>m.name)];

  // OCR-Fremdspieler ignorieren — nur Lineup-Spieler können teilgenommen haben
  const allExtras=[];
  _ddExtra[eid]=[];
  const analysisRun=apList.length>0;
  const hasAny=Object.keys(aMap).length>0;

  // Zeilen für alle erwarteten Teilnehmer
  const rows=allPs.length?[...allPs].sort((a,b)=>{
    const aA=aMap[a.player_name],aB=aMap[b.player_name];
    if(aA&&!aB)return -1;if(!aA&&aB)return 1;
    const pA=aA?.pts??a.individual_pts??0;
    const pB=aB?.pts??b.individual_pts??0;
    return pB-pA;
  }).map(p=>{
    const safe=p.player_name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    const aData=aMap[p.player_name];
    const absent=analysisRun&&!aData;
    const pts=aData?.pts!=null?aData.pts:(absent?'':(p.individual_pts??''));
    const played=aData?(aData.pts>0):(absent?false:(p.played??false));
    const hl=aData?';background:rgba(39,174,96,.08)':absent?';background:rgba(231,76,60,.04)':'';
    const badgeHtml=aData
      ?'<span style="color:var(--win);font-size:9px;margin-left:3px">●</span>'
      :absent
        ?'<span style="font-size:9px;color:#e67e22;font-weight:700;background:rgba(230,126,34,.12);padding:1px 4px;border-radius:3px;margin-left:4px">nicht gefunden · Punkte eintragen</span>'
        :'';
    return`<tr id="dd-row-${eid}-${safe}" data-absent="${absent?1:0}" style="vertical-align:middle${hl}">
      <td style="font-size:13px;font-weight:600">${p.player_name}<span id="dd-badge-${eid}-${safe}">${badgeHtml}</span></td>
      <td style="text-align:center"><input type="checkbox" id="dd-pld-${eid}-${safe}"${played?' checked':''}></td>
      <td style="text-align:right"><input type="number" class="fi" id="dd-ipts-${eid}-${safe}" value="${pts}" style="width:100px;text-align:right;padding:3px 6px;font-size:12px;margin:0${absent?';border-color:#e67e22':''}" placeholder="${absent?'Punkte…':'–'}" oninput="ddPtsChange('${eid}','${safe}')"></td>
      <td style="text-align:center;padding:0 4px"><button onclick="ddRemovePlayer('${eid}','${p.player_name.replace(/'/g,"\\'")}',${p.id!=null?`'${p.id}'`:'null'})" style="background:none;border:none;cursor:pointer;font-size:15px;color:#c0392b;padding:2px 6px;border-radius:4px;line-height:1" title="Entfernen">×</button></td>
    </tr>`;
  }).join(''):'';

  // Screenshot-Spieler die nicht zugeordnet wurden → Mapping auf DB-Spieler
  const allDbNames=APP.data.players.map(p=>p.name).sort((a,b)=>a.localeCompare(b));
  const extraRows=[...allExtras].sort((a,b)=>(b.pts||0)-(a.pts||0)).map(ap=>{
    const safe='xtra_'+ap.name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    // Vorschlag: bestes Fuzzy-Match — nur bereits per OCR gematchte Spieler ausschließen
    let suggName='';let suggScore=0;
    allDbNames.forEach(n=>{const s=_nameSimilarity(ap.name,n);if(s>suggScore&&!aMap[n]){suggName=n;suggScore=s;}});
    const opts='<option value="">— ignorieren —</option>'+allDbNames
      .filter(n=>!aMap[n])
      .map(n=>`<option value="${n.replace(/"/g,'&quot;')}"${n===suggName&&suggScore>0.2?' selected':''}>${n}</option>`).join('');
    return`<tr style="vertical-align:middle;background:rgba(230,126,34,.06)">
      <td colspan="3" style="padding:6px 4px">
        <div style="font-size:11px;color:#e67e22;font-weight:700;margin-bottom:4px">⚠ Nicht erkannt: <em>${ap.name}</em> (${ap.pts?ap.pts.toLocaleString('de'):'–'} Pkt) → Spieler zuweisen:</div>
        <select class="fi" id="dd-map-${eid}-${safe}" style="width:100%;padding:4px 8px;font-size:12px" onchange="ddMapChange('${eid}','${safe}',this.value,${ap.pts||0})">${opts}</select>
      </td>
    </tr>`;
  }).join('');
  const alreadyNames=new Set([...allPs.map(p=>p.player_name),...allExtras.map(e=>e.name)]);
  const addableOptions=APP.data.players.filter(p=>!alreadyNames.has(p.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.name.replace(/"/g,'&quot;')}">${p.name}</option>`).join('');
  const addRow=`<div style="display:flex;gap:8px;margin-top:10px;align-items:center"><select class="fi" id="dd-addp-${eid}" style="flex:1;padding:5px 8px;font-size:12px"><option value="">Spieler manuell hinzufügen…</option>${addableOptions}</select><button class="btn btn-ok" onclick="ddAddPlayer('${eid}')" style="white-space:nowrap;font-size:12px;padding:5px 12px">+ Hinzufügen</button></div>`;
  if(!allPs.length&&!allExtras.length)return'<div class="note">Noch keine Teilnahme-Daten und keine Aufstellung gespeichert.</div>'+addRow;
  // Kampfstatus-Bearbeitung
  const cqWinner=ps.find(p=>p.conquest_pts);
  const gaWinner=ps.find(p=>p.gather_pts);
  const kiWinner=ps.find(p=>p.kill_pts);
  const pOpts=(sel)=>'<option value="">– kein Eintrag –</option>'+allPs.map(p=>`<option value="${p.player_name.replace(/"/g,'&quot;')}"${p.player_name===sel?' selected':''}>${p.player_name}</option>`).join('');
  const kRow=(id,label,color,winner,field)=>`
    <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:${color}0d;border-radius:6px;border-left:3px solid ${color}">
      <span style="font-size:11px;font-weight:700;color:${color};min-width:110px">${label}</span>
      <select class="fi" id="dd-${id}-player-${eid}" style="flex:1;font-size:12px;padding:3px 6px">${pOpts(winner?.player_name||'')}</select>
      <input type="number" class="fi" id="dd-${id}-pts-${eid}" value="${winner?winner[field]:''}" style="width:90px;text-align:right;font-size:12px;padding:3px 6px;margin:0" placeholder="Punkte">
    </div>`;
  const kampfstatusEditHtml=`<div style="margin-bottom:14px;border:1px solid var(--bd);border-radius:8px;overflow:hidden">
    <div style="background:var(--bg2);padding:7px 10px;font-size:12px;font-weight:700;color:var(--tx2)">🏆 Kampfstatus · Top-Scorer</div>
    <div style="padding:8px;display:flex;flex-direction:column;gap:5px">
      ${kRow('cq','⚔ Eroberung','#e67e22',cqWinner,'conquest_pts')}
      ${kRow('ga','📦 Sammeln','#27ae60',gaWinner,'gather_pts')}
      ${kRow('ki','💀 Kills','#e74c3c',kiWinner,'kill_pts')}
    </div>
  </div>`;
  return`${hasAny||analysisRun?`<div style="font-size:11px;margin-bottom:6px">${analysisRun?'<span style="color:var(--win)">● erkannt</span> · <span style="color:var(--loss)">ABWESEND = nicht im Screenshot</span>':''}${allExtras.length?' · <span style="color:#e67e22">⚠ nicht erkannt = Spieler zuweisen</span>':''}</div>`:''}
  ${kampfstatusEditHtml}
  <table style="width:100%"><thead><tr><th>Spieler</th><th style="text-align:center">Gespielt</th><th style="text-align:right">Punkte</th><th></th></tr></thead>
  <tbody>${rows}${extraRows}</tbody></table>${addRow}`;
}
export function ddMapChange(eid,safe,dbName,pts){
  // Wenn Spieler gemappt: diesen Spieler in der Haupttabelle mit den Punkten befüllen
  if(!dbName)return;
  const playerSafe=dbName.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
  const ptsEl=document.getElementById('dd-ipts-'+eid+'-'+playerSafe);
  const pldEl=document.getElementById('dd-pld-'+eid+'-'+playerSafe);
  if(ptsEl&&pts){ptsEl.value=pts;if(pldEl)pldEl.checked=true;}
}
export function ddPtsChange(eid,safe){
  const pts=parseInt(document.getElementById('dd-ipts-'+eid+'-'+safe)?.value)||0;
  const pld=document.getElementById('dd-pld-'+eid+'-'+safe);
  if(pld)pld.checked=pts>0;
  const row=document.getElementById('dd-row-'+eid+'-'+safe);
  if(row&&row.dataset.absent==='1'){
    const badge=document.getElementById('dd-badge-'+eid+'-'+safe);
    if(pts>0){
      row.style.background='rgba(39,174,96,.08)';
      if(badge)badge.innerHTML='<span style="color:var(--win);font-size:9px;margin-left:3px">●</span>';
    }else{
      row.style.background='rgba(231,76,60,.04)';
      if(badge)badge.innerHTML='<span style="font-size:9px;color:var(--loss);font-weight:800;background:rgba(231,76,60,.12);padding:1px 4px;border-radius:3px;margin-left:4px">ABWESEND</span>';
    }
  }
}
export async function ddRemovePlayer(eid,name,partId){
  if(!confirm(`„${name}" aus der Teilnahmeliste entfernen?`))return;
  if(partId!=null){
    const r=await fetch(SB+'/rest/v1/ws_participation?id=eq.'+partId,{method:'DELETE',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}});
    if(!r.ok){alert('Fehler beim Löschen: '+await r.text());return;}
    APP.data.participation=APP.data.participation.filter(p=>p.id!==partId);
  }
  if(_ddManual[eid])_ddManual[eid]=_ddManual[eid].filter(m=>m.name!==name);
  if(_ddAnalysis[eid])_ddAnalysis[eid]=_ddAnalysis[eid].filter(p=>p.name!==name);
  const ev=APP.data.events.find(e=>e.id===eid);
  if(ev){const td=document.getElementById('dd-ptable-'+eid);if(td)td.innerHTML=ddPlayerTableHtml(eid,ev,_ddAnalysis[eid]||[]);}
}
export function ddAddPlayer(eid){
  const sel=document.getElementById('dd-addp-'+eid);
  if(!sel||!sel.value)return;
  const name=sel.value;
  if(!_ddManual[eid])_ddManual[eid]=[];
  if(_ddManual[eid].find(m=>m.name===name))return;
  _ddManual[eid].push({name,pts:null});
  const ev=APP.data.events.find(e=>e.id===eid);
  if(!ev)return;
  const td=document.getElementById('dd-ptable-'+eid);
  if(td)td.innerHTML=ddPlayerTableHtml(eid,ev,_ddAnalysis[eid]||[]);
}
export function _startAnalysisProgress(statusEl){
  if(!statusEl)return(ok,msg)=>{};
  let pct=0;
  statusEl.innerHTML=`<span id="_ap_lbl" style="font-size:12px;color:var(--tx3)">⏳ Analysiere</span><span style="display:inline-block;width:140px;height:6px;background:rgba(0,0,0,0.1);border-radius:3px;vertical-align:middle;margin-left:8px;overflow:hidden"><span id="_ap_fill" style="display:block;height:100%;width:0%;background:var(--acc,#7c3aed);border-radius:3px;transition:width .5s ease"></span></span>`;
  const fill=statusEl.querySelector('#_ap_fill');
  const lbl=statusEl.querySelector('#_ap_lbl');
  let dots=0;
  const di=setInterval(()=>{dots=(dots+1)%4;if(lbl)lbl.textContent='⏳ Analysiere'+'.'.repeat(dots);},400);
  const pi=setInterval(()=>{pct+=Math.max(0.3,(90-pct)*0.06);if(fill)fill.style.width=Math.min(pct,90)+'%';},600);
  return function stop(ok,msg){
    clearInterval(di);clearInterval(pi);
    if(fill){fill.style.width='100%';fill.style.background=ok?'var(--win,#27ae60)':'var(--loss,#e74c3c)';}
    setTimeout(()=>{statusEl.innerHTML=msg;},500);
  };
}
export async function ddAnalyze(eid){
  const files=document.getElementById('dd-shots-'+eid)?.files;
  if(!files||!files.length){alert('Bitte zuerst Screenshots auswählen.');return;}
  const statusEl=document.getElementById('dd-analyze-status-'+eid);
  const btn=document.getElementById('dd-analyze-btn-'+eid);
  if(btn)btn.disabled=true;
  const stop=_startAnalysisProgress(statusEl);
  try{
    const images=await Promise.all(Array.from(files).map(async f=>{
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(f);});
      return resizeImageForOcr(b64,1280);
    }));
    const knownPlayers=APP.data.players.map(p=>p.name);
    const resp=await fetch(VISION_URL()+'/analyze-ws',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,known_players:knownPlayers})});
    if(!resp.ok)throw new Error(`Vision-Server: HTTP ${resp.status}`);
    const data=await resp.json();
    if(data.error)throw new Error(data.error);
    if(data.opponent){const el=document.getElementById('dd-opp-'+eid);if(el)el.value=data.opponent;}
    if(data.our_pts!=null){const el=document.getElementById('dd-our-'+eid);if(el)el.value=data.our_pts;}
    if(data.opp_pts!=null){const el=document.getElementById('dd-oppts-'+eid);if(el)el.value=data.opp_pts;}
    if(data.result)ddSetRes(eid,data.result);
    ddAutoRes(eid);
    _ddAnalysis[eid]=data.players||[];
    const ev=APP.data.events.find(e=>e.id===eid);
    if(ev){const td=document.getElementById('dd-ptable-'+eid);if(td)td.innerHTML=ddPlayerTableHtml(eid,ev,_ddAnalysis[eid]);}
    const cnt=(data.players||[]).length;
    let statusMsg=`<span style="color:var(--win)">✓ ${cnt} Spieler erkannt</span>`;
    if(data.warnings?.length)statusMsg+=` <span style="color:#e67e22;font-size:11px">· ${data.warnings.join(' · ')}</span>`;
    stop(true,statusMsg);
  }catch(e){
    stop(false,`<span style="color:var(--loss)">❌ ${visionErr(e)}</span>`);
  }
  if(btn)btn.disabled=false;
}
export async function ddSave(eid){
  const ev=APP.data.events.find(e=>e.id===eid);
  if(!ev)return;
  const res=_ddRes[eid]||ev.result;
  if(!res||res==='pending'){alert('Bitte Ergebnis (Sieg/Niederlage) auswählen.');return;}
  const opp=document.getElementById('dd-opp-'+eid)?.value?.trim()||null;
  const our=parseInt(document.getElementById('dd-our-'+eid)?.value)||null;
  const oppPts=parseInt(document.getElementById('dd-oppts-'+eid)?.value)||null;
  const btn=document.getElementById('dd-save-'+eid);
  if(btn){btn.textContent='Speichern…';btn.disabled=true;}
  try{
    const r=await fetch(SB+'/rest/v1/ws_events?id=eq.'+eid,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({opponent:opp,our_pts:our,opp_pts:oppPts,result:res})});
    if(!r.ok)throw new Error(await r.text());
    const ps=APP.data.participation.filter(p=>p.event_id===eid);
    await Promise.all(ps.map(async p=>{
      const safe=p.player_name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const pldEl=document.getElementById('dd-pld-'+eid+'-'+safe);
      const ptsEl=document.getElementById('dd-ipts-'+eid+'-'+safe);
      if(!pldEl&&!ptsEl)return;
      const played=pldEl?pldEl.checked:p.played;
      const pts=ptsEl?(parseInt(ptsEl.value)||null):p.individual_pts;
      const pr=await fetch(SB+'/rest/v1/ws_participation?id=eq.'+p.id,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({played,individual_pts:pts})});
      if(!pr.ok)throw new Error('Teilnahme: '+await pr.text());
    }));
    // Aufstellungs-Spieler ohne bisherigen DB-Eintrag anlegen (auch Abwesende)
    const lineupOnly=_ddLineupOnly[eid]||[];
    for(const name of lineupOnly){
      const safe=name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const pldEl=document.getElementById('dd-pld-'+eid+'-'+safe);
      const ptsEl=document.getElementById('dd-ipts-'+eid+'-'+safe);
      if(!pldEl&&!ptsEl)continue;
      const played=pldEl?pldEl.checked:false;
      const pts=ptsEl?(parseInt(ptsEl.value)||null):null;
      // Ersatzspieler stehen seit dem Umbau mit in der Aufstellung. Ohne dieses
      // Kennzeichen käme ein nicht gebrauchter Ersatzspieler hier als gesetzter
      // Spieler in die Datenbank und würde die Quote drücken, obwohl er nicht
      // gefehlt hat — reliability() rechnet genau über diese Spalte.
      const substitute=wsIstErsatz(APP.teamAssign&&APP.teamAssign[name]);
      const pr=await fetch(SB+'/rest/v1/ws_participation',{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({event_id:eid,player_name:name,played,individual_pts:pts,substitute})});
      if(!pr.ok)throw new Error('Teilnahme ('+name+'): '+await pr.text());
    }
    // Nicht erkannte Screenshot-Spieler: Mapping auf bestehenden DB-Spieler
    const extras=_ddExtra[eid]||[];
    for(const ap of extras){
      const safe='xtra_'+ap.name.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const mapEl=document.getElementById('dd-map-'+eid+'-'+safe);
      const mappedName=mapEl?mapEl.value:'';
      if(!mappedName)continue; // ignorieren gewählt
      // Punkte über den Spieler-Input der Haupttabelle lesen (falls durch ddMapChange gesetzt)
      const playerSafe=mappedName.replace(/\s/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      const ptsEl=document.getElementById('dd-ipts-'+eid+'-'+playerSafe);
      const pldEl=document.getElementById('dd-pld-'+eid+'-'+playerSafe);
      const pts=ptsEl?(parseInt(ptsEl.value)||null):ap.pts||null;
      const played=pldEl?pldEl.checked:(pts>0);
      // Existiert bereits ein ws_participation-Eintrag für diesen Spieler?
      const existing=APP.data.participation.find(p=>p.event_id===eid&&p.player_name===mappedName);
      if(existing){
        const pr=await fetch(SB+'/rest/v1/ws_participation?id=eq.'+existing.id,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({played,individual_pts:pts})});
        if(!pr.ok)throw new Error('Teilnahme update ('+mappedName+'): '+await pr.text());
      }else{
        const pr=await fetch(SB+'/rest/v1/ws_participation',{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({event_id:eid,player_name:mappedName,played,individual_pts:pts})});
        if(!pr.ok)throw new Error('Teilnahme ('+mappedName+'): '+await pr.text());
      }
    }
    // Kampfstatus speichern
    for(const [pfx,field] of [['cq','conquest_pts'],['ga','gather_pts'],['ki','kill_pts']]){
      const newPlayer=document.getElementById(`dd-${pfx}-player-${eid}`)?.value||'';
      const newPts=parseInt(document.getElementById(`dd-${pfx}-pts-${eid}`)?.value)||null;
      const oldWinner=APP.data.participation.find(p=>p.event_id===eid&&p[field]);
      if(oldWinner&&oldWinner.player_name!==newPlayer){
        await fetch(SB+'/rest/v1/ws_participation?id=eq.'+oldWinner.id,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({[field]:null})});
      }
      if(newPlayer&&newPts){
        const winner=APP.data.participation.find(p=>p.event_id===eid&&p.player_name===newPlayer);
        if(winner)await fetch(SB+'/rest/v1/ws_participation?id=eq.'+winner.id,{method:'PATCH',headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({[field]:newPts})});
      }
    }
    // Die Auswertung ist verbucht — sie darf sich nicht noch einmal über den
    // frisch gespeicherten Stand legen.
    delete _ddAnalysis[eid];delete _ddExtra[eid];delete _ddManual[eid];delete _ddRes[eid];
    const [evs,parts,players]=await Promise.all([sbGet('ws_events?order=event_date.desc,team.asc'),sbGet('ws_participation?order=rank.asc'),sbGet('ws_players?order=name.asc')]);
    APP.data.events=evs;APP.data.participation=parts;APP.data.players=players;
    renderPage();
  }catch(e){
    alert('Fehler: '+e.message);
    if(btn){btn.textContent='Änderungen speichern';btn.disabled=false;}
  }
}
