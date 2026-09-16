import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const S='http://127.0.0.1:8799/index.html';
const q=t=>execFileSync('docker',['exec','-i','supabase-db','psql','-U','postgres','-d','postgres','-t','-A','-c',t],{encoding:'utf8'}).trim();
const A=JSON.parse(q("SELECT row_to_json(a) FROM alliances a WHERE tag='XP33';"));
const d={allianz:A,
 players:JSON.parse(q(`SELECT json_agg(row_to_json(p)) FROM ws_players p WHERE alliance_id='${A.id}' AND active;`)),
 ws:JSON.parse(q(`SELECT data FROM ws_planner_state WHERE alliance_id='${A.id}' AND key='ws';`)),
 prio:JSON.parse(q(`SELECT COALESCE(json_agg(row_to_json(x)),'[]') FROM ws_priority x WHERE alliance_id='${A.id}';`)),
 auss:JSON.parse(q(`SELECT COALESCE(json_agg(row_to_json(x)),'[]') FROM ws_aussetzen x WHERE alliance_id='${A.id}';`)),
 events:JSON.parse(q(`SELECT COALESCE(json_agg(row_to_json(e)),'[]') FROM ws_events e WHERE alliance_id='${A.id}';`)),
 part:JSON.parse(q(`SELECT COALESCE(json_agg(row_to_json(p)),'[]') FROM ws_participation p WHERE p.event_id IN (SELECT id FROM ws_events WHERE alliance_id='${A.id}');`))};
const b=await chromium.launch(); const p=await b.newPage();
const w=[]; await p.route('**/rest/v1/**',r=>r.request().method()==='GET'
 ?r.fulfill({status:200,contentType:'application/json',body:'[]'})
 :(w.push(r.request().method()),r.fulfill({status:403,contentType:'application/json',body:'{}'})));
p.on('dialog',x=>x.dismiss());
await p.goto(S); await p.waitForFunction(()=>window.APP&&window.zuteilungBerechnen);
const t=await p.evaluate(x=>{const A=window.APP;
 A.user={playerName:'T',role:'superadmin',allianceId:x.allianz.id,superAdmin:true};
 A.alliances=[x.allianz];A.allianceId=x.allianz.id;A.data.players=x.players;
 A.data.priority=x.prio;A.data.aussetzen=x.auss;A.data.events=x.events;A.data.participation=x.part;
 A.teamAssign=x.ws.teamAssign;A.wsTime=x.ws.wsTime;A.wsStrength=x.ws.wsStrength;A.synced=true;
 window.nav('ws');window.setWSView('verteilung');window.zuteilungBerechnen();
 const el=document.getElementById('pc');
 const v=window.__probe=(window.APP.__v||null);
 const raus=[...el.querySelectorAll('div')].filter(x=>/Stärkste, die zuschauen/.test(x.textContent||'')&&x.children.length<8);
 return JSON.stringify(raus.map(x=>x.innerText.replace(/\n/g,' | ')),null,1);},d);
console.log(t.split('\n').filter(l=>l.trim()).join('\n'));
console.log('\nAbgewiesene Schreibzugriffe:',w.length?w.join(','):'keine');
await b.close();
