// Hängt an die Asset-Verweise in index.html den Inhalts-Hash an:
//   <script src="dist/main.js?v=a1b2c3d4">
//
// Ohne den blieb ein Gerät nach einem Deploy beliebig lange auf dem alten
// Bundle hängen — GitHub Pages liefert `dist/main.js` unter demselben Namen
// aus, der Browser hat keinen Anlass, ihn erneut zu holen. Am 27.08.2026 hat
// genau das einen Spieler-Anlage-Fehler verursacht: der zwischengespeicherte
// Bundle stammte von vor dem Multi-Allianz-Umbau und schickte `alliance_id`
// nicht mit, worauf die NOT-NULL-Bedingung zuschlug. Ein Fehler, der nur auf
// einem Gerät auftritt und im Quelltext nicht zu finden ist.
//
// Läuft automatisch nach `npm run build` (und build:dev/watch).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const htmlPath = new URL('index.html', ROOT);

// Die Chunks aus esbuilds --splitting tragen den Hash schon im Dateinamen und
// werden aus main.js heraus geladen — nur die beiden Einstiegs-Assets brauchen
// die Kennung.
const ASSETS = ['dist/main.js', 'src/styles.css'];

const hash = (rel) =>
  createHash('sha256').update(readFileSync(new URL(rel, ROOT))).digest('hex').slice(0, 8);

let html = readFileSync(htmlPath, 'utf8');
for (const rel of ASSETS) {
  // Ein bereits vorhandenes ?v=… wird ersetzt, nicht angehängt.
  const re = new RegExp('(["\'])' + rel.replace(/[./]/g, '\\$&') + '(\\?v=[0-9a-f]+)?\\1', 'g');
  const vorher = html;
  html = html.replace(re, `$1${rel}?v=${hash(rel)}$1`);
  if (html === vorher) console.warn(`stamp_assets: ${rel} kommt in index.html nicht vor.`);
}
writeFileSync(htmlPath, html);
console.log('stamp_assets: index.html gestempelt.');
