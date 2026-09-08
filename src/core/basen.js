import { sbGet } from './api.js';
import { currentAlliance } from './tenant.js';

// ══════════════════════════════════════════════════════════════════
//  BASEN DER WELTKARTE — Ablage und Suche
// ══════════════════════════════════════════════════════════════════
// Gefüllt wird `karte_basen` vom Kartenscan (scripts/karten_archiv), der die
// Weltkarte kachelweise abfotografiert und die Banner liest. Hier steht nur die
// Leseseite.
//
// **Der Zuschnitt ist der Server, nicht die Allianz.** Die Karte gehört allen
// Allianzen desselben Servers gemeinsam — AR1S und XP33 stehen beide auf #1668
// und sehen dieselben Basen. Die Tabelle ist deshalb bewusst nicht in
// `TENANT_TABLES`; `api.js` hängt ihr also keine `alliance_id` an.
//
// Genau deshalb steht jede Abfrage **hier** und nicht an den Aufrufstellen: der
// Server-Filter ist das Gegenstück zur Mandantentrennung, und eine vergessene
// Stelle wäre ebenso still — sie zeigte die Karte einer fremden Welt.

export function serverOf(){
  const a=currentAlliance();
  return a&&a.server?a.server:null;
}

// ── Suchmuster ───────────────────────────────────────────────────────────────
// Der Stern ist das, was der Nutzer tippt: `Ben*men` findet `Ben_the_men`.
// Ohne Stern ist die Suche ein Teilstring, denn danach sucht man meistens —
// „ben" soll `Ben_the_men` finden, ohne dass jemand Sterne setzen muss.
//
// **Was getippt wird, meint sich selbst.** `%` und `_` sind in SQL selbst
// Platzhalter, und `_` steckt in echten Namen (`Ben_the_men`). Ungeschützt
// stünde dort ein „irgendein Zeichen", und die Suche nach dem eigenen Namen
// fände plötzlich auch `Benathemen`. Sie werden deshalb maskiert, bevor der
// Stern zum Platzhalter wird — sonst maskierte man den eigenen Platzhalter mit.
export function suchmuster(roh){
  const s=String(roh==null?'':roh).trim();
  if(!s)return null;
  const fest=s.replace(/([\\%_])/g,'\\$1');
  const mit=fest.replace(/\*/g,'%');
  return mit.includes('%')?mit:'%'+mit+'%';
}

// Wie viele Basen der Server kennt — für die leere Seite („noch kein Scan")
// und die Kopfzeile.
export async function basenAnzahl(){
  const srv=serverOf();
  if(!srv)return 0;
  const r=await sbGet(`karte_basen?server=eq.${encodeURIComponent(srv)}&select=id&limit=1`,
                      {scoped:false});
  return Array.isArray(r)?r.length:0;
}

// `muster` ist das Ergebnis von `suchmuster` — null heißt „alles zeigen".
//
// Gesucht wird **in der Datenbank**, nicht im Browser: eine abgescannte Karte
// hat fünfstellig viele Basen, und die alle zu laden, um vier davon anzuzeigen,
// wäre am Handy spürbar. `limit` ist die Reißleine gegen eine Suche nach „e".
export async function basenSuchen(muster,{limit=200}={}){
  const srv=serverOf();
  if(!srv)return {rows:[],server:null};
  let p=`karte_basen?server=eq.${encodeURIComponent(srv)}`
       +`&select=name,name_roh,allianz,level,x,y,gesehen_at`;
  if(muster)p+=`&name=ilike.${encodeURIComponent(muster)}`;
  // Nach Stufe absteigend: wer sucht, sucht meist die starken Basen zuerst.
  // Der Name entscheidet bei Gleichstand, damit die Reihenfolge nicht der Laune
  // der Datenbank überlassen bleibt.
  p+=`&order=level.desc.nullslast,name.asc&limit=${limit+1}`;
  const rows=await sbGet(p,{scoped:false});
  // Eine Zeile mehr geholt als angezeigt wird: nur so ist zu erkennen, ob die
  // Liste abgeschnitten ist. Ohne das stünde „200 Treffer" da, wenn es 4000 sind.
  const mehr=rows.length>limit;
  return {rows:mehr?rows.slice(0,limit):rows,mehr,server:srv};
}
