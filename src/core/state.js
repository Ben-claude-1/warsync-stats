// Bewusst ohne Importe: state.js liegt jetzt unter core/tenant.js und damit unter
// core/api.js. Ein Import von hier nach oben (auth.js, ui/cs.js) schlösse einen
// Ring, in dem APP zum Zeitpunkt des ersten Zugriffs noch nicht steht.

export const MAIL_DEFAULT=`--- Hinweise ---

GEBÄUDE-TIMER:
Die ersten 30/60 Sekunden nach Einnahme sind alle Punkte sicher – abhängig vom Info-Center-Buff. Danach können 40% vom Gegner gestohlen werden.
Die Springer achten gezielt auf diese Situation.

VOR JEDEM ANGRIFF — SCOUTEN:
Niemals blind angreifen. Erst mit dem Spionageflugzeug aufklären, Stärke prüfen, dann entscheiden.

SPRINGER:
Tipp: T3-Squad mit einer einzigen Einheit besetzen. Das minimiert Verluste. Kämpfe vermeiden um Truppen für das Endgame zu sparen.
Springer positionieren sich günstig auf der Karte oder porten bei Gelegenheit direkt zu einem Gebäude — Ziel: Sichern von Punkten, nicht das Kämpfen.

HEALUPS — MIT BEDACHT EINSETZEN:
Heilbeschleuniger sparsam verwenden. Gegen starke Gegner sinnlos. Lieber Position wechseln als sinnlos heilen.

KEINE EINHEITEN MEHR?
Farmt bei den Ölfeldern.

FINALE MINUTE:
Wenn das Silo lange beim Gegner war, koordinierter Gemeinschaftsangriff auf das Silo.`;
// ── Was beim Wechsel der Allianz neu anfängt ──────────────────────────────────
// Alles, was zu genau einer Allianz gehört, steht hier drin und nirgends sonst.
// Der Super-Admin kann die Ansicht umschalten; danach darf kein Rest der vorigen
// Allianz mehr im Speicher liegen — eine stehengebliebene Aufstellung würde beim
// nächsten Speichern in die falsche Allianz geschrieben.
//
// Nicht hier hinein gehören: user, page, alliances, allianceId, Sprache, Sortier-
// und Ansichtswünsche des Geräts. Die überleben den Wechsel bewusst.
export function tenantDefaults(){
 return{
  data:{events:[],participation:[],players:[],vsWeeks:[],vsEntries:[],zugRides:[]},
  vsWeekId:null,vsFromDate:null,vsToDate:null,
  playerHistory:{}, // name → [{t1,t2,t3,t4,total_power,hero_power,recorded_at}]
  overlayPlayer:null, // global player profile overlay
  synced:false,syncErr:false,
  planner:{}, // geteilter Planungsstand aus ws_planner_state: key → data (siehe plannerPull)
  // Aufstellung state — per team
  lineupA:{ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]},
  lineupB:{ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]},
  lineupReadyA:false,
  lineupReadyB:false,
  // Slots pro Gebäude (pro Team) — Zone-Slots werden daraus abgeleitet (Summe der Gebäude in der Zone).
  bldSlotsA:{
    // Zone 1: Sum=5
    oelraf1:4, infozentrum:1,
    // Zone 2: Sum=1
    laz2:1, laz4:0,
    // Zone 3: Sum=3
    oelraf2:2, sciencehub:1,
    // Zone 4: Sum=1
    laz1:1, laz3:0,
    // Zone 5 (Phase 2) — Arsenal und Söldnerfabrik werden nicht mehr besetzt,
    // Assassinen und Sammler reichen. Die Gebäude bleiben in der Strategie-Karte
    // erklärt, sie sind nur keine Rolle mehr, der man Spieler zuweist.
    silo:1, arsenal:0, soeldner:0,
    // Sammler/Endgame (Ölquellen)
    oelquellen:2,
  },
  bldSlotsB:{
    oelraf1:4, infozentrum:1,
    laz2:1, laz4:0,
    oelraf2:2, sciencehub:1,
    laz1:1, laz3:0,
    silo:1, arsenal:0, soeldner:0,
    oelquellen:2,
  },
  buildingOrder:['infozentrum','oelraf1','sciencehub','oelraf2','arsenal','soeldner','laz1','laz2','laz3','laz4','silo','oelquellen'],
  bldAssign:{},
  bldAssignPh2:{},   // zone-player → Phase-2-Gebäude nach minimalem Shift
  teamSide:'none',      // 'left' | 'right' | 'none' — bestimmt welche Lazarett-Zone leer bleibt
  infoCardOpen:true,    // Gebäude-Info-Karte aufgeklappt
  stratCardOpen:true,   // Strategie-Karte aufgeklappt
  wsAdvOpen:false,       // Aufstellung: "Erweitert" (manuelle Zuordnung + Einstellungen) eingeklappt
  mailText:{A:'',B:''},
  mailGeneral:'',
  accepted:[],
  teamAssign:{}, // playerName → 'A' | 'AE' | 'B' | 'BE' | null  (E = Ersatzspieler)
  wsTime:{A:'13:00',B:'22:00'}, // europäische Startzeit je Team, siehe WS_ZEITEN
  anmeldungClosed:false,
  // Drag state
  selectedChip:null, selectedFromZone:null,
  lineupReady:false,
  // Event drill-down & player profile
  wsEventId:null,
  selectedPlayer:null,
  excusedPlayers:[],
  // Spieler-Sortierung
  playerSort:'name',
  // Kennzahl der Auto-Verteilung je Event: 't1' | 'hero'
  wsStrength:'t1',
  csStrength:'t1',
  // Allianz
  allianzSort:'role',
  allianzFilter:{roles:[],profession:'',minT1:0},
  allianzSearch:'',
  allianzPlayer:null,
  allianzPlayerTab:'daten',
  allianzPlayerEdit:false,
  allianzParsed:null,   // {t1,t2,t3,t4} from text paste
  allianzParsedSel:{},  // which fields are checked for apply
  historyEditId:null,   // ws_player_history.id being corrected (null = new entry)
  historyEditPrefill:{}, // prefill values when correcting an entry
  // Umfragen
  umfragenSub:'list',   // 'list' | 'create' | 'detail' | 'activity'
  umfragenPollId:null,
  // Zugfahrt
  zugTab:'plan',        // 'plan' | 'stats'
  zugSort:'count',      // 'count' | 'last' | 'name'
  zugBusy:false,
  // ── SCHLUCHTSTURM (Canyon Storm) ──
  csTeam:'A',
  csView:'aufstellung', // 'aufstellung' | 'anmeldung' | 'fraktion' | 'mail'
  csFaction:{A:'morgen',B:'ordnung'}, // wechselt wöchentlich, im Tab „Fraktion" umstellbar
  csPlanA:null,         // playerName → {s:Startgebäude|null, d:Ziel|null}
  csPlanB:null,
  csSlotsA:null,        // {ass:n, <gebäude>:n} — null = Defaults
  csSlotsB:null,
  csReadyA:false, csReadyB:false,
  csTeamAssign:{},      // playerName → 'A' | 'AE' | 'B' | 'BE' | null (E = Ersatz) — von Hand gepflegt, überlebt Updates
  csTime:{A:'16:00',B:'16:00'}, // europäische Startzeit je Team, siehe CS_ZEITEN
  csSel:null,
  csInfoOpen:true,
  csPartner:'',         // Partnerallianz (nur Morgenbringer)
  csMsg:null,           // Allianz-Text · null = csMsgDefault() verwenden
 };
}

export const APP={
  user:null,page:'home',wsView:'anmeldung',team:'A',
  vsView:'ranking',
  // ── Allianzen ──
  alliances:[],         // alle sichtbaren Allianzen (Super-Admin: alle, sonst die eigene)
  allianceId:null,      // welche Allianz die App gerade zeigt
  ...tenantDefaults(),
};

// Wechsel der Ansicht: alles Allianzgebundene fällt auf den Ausgangsstand zurück.
export function resetTenantState(){Object.assign(APP,tenantDefaults());}
