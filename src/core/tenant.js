import { APP } from './state.js';

// ══════════════════════════════════════════════════════════════════
//  MANDANTEN — welche Allianz gerade gilt
// ══════════════════════════════════════════════════════════════════
// Bis August 2026 kannte die App genau eine Allianz. Jede Abfrage traf
// deshalb automatisch die richtigen Daten. Mit der zweiten Allianz ist
// das vorbei: jede Zeile trägt eine `alliance_id`, und jede Abfrage muss
// sie mitgeben.
//
// Dieses Modul ist bewusst winzig und hängt an nichts außer APP — es wird
// von api.js benutzt, und api.js darf nichts importieren, was seinerseits
// api.js braucht.

// Tabellen, deren Zeilen genau einer Allianz gehören. api.js filtert jede
// Anfrage an eine davon automatisch. Eine Tabelle, die hier fehlt, wäre
// über alle Allianzen hinweg sichtbar — die Liste ist deshalb vollständig
// zu halten, wenn eine Tabelle dazukommt.
export const TENANT_TABLES=new Set([
  'ws_players','ws_events','ws_participation','ws_player_history',
  'ws_planner_state','ws_polls','ws_poll_votes','vs_weeks','vs_entries',
  'zug_rides','ws_rankings','ws_versammlungen','ws_player_coords',
  'ws_presence','ws_priority',
]);

export function AID(){return APP.allianceId;}
export function currentAlliance(){return (APP.alliances||[]).find(a=>a.id===APP.allianceId)||null;}
// Kopfzeile und Bildunterschriften: „AR1S #1668"
export function allianceLabel(){
  const a=currentAlliance();
  return a?(a.tag+(a.server?' '+a.server:'')):'WarSync';
}
// Anmeldeseite und Export-Bilder zeigen den ausgeschriebenen Namen.
export function allianceName(){
  const a=currentAlliance();
  if(!a)return'WarSync Stats';
  return(a.name||a.tag)+(a.server?' '+a.server:'');
}

// Tabellenname aus einem PostgREST-Pfad: 'ws_players?order=name.asc' → 'ws_players'
export function tableOf(path){return String(path).split('?')[0].split('/')[0];}
export function isTenant(path){return TENANT_TABLES.has(tableOf(path));}

// localStorage gehört dem Gerät, nicht der Allianz. Ohne Suffix zeigte ein
// Wechsel der Allianz die Aufstellung der vorigen — der lokale Puffer wäre
// ein Leck zwischen zwei Mandanten. Die Schlüssel bekommen deshalb die
// Allianz angehängt; der geteilte Stand in der DB bleibt die Quelle.
export function lsKey(base){const a=AID();return a?base+'@'+a:base;}
