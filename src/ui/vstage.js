import { renderPage } from '../app/render.js';
import { VS_TAGESZIEL } from '../core/config.js';
import { fmtMio } from '../core/helpers.js';
import { APP } from '../core/state.js';
import { LISTEN_GRENZE, WOCHENTAGE, bilanz, laeuftNoch, laufVon, punkteVon,
  tagIndex, tagLage, tagesKarte, wochen, wochenTage } from '../core/vstage.js';
import { escapeHtml } from './umfragen.js';

// ══════════════════════════════════════════════════════════════════
//  VS-DUELL → Reiter „📅 Tage"
// ══════════════════════════════════════════════════════════════════
// Zwei Ansichten auf dieselben Zahlen, und beide werden gebraucht:
//
//  · **Woche** — das Raster Spieler × Mo…Sa mit den Punkten selbst. Hier sieht
//    man einen einzelnen Tag nach, etwa nach einer Ansage in der Allianz.
//  · **Gesamt** — je Spieler, wie oft er an einem Montag, Dienstag, … das
//    Tagesziel verfehlt hat, über den ganzen Zeitraum. Das ist die eigentliche
//    Auskunft: eine 5 in der Mittwochsspalte heißt, dass jemand mit der
//    Forschung nicht hinterherkommt — nicht, dass er faul ist.

const ROT='rgba(220,60,60,.16)';

function tagesZiel(){return APP.vsTagesziel||VS_TAGESZIEL;}

function zelle(p,ziel,datum){
  // Drei Zustände, drei Darstellungen. Ein „nicht gelesen" als 0 zu zeichnen
  // wäre eine Behauptung über jemanden, den niemand gemessen hat.
  if(p===null)
    return`<td class="vst-z" title="An diesem Tag nicht gelesen">–</td>`;
  const unter=p<ziel;
  const stil=unter?`background:${ROT};font-weight:700`:'';
  const titel=`${datum}: ${p.toLocaleString('de-DE')} Punkte`;
  return`<td class="vst-z" style="${stil}" title="${titel}">${p?fmtMio(p):'0'}</td>`;
}

function kopfTage(tage){
  // Der laufende Tag wird ausdrücklich als solcher beschriftet — seine Zahlen
  // stehen da, zählen aber nirgends mit. Ohne die Marke sähe er aus wie ein
  // besonders schlechter Tag.
  const marke={laeuft:'läuft',kommt:'kommt'};
  return tage.map(d=>{
    const lage=tagLage(d);
    const unten=marke[lage]||`${d.slice(8)}.${d.slice(5,7)}.`;
    const titel=lage==='laeuft'?' — läuft noch':lage==='kommt'?' — noch nicht gewesen':'';
    return`<th class="vst-z" title="${d}${titel}">${WOCHENTAGE[tagIndex(d)]||'So'}<br>
    <span style="font-weight:400;font-size:9px;color:var(--tx3)">${unten}</span></th>`;
  }).join('');
}

function namensZelle(name,imKader){
  const safe=(name||'').replace(/'/g,"\\'");
  const bekannt=(APP.data.players||[]).some(p=>p.name===name);
  const inner=bekannt
    ?`<span style="cursor:pointer;color:var(--primary)" onclick="openPlayer('${safe}')">${escapeHtml(name)}</span>`
    :`<span title="Kein Allianz-Spieler">${escapeHtml(name)}</span>`;
  return inner+(imKader?'':' <span style="font-size:9px;color:var(--tx3)">(nicht im Kader)</span>');
}

// ── Ansicht 1: eine Woche im Raster ───────────────────────────────────────
function wocheAnsicht(){
  const alle=wochen();
  if(!alle.length)return hinweisLeer();
  const montag=alle.includes(APP.vsTagWoche)?APP.vsTagWoche:alle[0];
  const tage=wochenTage(montag);
  const ziel=tagesZiel();
  const b=bilanz(tage[0],tage[5],ziel);
  const karte=tagesKarte((APP.data.vsTage||[]).filter(z=>z.datum>=tage[0]&&z.datum<=tage[5]));

  const opts=alle.map(m=>`<option value="${m}"${m===montag?' selected':''}>Woche ab ${m}</option>`).join('');
  const zeilen=b.zeilen.map(z=>{
    const zellen=tage.map(d=>zelle(punkteVon(karte,z.name,d),ziel,d)).join('');
    return`<tr>
      <td style="font-weight:600;font-size:12px">${namensZelle(z.name,z.imKader)}</td>
      ${zellen}
      <td class="vst-z" style="font-weight:800">${fmtMio(z.summe)}</td>
      <td class="vst-z" style="color:${z.verfehlt?'var(--loss)':'var(--win)'};font-weight:700">${z.verfehlt}</td>
    </tr>`;
  }).join('');

  // Fußzeile: wie viele haben an diesem Tag das Ziel verfehlt? Das ist die
  // Zahl, die einen schlechten Tag der ganzen Allianz von einem schlechten
  // Spieler unterscheidet.
  const fuss=tage.map(d=>{
    const l=laufVon(d);
    if(!l||laeuftNoch(d))return`<td class="vst-z" style="color:var(--tx3)">–</td>`;
    const n=b.zeilen.filter(z=>{const p=punkteVon(karte,z.name,d);return p!==null&&p<ziel;}).length;
    return`<td class="vst-z" style="font-weight:700">${n}</td>`;
  }).join('');

  return`<div style="margin-bottom:12px">
      <select class="fi" onchange="vsTagWocheSetzen(this.value)">${opts}</select>
    </div>
    ${lueckenHinweis(tage)}
    <div class="card"><div class="ch">Punkte je Tag
      <span class="ch-sub">Tagesziel ${fmtMio(ziel)} · rot = verfehlt</span></div>
      <div class="scroll-x"><table class="vst">
        <thead><tr><th>Spieler</th>${kopfTage(tage)}<th class="vst-z">Summe</th><th class="vst-z">verfehlt</th></tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><td style="font-size:11px;color:var(--tx3)">verfehlt an dem Tag</td>${fuss}<td></td><td></td></tr></tfoot>
      </table></div>
    </div>`;
}

// ── Ansicht 2: der ganze Zeitraum, gezählt je Wochentag ───────────────────
function gesamtAnsicht(){
  const alle=wochen();
  if(!alle.length)return hinweisLeer();
  const ziel=tagesZiel();
  const von=APP.vsTagVon||alle[alle.length-1];
  const bis=APP.vsTagBis||'';
  const b=bilanz(von,bis||null,ziel);
  if(!b.zeilen.length)return'<div class="note">Keine Daten im gewählten Zeitraum.</div>';

  const proTagGesamt=WOCHENTAGE.map((_,i)=>
    b.zeilen.reduce((s,z)=>s+z.proTag[i].verfehlt,0));

  const zeilen=b.zeilen.map(z=>{
    const zellen=z.proTag.map(t=>{
      if(!t.gezaehlt)return`<td class="vst-z" style="color:var(--tx3)">–</td>`;
      // „Jedes Mal verfehlt" braucht mindestens zwei Messungen. Bei einer ist
      // die Aussage trivial wahr und stünde in der ersten Woche hinter fast
      // jeder Zahl — eine Warnung, die immer leuchtet, liest niemand mehr.
      const stark=t.gezaehlt>=2&&t.verfehlt===t.gezaehlt;
      return`<td class="vst-z" title="${t.verfehlt} von ${t.gezaehlt} gemessenen Tagen verfehlt"
        style="${t.verfehlt?`background:${ROT};font-weight:700`:''}">${t.verfehlt}<span
        style="font-size:9px;color:var(--tx3)">/${t.gezaehlt}</span>${stark?' ⚠':''}</td>`;
    }).join('');
    const quote=z.gezaehlt?Math.round(z.verfehlt/z.gezaehlt*100):0;
    return`<tr>
      <td style="font-weight:600;font-size:12px">${namensZelle(z.name,z.imKader)}</td>
      ${zellen}
      <td class="vst-z" style="font-weight:800;color:${z.verfehlt?'var(--loss)':'var(--win)'}">${z.verfehlt}<span style="font-size:9px;color:var(--tx3)">/${z.gezaehlt}</span></td>
      <td class="vst-z">${quote}%</td>
      <td class="vst-z">${fmtMio(z.summe)}</td>
    </tr>`;
  }).join('');

  return`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="fl2"><label style="font-size:11px">Von</label>
        <input type="date" class="fi" value="${von}" onchange="vsTagZeitraum('von',this.value)"></div>
      <div class="fl2"><label style="font-size:11px">Bis</label>
        <input type="date" class="fi" value="${bis}" onchange="vsTagZeitraum('bis',this.value)"></div>
    </div>
    <div class="card"><div class="ch">Verfehlt je Wochentag
      <span class="ch-sub">${b.tage.length} gemessene Tage · Ziel ${fmtMio(ziel)}</span></div>
      <div class="cb" style="font-size:11px;color:var(--tx3);padding-bottom:4px">
        Gezählt wird, wie oft jemand an einem Montag, Dienstag … unter dem Tagesziel blieb.
        ⚠ heißt: an diesem Wochentag bisher <b>jedes Mal</b> verfehlt — ab zwei
        gemessenen Tagen, vorher sagt „immer" nichts.</div>
      <div class="scroll-x"><table class="vst">
        <thead><tr><th>Spieler</th>${WOCHENTAGE.map(t=>`<th class="vst-z">${t}</th>`).join('')}
          <th class="vst-z">gesamt</th><th class="vst-z">Quote</th><th class="vst-z">Punkte</th></tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><td style="font-size:11px;color:var(--tx3)">alle zusammen</td>
          ${proTagGesamt.map(n=>`<td class="vst-z" style="font-weight:700">${n}</td>`).join('')}
          <td class="vst-z" style="font-weight:800">${proTagGesamt.reduce((a,b2)=>a+b2,0)}</td><td></td><td></td></tr></tfoot>
      </table></div>
    </div>`;
}

// ── Was die Zahlen nicht sagen ────────────────────────────────────────────
function lueckenHinweis(tage){
  // Ein Tag, der noch kommt, ist keine Lücke — er hat nur noch nicht
  // stattgefunden. Ihn mitzuzählen machte aus jeder laufenden Woche einen
  // Mangelbericht.
  const fehlt=tage.filter(d=>!laufVon(d)&&tagLage(d)==='vorbei');
  const voll=tage.filter(d=>{const l=laufVon(d);return l&&l.gelesen>=LISTEN_GRENZE;});
  const teil=tage.filter(d=>{const l=laufVon(d);return l&&!l.vollstaendig;});
  const teile=[];
  if(fehlt.length)teile.push(`An ${fehlt.length} Tagen wurde nichts gelesen (${fehlt.map(d=>WOCHENTAGE[tagIndex(d)]).join(', ')}) — dort steht ein Strich, keine Null.`);
  if(voll.length)teile.push(`An ${voll.length} Tagen war die Liste im Spiel mit ${LISTEN_GRENZE} Zeilen voll; wer dort fehlt, kann darunter stehen.`);
  if(teil.length)teile.push(`${teil.length} Tage sind unvollständig gelesen.`);
  if(!teile.length)return'';
  return`<div class="note" style="font-size:11px;margin-bottom:12px">${teile.join(' ')}</div>`;
}

function hinweisLeer(){
  return`<div class="note">Noch keine Tagespunkte. Sie kommen aus dem Spiel über
    scripts/vs_service/run.py --schreiben — die Tagesreiter im Spiel decken
    Mo–Sa der laufenden Woche ab und werden Sonntag zurückgesetzt.</div>`;
}

export function vsTageSection(){
  const sub=APP.vsTagView||'woche';
  return`<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-sm ${sub==='woche'?'btn-sol':'btn-out'}" onclick="vsTagView('woche')">📅 Woche</button>
      <button class="btn btn-sm ${sub==='gesamt'?'btn-sol':'btn-out'}" onclick="vsTagView('gesamt')">📈 Gesamt</button>
    </div>
    ${sub==='gesamt'?gesamtAnsicht():wocheAnsicht()}`;
}

export function vsTagView(v){APP.vsTagView=v;renderPage();}
export function vsTagWocheSetzen(m){APP.vsTagWoche=m;renderPage();}
export function vsTagZeitraum(welches,wert){
  if(welches==='von')APP.vsTagVon=wert;else APP.vsTagBis=wert;
  renderPage();
}
