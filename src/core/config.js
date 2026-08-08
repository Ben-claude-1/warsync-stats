import { LANG, i18nMissing } from './i18n.js';

export const SB='https://mac-studio.taild5562c.ts.net:8443';
export const KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3MDM0NjM1LCJleHAiOjE5MzQ3MTQ2MzV9.CZ58RDIupO_P5bW_9PUwDe6R120UtjsgICaSmcx4buI';
export const VS_TARGET=43200000; // Wochenziel: 7,2 Mio × 6 Tage

export const VISION_URL=()=>localStorage.getItem('visionUrl')||'https://mac-studio.taild5562c.ts.net:10000';
// „Failed to fetch" heißt: die Anfrage kam nie an — falsche URL, Server aus oder
// keine Freigabe. Ohne diesen Zusatz steht der Nutzer vor einer Meldung, mit der
// er nichts anfangen kann.
export function visionErr(e){
  const m=(e&&e.message)||String(e);
  return m+((m.includes('fetch')||m.includes('Failed')||m.includes('NetworkError'))
    ?' — Ist der Vision-Server erreichbar? (Admin → Vision-URL prüfen)':'');
}

// ══════════════════════════════════════════════════════════════════
//  I18N — Anzeigesprache Deutsch/Englisch
// ══════════════════════════════════════════════════════════════════
// Die Oberfläche ist durchgehend auf Deutsch geschrieben. Statt alle
// ~900 Strings im Quelltext durch t()-Aufrufe zu ersetzen (und dabei
// eine 6700-Zeilen-Datei anzufassen, die live auf GitHub Pages läuft),
// übersetzt diese Schicht die *gerenderte* Oberfläche: Textknoten und
// die Attribute placeholder/title/aria-label werden nach dem Rendern
// durch das Wörterbuch geschickt.
//
// Konsequenzen, die man kennen muss:
//  · Bei LANG==='de' passiert gar nichts — kein Walk, kein Observer-
//    Callback, keine Verhaltensänderung gegenüber vorher.
//  · Nur die Anzeige wird übersetzt. Werte, die in die DB gehen
//    ('Kriegsführer', 'gewonnen', …), bleiben unangetastet — sie
//    stehen in Attributen bzw. im JS, nicht im Textknoten.
//  · TEXTAREA ist ausgenommen: dort stehen die Allianz-Nachrichten,
//    die im Spiel gepostet werden. Die sollen nicht mit der UI-Sprache
//    kippen, sonst schickt ein englischer Nutzer plötzlich englische
//    Ansagen in eine deutsche Allianz.
//  · Fehlt ein String im Wörterbuch, bleibt er deutsch stehen — die
//    App bricht nie. i18nMissing() listet solche Fälle auf.
