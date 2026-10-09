import { anmAlleNamen, anmHistorie } from '../core/anmeldehistorie.js';
import { istOhnePlatzWert } from '../core/rotation.js';
import { isInactive } from '../core/players.js';

// ── Reiter „📜 Historie" ───────────────────────────────────────────────────────
// Zeigt je Spieler, wie er in den letzten Wochen stand — A/B (gesetzt), AE/BE
// (Ersatz), AC/BC/ABC (angemeldet, aber ausgeschlossen) oder leer. Reine
// Anzeige, nichts hier ändert etwas an Aufstellung oder Rotation.
//
// Zwei Wochentypen sehen unterschiedlich aus, und das ist beabsichtigt: ab dem
// Anlegen von ws_anmeldestand (09.10.2026) ist jede Woche vollständig —
// fehlender Eintrag heißt "nicht angemeldet". Davor lässt sich nur A/AE/B/BE
// aus ws_participation rekonstruieren; alles andere zeigt "?" statt eines
// Strichs, weil AC/BC von "gar nicht angemeldet" dort nicht zu unterscheiden
// ist.

function _q(s){return String(s).replace(/'/g,"\\'");}

function kurzDatum(d){
  const[,m,t]=d.split('-');
  return`${t}.${m}.`;
}

function zelle({wert,quelle}){
  if(quelle==='unbekannt')return'<span style="color:var(--tx3);font-style:italic" title="Vor der Anmeldehistorie: AC/BC lässt sich nicht von &quot;gar nicht angemeldet&quot; unterscheiden">?</span>';
  if(!wert)return'<span style="color:var(--tx3)">–</span>';
  if(istOhnePlatzWert(wert))return`<span style="color:#8e44ad;font-weight:700">${wert}</span>`;
  const ersatz=wert==='AE'||wert==='BE';
  return`<span style="color:${ersatz?'var(--acc)':'var(--win)'};font-weight:700">${wert}</span>`;
}

export function historieView(){
  const namen=anmAlleNamen('ws');
  const zeilen=anmHistorie(namen,'ws');
  if(!zeilen.length)return`<div class="card"><div class="cb" style="text-align:center;color:var(--tx3);font-size:13px;padding:22px">Noch keine Anmeldedaten.</div></div>`;
  const freitage=zeilen[0].wochen.map(w=>w.datum);

  let h=`<div class="note info">
    <div style="font-weight:700;margin-bottom:4px">Wer stand wann wo</div>
    <div>A/B: gesetzt. AE/BE: Ersatz. AC/BC/ABC: angemeldet, aber ausgeschlossen. –: nicht angemeldet.</div>
    <div style="margin-top:6px">? heißt: für diese Woche gibt es noch keinen vollständigen Snapshot — ob der Spieler angemeldet, aber ausgeschlossen war oder sich gar nicht gemeldet hat, lässt sich nachträglich nicht mehr unterscheiden.</div>
  </div>`;

  const rows=zeilen.map(z=>{
    const inaktiv=isInactive(z.name);
    return`<tr style="${inaktiv?'opacity:.45':''}">
      <td><strong style="cursor:pointer;color:var(--primary);white-space:nowrap" onclick="openPlayer('${_q(z.name)}')">${z.name}</strong>${inaktiv?' <span style="font-size:9px;color:#e67e22;font-weight:700">AUSGETRETEN</span>':''}</td>
      ${z.wochen.map(w=>`<td style="text-align:center">${zelle(w)}</td>`).join('')}
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
