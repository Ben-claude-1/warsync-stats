import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  LEISTUNGSINDEX — wer aus seinem Konto etwas macht
// ══════════════════════════════════════════════════════════════════
// Die Einzelpunkte eines Wüstensturms sagen für sich genommen wenig: sie hängen
// am Gegner und an der Woche. Am 11.09.2026 holte dieselbe Stammbesetzung 1,99
// Mio statt 2,25 Mio — ein Rückgang, der nichts über die Spieler aussagt.
// Verglichen wird deshalb **innerhalb eines Events**: jeder Wert geteilt durch
// den Median seines Events. 1,0 ist genau Durchschnitt, 2,0 das Doppelte.
//
// **Median, nicht Mittelwert.** In jedem Event steht ein Spieler weit oben
// (9,08 Mio gegen einen Median von 0,91) — gegen den Mittelwert gerechnet
// stünde die halbe Mannschaft künstlich schlecht da.
//
// **Warum das überhaupt trägt:** über die beiden Freitage vom 04. und 11.09.
// gemessen liegt die Korrelation des Index zwischen zwei Wochen bei 0,82, und
// 22 von 32 Spielern landen beide Male auf derselben Seite des Durchschnitts.
// Wer gut spielt, spielt wieder gut — das ist keine Tagesform.
//
// **Der Index misst Kills, nicht Spielverständnis.** Die Gesamtpunktzahl einer
// Mail besteht zu 99,8 % aus Killpunkten (Legolio am 04.09.: 4.741.524 gesamt,
// davon 4.731.518 Kills). Eroberungspunkte laufen in einer rund 230-mal
// kleineren Währung — der Beste kam auf 20.610 — und verschwinden darin.
// GeneralBlücher stand deshalb mit Index 0,74 im unteren Drittel und war
// trotzdem in **beiden** Team-A-Events der beste Eroberer. Eine
// Aufschlüsselung je Spieler gibt die Mail nicht her; was sie hergibt, sind die
// vier Kategorie-Besten je Event — und genau die stehen hier als Marken neben
// dem Index, statt ihn stillschweigend zu verrechnen. Eine erfundene
// Gewichtung wäre eine Behauptung über ein Verhältnis, das niemand kennt.

const KATEGORIEN=[['conquest','mvp_conquest'],['collect','mvp_collect'],
                  ['kills','mvp_kills'],['overall','mvp_overall']];

function median(werte){
  const s=[...werte].sort((a,b)=>a-b);
  if(!s.length)return 0;
  const m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

// Alles in **einem** Durchlauf — dieselbe Regel wie bei `einsatzBilanzAlle`:
// je Spieler zu suchen wäre bei vierstellig vielen Teilnahme-Zeilen und vierzig
// Namen in jeder Tabellenzeile spürbar. Aufrufer holen das Ergebnis einmal und
// greifen dann hinein.
export function leistungAlle(){
  const events=APP.data.events||[];
  const teile=(APP.data.participation||[]).filter(x=>x.individual_pts!=null&&x.played);

  const proEvent=new Map();
  teile.forEach(x=>{
    if(!proEvent.has(x.event_id))proEvent.set(x.event_id,[]);
    proEvent.get(x.event_id).push(x.individual_pts);
  });
  const medianOf=new Map();
  proEvent.forEach((werte,id)=>medianOf.set(id,median(werte)));

  const out={};
  const eintrag=n=>out[n]||(out[n]={index:null,events:0,marken:{conquest:0,collect:0,kills:0,overall:0}});
  teile.forEach(x=>{
    const m=medianOf.get(x.event_id);
    if(!m)return;                       // ein Event ohne Punkte trägt nichts bei
    const e=eintrag(x.player_name);
    e.events++;
    e._summe=(e._summe||0)+x.individual_pts/m;
  });
  Object.values(out).forEach(e=>{
    e.index=e.events?Math.round(e._summe/e.events*100)/100:null;
    delete e._summe;
  });

  // Die Marken hängen am Event, nicht an der Teilnahme-Zeile: die Mail nennt je
  // Kategorie genau einen Namen. Wer nie in der Rangliste auftaucht, aber eine
  // Marke trägt, bekommt trotzdem einen Eintrag — sonst fiele er aus der Liste.
  events.forEach(ev=>{
    KATEGORIEN.forEach(([k,feld])=>{
      const name=ev[feld];
      if(name)eintrag(name).marken[k]++;
    });
  });
  return out;
}
