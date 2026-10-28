import { anmAlleNamen, anmBelegBild, anmBelegeFuer, anmHistorie, anmWocheStand } from '../core/anmeldehistorie.js';
import { LOC, trs } from '../core/i18n.js';
import { istOhnePlatzWert } from '../core/rotation.js';
import { isInactive } from '../core/players.js';

// ── Reiter „📜 Historie" ───────────────────────────────────────────────────────
// Zeigt je Spieler, wie er in den letzten Wochen stand — A/B (gesetzt), AE/BE
// (Ersatz), AC/BC/ABC (angemeldet, aber ausgeschlossen) oder leer. Reine
// Anzeige, nichts hier ändert etwas an Aufstellung oder Rotation.
//
// Drei Wochentypen sehen unterschiedlich aus, und das ist beabsichtigt:
//
//   * **Kader-Lock** (ab 09.10.2026): die Woche ist vollständig, ein fehlender
//     Eintrag heißt "nicht angemeldet" (–).
//   * **nachgetragen** (16.10.2026, scripts/anmeldestand_nachtragen.py): die
//     AC/BC stehen da, aber als Stand eines Zeitpunkts — gepunktet
//     unterstrichen, mit dem Zeitpunkt im Titel. Ein fehlender Eintrag bleibt
//     hier "?", denn ein Beleg von Mittwoch kennt niemanden, der sich
//     Donnerstag noch gemeldet hat.
//   * **gar kein Beleg**: nur A/AE/B/BE aus ws_participation; alles andere ist
//     "?", weil AC/BC dort von "gar nicht angemeldet" nicht zu unterscheiden
//     ist.
//
// Wer einen Beleg hat (📷, aus ws_anmeldebeleg), kann die Behauptung nachprüfen
// — der Scan-Ausschnitt mit dem genauen Aufnahmezeitpunkt, nicht nur dem der
// ganzen Woche.

function _q(s){return String(s).replace(/'/g,"\\'");}

function kurzDatum(d){
  const[,m,t]=d.split('-');
  return`${t}.${m}.`;
}

const QUELLE_LABEL={suchlauf:'Suchlauf',scroll:'Scroll-Scan'};

function standKurz(iso){
  return new Date(iso).toLocaleString(LOC(),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

// `standUm` ist der Zeitpunkt des Nachtrags dieser Woche (oder null). Er gehört
// an jede Zelle der Spalte, nicht nur an die nachgetragenen Werte: auch das
// „?" bedeutet in einer nachgetragenen Woche etwas Genaueres als sonst —
// „dieser Beleg führt ihn nicht", statt „darüber gibt es gar keine Auskunft".
function zelle(w,name,standUm){
  const belege=anmBelegeFuer(name,'ws',w.datum);
  const kamera=belege.length
    ?`<span onclick="anmBelegOeffnen('${_q(name)}','${w.datum}')" title="${belege.length} Beweisbild${belege.length>1?'er':''}" style="cursor:pointer;margin-left:3px;opacity:.7">📷</span>`:'';
  if(w.quelle==='unbekannt'){
    const titel=standUm
      ?trs('Kein Beleg — der Nachtrag dieser Woche kennt ihn nicht. Stand')+' '+standKurz(standUm)
      :trs('Vor der Anmeldehistorie: AC/BC lässt sich nicht von „gar nicht angemeldet“ unterscheiden');
    return`<span style="color:var(--tx3);font-style:italic" title="${titel}">?</span>${kamera}`;
  }
  // Ein nachgetragener Wert ist ein Stand **zu einem Zeitpunkt**, kein
  // Schlussstand — beim 02.10. liegen drei Stunden dazwischen, beim 18.09.
  // anderthalb Tage. Gepunktet und mit dem Zeitpunkt im Titel; ohne die
  // Unterscheidung sähe ein Mittwochsstand aus wie der Donnerstag 04:00.
  const nach=w.quelle==='nachtrag';
  const marke=nach?';border-bottom:1px dotted currentColor':'';
  const titel=nach&&standUm?` title="${trs('Nachgetragen aus einem Beleg · Stand')+' '+standKurz(standUm)}"`:'';
  if(!w.wert)return`<span style="color:var(--tx3)">–</span>${kamera}`;
  if(istOhnePlatzWert(w.wert)||w.wert==='C')
    return`<span style="color:#8e44ad;font-weight:700${marke}"${titel}>${w.wert}</span>${kamera}`;
  const ersatz=w.wert==='AE'||w.wert==='BE';
  return`<span style="color:${ersatz?'var(--acc)':'var(--win)'};font-weight:700${marke}"${titel}>${w.wert}</span>${kamera}`;
}

export function historieView(){
  const namen=anmAlleNamen('ws');
  const zeilen=anmHistorie(namen,'ws');
  if(!zeilen.length)return`<div class="card"><div class="cb" style="text-align:center;color:var(--tx3);font-size:13px;padding:22px">Noch keine Anmeldedaten.</div></div>`;
  const freitage=zeilen[0].wochen.map(w=>w.datum);

  // Einmal je Spalte, nicht je Zelle: bei hundert Spielern und acht Wochen
  // wären es achthundert Läufe über ws_anmeldestand.
  const staende={};
  freitage.forEach(d=>{staende[d]=anmWocheStand('ws',d);});

  let h=`<div class="note info">
    <div style="font-weight:700;margin-bottom:4px">Wer stand wann wo</div>
    <div>A/B: gesetzt. AE/BE: Ersatz. AC/BC/ABC: angemeldet, aber ausgeschlossen. –: nicht angemeldet.</div>
    <div style="margin-top:6px">Gepunktet unterstrichen heißt nachgetragen: der Wert stammt aus einem Scan- oder Planungsstand-Beleg von vor dem Anmeldeschluss, nicht vom Kader-Lock. Der Titel nennt den Zeitpunkt, für den er gilt. C ohne Uhrzeit ist der alte Wert aus der Zeit vor AC/BC.</div>
    <div style="margin-top:6px">? heißt: für diese Woche gibt es noch keinen vollständigen Snapshot — ob der Spieler angemeldet, aber ausgeschlossen war oder sich gar nicht gemeldet hat, lässt sich nachträglich nicht mehr unterscheiden.</div>
    <div style="margin-top:6px">📷 öffnet den Scan-Ausschnitt, aus dem der Wert gelesen wurde, mit dem genauen Zeitpunkt der Aufnahme.</div>
  </div>`;

  const rows=zeilen.map(z=>{
    const inaktiv=isInactive(z.name);
    return`<tr style="${inaktiv?'opacity:.45':''}">
      <td><strong style="cursor:pointer;color:var(--primary);white-space:nowrap" onclick="openPlayer('${_q(z.name)}')">${z.name}</strong>${inaktiv?' <span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>':''}</td>
      ${z.wochen.map(w=>`<td style="text-align:center;white-space:nowrap">${zelle(w,z.name,staende[w.datum])}</td>`).join('')}
    </tr>`;
  }).join('');

  h+=`<div class="card">
    <div class="ch">Anmeldehistorie <span class="ch-sub">${freitage.length} Wochen, neueste zuerst</span></div>
    <div class="scroll-x"><table>
      <thead><tr><th>Spieler</th>${freitage.map(d=>`<th style="text-align:center;white-space:nowrap">${kurzDatum(d)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
  return h;
}

// ── Beleg-Overlay ──────────────────────────────────────────────────────────
// Eigenes, kleines Overlay statt des Spielerprofils (overlay.js) — anderer
// Zustand, andere Frage ("was zeigt der Scan" statt "wer ist dieser Spieler").
export function closeBelegOverlay(){const el=document.getElementById('beleg-overlay');if(el)el.remove();}

async function _belegBildLaden(id){
  const el=document.getElementById('beleg-img-'+id);
  if(!el)return;
  const bild=await anmBelegBild(id);
  if(!document.getElementById('beleg-img-'+id))return; // Overlay inzwischen zu
  el.outerHTML=bild?`<img id="beleg-img-${id}" src="data:image/png;base64,${bild}" style="width:100%;border-radius:8px;border:1px solid var(--bd)">`
                   :`<div id="beleg-img-${id}" style="color:var(--loss);font-size:12px;padding:10px;text-align:center">Bild konnte nicht geladen werden.</div>`;
}

export function anmBelegOeffnen(name,eventDate){
  const belege=anmBelegeFuer(name,'ws',eventDate);
  let existing=document.getElementById('beleg-overlay');
  if(!existing){existing=document.createElement('div');existing.id='beleg-overlay';document.body.appendChild(existing);}
  existing.style.cssText='position:fixed;inset:0;z-index:999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.45)';
  const karten=belege.map(b=>{
    const zeit=new Date(b.erkannt_um).toLocaleString(LOC(),{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">${QUELLE_LABEL[b.quelle]||b.quelle} · ${zeit} Uhr</div>
      <div id="beleg-img-${b.id}" style="color:var(--tx3);font-size:12px;padding:30px;text-align:center;background:var(--bg2);border-radius:8px">Lädt …</div>
    </div>`;
  }).join('');
  existing.innerHTML=`<div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;padding:20px 16px 32px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--tx3)">Beweisbild · ${name}</div>
      <button onclick="closeBelegOverlay()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--tx3);line-height:1">✕</button>
    </div>
    ${karten||'<div style="color:var(--tx3);font-size:13px;text-align:center;padding:20px">Kein Beleg (mehr) gefunden.</div>'}
  </div>`;
  existing.onclick=e=>{if(e.target===existing)closeBelegOverlay();};
  belege.forEach(b=>_belegBildLaden(b.id));
}
