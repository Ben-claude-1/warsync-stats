import { VS_TAGESZIEL } from './config.js';
import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  VS-TAGESPUNKTE — wer schafft die 7,2 Mio, und an welchen Tagen nicht
// ══════════════════════════════════════════════════════════════════
// Die Wochensumme beantwortet die Frage nicht, um die es geht. 43,2 Mio in der
// Woche können sechs ordentliche Tage sein oder zwei starke und vier leere —
// und weil jeder Tag im Duell eine eigene Aufgabe hat (Montag Radar, Dienstag
// Bau, Mittwoch Technologie …), ist genau das der Unterschied: wer mittwochs
// nie liefert, hat kein Fleiß-, sondern ein Forschungsproblem.
//
// Gefüllt wird `vs_tage` vom Scan (`scripts/vs_service`), der die Tagesliste im
// Spiel ausliest.

export const WOCHENTAGE=['Mo','Di','Mi','Do','Fr','Sa'];

// ── Datum und Woche ───────────────────────────────────────────────────────
// Gerechnet wird auf 'YYYY-MM-DD' als Zeichenkette, nicht auf Date-Objekten:
// gemeint ist der Kalendertag im Spiel, nicht ein Zeitpunkt auf diesem Gerät.
// Ein Date zöge die Zeitzone mit und verschöbe den Tag am Abend um einen.
export function tagIndex(datum){
  const[j,m,t]=String(datum).split('-').map(Number);
  // Zeitzonenfrei: Wochentag aus dem Kalender selbst.
  const d=new Date(Date.UTC(j,m-1,t));
  return (d.getUTCDay()+6)%7;   // 0 = Montag
}
export function wochentag(datum){return WOCHENTAGE[tagIndex(datum)]||'So';}
export function montagVon(datum){
  const[j,m,t]=String(datum).split('-').map(Number);
  const d=new Date(Date.UTC(j,m-1,t));
  d.setUTCDate(d.getUTCDate()-tagIndex(datum));
  return d.toISOString().slice(0,10);
}

// ── Was ein fehlender Wert bedeutet ───────────────────────────────────────
// **Drei Zustände, nicht zwei.** Ein Spieler ohne Eintrag hat entweder nichts
// geholt oder ist gar nicht gelesen worden, und beides sieht in der Tabelle
// gleich aus, wenn man es nicht trennt. Die Auskunft dazu steht in
// `vs_tage_lauf`: die Liste im Spiel endet bei 100 Zeilen. War der Lauf
// vollständig *und* die Liste nicht voll, ist der Fehlende belegt nicht
// angetreten. Sonst weiß der Lauf über ihn nichts — und dann behauptet die
// Auswertung auch nichts.
export const LISTEN_GRENZE=100;

export function laufVon(datum){
  return (APP.data.vsTageLauf||[]).find(l=>l.datum===datum)||null;
}
export function nullZaehltAls(datum){
  const l=laufVon(datum);
  return !!(l&&l.vollstaendig&&l.gelesen<LISTEN_GRENZE);
}

// ── Der laufende Tag zählt nicht mit ──────────────────────────────────────
// Wer heute um 10 Uhr 2 Mio hat, hat das Tagesziel nicht verfehlt — er ist noch
// dabei. Ein laufender Tag als „verfehlt" gezählt setzte die halbe Allianz auf
// die Mängelliste, und zwar jeden Tag aufs Neue. Die Punkte werden trotzdem
// angezeigt; nur gezählt wird der Tag erst, wenn er vorbei ist.
//
// Maßgeblich ist die **Serverzeit**, nicht die des Geräts: der Duelltag wechselt
// mit ihr, und sie liegt vier Stunden zurück (SERVER_DIFF_H in helpers.js).
export const SERVER_DIFF_H=4;
export function serverHeute(jetzt=new Date()){
  const d=new Date(jetzt.getTime()-SERVER_DIFF_H*3600000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Drei Lagen, nicht zwei: vorbei · läuft gerade · noch gar nicht gewesen. Die
// letzten beiden zählen gleich (nämlich nicht), heißen aber verschieden — ein
// Samstag mit „läuft" über einer leeren Spalte ist schlicht falsch, und der
// Hinweis „an 3 Tagen wurde nichts gelesen" wäre dort ein Vorwurf an niemanden.
export function tagLage(datum,jetzt=new Date()){
  const h=serverHeute(jetzt);
  return datum<h?'vorbei':datum===h?'laeuft':'kommt';
}
export function laeuftNoch(datum,jetzt=new Date()){return tagLage(datum,jetzt)!=='vorbei';}

// `null` = nicht gelesen · 0 = belegt nichts geholt · Zahl = Punkte
export function punkteVon(karte,name,datum){
  const p=karte[name]&&karte[name][datum];
  if(p!==undefined)return p;
  return nullZaehltAls(datum)?0:null;
}

// ── Die Daten einmal umdrehen ─────────────────────────────────────────────
// {spieler: {datum: punkte}} — einmal gebaut, danach nur noch nachgeschlagen.
// Bei hundert Spielern über Wochen sind das vierstellig viele Zeilen; je Zelle
// darin zu suchen wäre in jeder Tabellenzeile spürbar (dieselbe Überlegung wie
// bei `einsatzBilanzAlle`).
export function tagesKarte(zeilen){
  const karte={};
  (zeilen||[]).forEach(z=>{
    (karte[z.player_name]||(karte[z.player_name]={}))[z.datum]=z.pts;
  });
  return karte;
}

export function tageImZeitraum(von,bis){
  const alle=new Set();
  (APP.data.vsTage||[]).forEach(z=>{
    if((!von||z.datum>=von)&&(!bis||z.datum<=bis))alle.add(z.datum);
  });
  (APP.data.vsTageLauf||[]).forEach(l=>{
    if((!von||l.datum>=von)&&(!bis||l.datum<=bis))alle.add(l.datum);
  });
  return [...alle].sort();
}

export function wochen(){
  return [...new Set(tageImZeitraum().map(montagVon))].sort().reverse();
}

// ── Die Auswertung ────────────────────────────────────────────────────────
// Je Spieler: wie oft hat er das Tagesziel an einem Montag verfehlt, wie oft an
// einem Dienstag … und wie oft insgesamt. Das ist die Frage hinter der ganzen
// Tabelle: **an welchem Tag** jemand hängt, nicht nur *dass* er hängt.
export function bilanz(von,bis,ziel=VS_TAGESZIEL){
  const tage=tageImZeitraum(von,bis);
  const karte=tagesKarte((APP.data.vsTage||[]).filter(
    z=>(!von||z.datum>=von)&&(!bis||z.datum<=bis)));
  const aktiv=(APP.data.players||[]).filter(p=>p.active!==false).map(p=>p.name);
  // Wer in den Daten steht, aber nicht (mehr) im Kader, gehört trotzdem in die
  // Auswertung des Zeitraums — sonst verschwindet rückwirkend, wer die Allianz
  // verlassen hat, und die Summen stimmen nicht mehr.
  const namen=[...new Set([...aktiv,...Object.keys(karte)])].sort((a,b)=>a.localeCompare(b));

  const zeilen=namen.map(name=>{
    const proTag=WOCHENTAGE.map(()=>({verfehlt:0,gezaehlt:0}));
    let verfehlt=0,gezaehlt=0,summe=0,tageMitWert=0,gelesen=0;
    tage.forEach(d=>{
      const p=punkteVon(karte,name,d);
      if(p===null)return;                 // nicht gelesen — zählt nirgends mit
      gelesen++;summe+=p;
      if(p>0)tageMitWert++;
      if(laeuftNoch(d))return;            // heute ist noch nicht vorbei
      const i=tagIndex(d);
      gezaehlt++;
      if(proTag[i]){
        proTag[i].gezaehlt++;
        if(p<ziel)proTag[i].verfehlt++;
      }
      if(p<ziel)verfehlt++;
    });
    return{name,proTag,verfehlt,gezaehlt,gelesen,summe,tageMitWert,
      imKader:aktiv.includes(name)};
  // Wer an keinem Tag des Zeitraums gelesen wurde, gehört nicht in die Tabelle.
  // `gezaehlt` taugt dafür nicht: an einem Tag, der noch läuft, ist es 0 — und
  // dann stünde die Woche bis zum ersten abgeschlossenen Tag leer da.
  }).filter(z=>z.gelesen>0);

  zeilen.sort((a,b)=>b.verfehlt-a.verfehlt||a.summe-b.summe||a.name.localeCompare(b.name));
  return{tage,zeilen,karte,ziel};
}

// Die Tage einer Woche in der Reihenfolge Mo…Sa — auch die, an denen niemand
// gelesen wurde (dort steht dann eine leere Spalte statt gar keiner; sonst
// verschöbe sich das Raster von Woche zu Woche).
export function wochenTage(montag){
  const[j,m,t]=montag.split('-').map(Number);
  return WOCHENTAGE.map((_,i)=>{
    const d=new Date(Date.UTC(j,m-1,t));
    d.setUTCDate(d.getUTCDate()+i);
    return d.toISOString().slice(0,10);
  });
}
