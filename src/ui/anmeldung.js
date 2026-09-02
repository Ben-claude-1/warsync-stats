import { fmtMio, relColor } from '../core/helpers.js';
import { avatarImg } from '../core/players.js';
import { prioCGesamt, prioOf } from '../core/prio.js';
import { EINSATZ_LEER } from '../core/rotation.js';

// ── ANMELDUNG: eine Zeile, beide Events ──────────────────────────────────────
//
// Wüstensturm und Schluchtsturm hatten zwei verschiedene Listen: der Schluchtsturm
// eine schmale Zeile, der Wüstensturm einen Block mit T1–T4, Wachstums-Prognose,
// Ø-Punkten und Anwesenheit seit Mai. Entschieden wird an dieser Stelle aber in
// beiden Events dasselbe — wer spielt —, und dafür zählen zwei Zahlen. Beide
// Anmeldungen rendern deshalb **dieselbe** Zeile; getrennte Listen liefen sonst
// wieder auseinander, wie schon bei den Auswahlfeldern für den T1-Typ.
//
// Was verschieden bleibt, steckt in `ctx`: die Team-Farben, die Grenzen und der
// Name der Funktion hinter den Knöpfen. Das sind die Stellen, an denen sich die
// Events wirklich unterscheiden — alles andere ist Anzeige und gehört hierher.

// Sortiert wird nach der Gesamtkraft der Helden. Der Rang stand vorher davor
// (`byRankThenHero`) und schob die R5/R4 nach oben, unabhängig davon, was sie
// mitbringen — beim Einteilen zählt aber die Stärke, nicht die Allianz-Position.
export function nachHeldenkraft(a,b){
  const hp=(b.hero_power||0)-(a.hero_power||0);
  return hp!==0?hp:a.name.localeCompare(b.name);
}

// Heldenkraft **und** T1 stehen nebeneinander: die eine Zahl sagt nichts über die
// andere. 171 Mio Heldenkraft bei 30 Mio T1 ist ein anderer Spieler als umgekehrt,
// und welche der beiden zählt, hängt am Event und an der Rolle.
export function staerkeSpalte(p){
  return`<div style="font-size:10px;color:var(--tx3);white-space:nowrap;text-align:right;line-height:1.35">
    <div style="font-weight:800;color:var(--ass)">${p.hero_power?fmtMio(p.hero_power):'–'}</div>
    <div>T1 ${p.t1||'–'}</div>
  </div>`;
}

// ctx:
//   wert(name)    → aktueller Anmeldewert ('A'|'AE'|'B'|'BE'|'C'|null)
//   rolle(name)   → {label,color} aus der Rotation, oder null
//   rel(name)     → Zuverlässigkeit in % oder null
//   bilanz        → Ergebnis von einsatzBilanzAlle(), einmal für alle Zeilen
//   belegt(wert)  → wie oft dieser Wert schon vergeben ist
//   handler       → 'setTeamAssign' | 'csSetTeamAssign'
//   farbeA/farbeB → Team-Farben des Events (die bleiben verschieden)
//   maxGesetzt/maxErsatz
//   blass         → nach dem Anmeldeschluss die Nicht-Angemeldeten ausgrauen
export function anmeldeZeile(p,ctx){
  const name=p.name;
  const safe=name.replace(/'/g,"\\'");
  const wert=ctx.wert(name)||null;
  const rolle=ctx.rolle?ctx.rolle(name):null;
  const rel=ctx.rel?ctx.rel(name):null;
  const prio=prioOf(name);
  const cGes=prioCGesamt(name);
  const e=(ctx.bilanz||{})[name]||EINSATZ_LEER;
  // Steht neben dem Namen, nicht darin: mit fünf Knöpfen wird die Zeile am Handy
  // eng, und dann soll der lange Name gekürzt werden, nicht die Rolle.
  const rolleBadge=rolle?`<span style="flex-shrink:0;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;background:${rolle.color}22;color:${rolle.color};white-space:nowrap">${rolle.label}</span>`:'';
  // Vorschlag, keine Vorgabe: der Zähler steht neben dem Namen, damit sichtbar
  // ist, wer schon mehrfach leer ausging. Die Einteilung macht weiterhin der Mensch.
  const prioBadge=prio>0?`<span title="${prio}× angemeldet ohne Platz — bei der Einteilung bevorzugen" style="flex-shrink:0;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;background:#8e44ad22;color:#8e44ad;white-space:nowrap">⭐ Prio ${prio}</span>`:'';
  // Fünf Knöpfe, ein Wert: 'A'/'B' gesetzt, 'AE'/'BE' als Ersatz, 'C' angemeldet
  // ohne Platz. Jeder schreibt genau seinen Wert, ein zweiter Klick auf den
  // aktiven meldet ab — dieselbe Regel für alle fünf, damit kein Knopf eine
  // Sonderrolle hat. Volle Knöpfe werden ausgegraut, statt den Klick erst mit
  // einer Meldung abzuweisen: sichtbar ist besser als erklärt.
  const knopf=(w,farbe,titel)=>{
    const an=wert===w;
    const grenze=w==='C'?Infinity:(w.length>1?ctx.maxErsatz:ctx.maxGesetzt);
    const voll=!an&&ctx.belegt(w)>=grenze;
    return`<button onclick="${ctx.handler}('${safe}','${w}')" title="${voll?'Kein Platz mehr frei':titel}"
      style="font-size:11px;padding:3px ${w.length>1?6:9}px;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;
        border:1.5px ${w.length>1?'dashed':'solid'} ${farbe};background:${an?farbe:'transparent'};color:${an?'#fff':farbe}${voll?';opacity:.35':''}">${w}</button>`;
  };
  // Wie oft er insgesamt eingeteilt war — gesetzt vor dem Schrägstrich, Ersatz
  // dahinter. Erspart beim Einteilen den Weg ins Profil. Bewusst ohne <strong>
  // mittendrin: jedes Element zerschneidet den Textknoten, und die Anzeigeschicht
  // übersetzt je Knoten — die Zeile stünde sonst auf Englisch halb deutsch da.
  const hatBilanz=e.ws.gesetzt||e.ws.ersatz||e.cs.gesetzt||e.cs.ersatz||cGes;
  const bisher=hatBilanz
    ?`<div style="font-size:10px;color:${cGes?'#8e44ad':'var(--tx3)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="Bisher eingeteilt: gesetzt/Ersatz je Event, dazu wie oft insgesamt auf Team C">Bisher WS ${e.ws.gesetzt}/${e.ws.ersatz} · CS ${e.cs.gesetzt}/${e.cs.ersatz}${cGes?` · C ${cGes}`:''}</div>`
    :'';
  return`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bd)${ctx.blass&&!wert?';opacity:.38':''}">
    ${avatarImg(name,26,'border-radius:6px;margin-right:7px','')}<div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="openPlayer('${safe}')">${name}</div>
      ${bisher}
    </div>
    ${prioBadge}
    ${rolleBadge}
    ${staerkeSpalte(p)}
    <div style="font-size:10px;font-weight:700;color:${relColor(rel)};white-space:nowrap;width:34px;text-align:right">${rel!==null?rel+'%':'–'}</div>
    <div style="display:flex;gap:3px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
      ${knopf('A',ctx.farbeA,'Für Team A anmelden')}
      ${knopf('AE',ctx.farbeA,'Für Team A als Ersatzspieler einplanen')}
      ${knopf('B',ctx.farbeB,'Für Team B anmelden')}
      ${knopf('BE',ctx.farbeB,'Für Team B als Ersatzspieler einplanen')}
      ${knopf('C','#8e44ad','Angemeldet, aber kein Platz unter den 30 — zählt in der Prioliste')}
    </div>
  </div>`;
}

// Die Gruppen-Überschrift über einem Block der Liste.
export function anmeldeKopf(txt,farbe,bg,rand){
  return`<div style="padding:7px 12px 3px;font-size:11px;font-weight:800;color:${farbe};background:${bg};border-bottom:1px solid ${rand}">── ${txt} ──</div>`;
}
export function anmeldeBlock(liste,txt,farbe,bg,rand,ctx){
  if(!liste.length)return'';
  return anmeldeKopf(txt,farbe,bg,rand)+`<div style="padding:0 12px">${liste.map(p=>anmeldeZeile(p,ctx)).join('')}</div>`;
}
