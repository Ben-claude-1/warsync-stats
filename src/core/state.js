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
// ── Gebäude: Reihenfolge und Slots ───────────────────────────────────────────
// Die Vorgabe stand dreimal im Quelltext — einmal hier und zweimal in
// ui/buildings.js (`moveBldPrio`, `renderStrategyCard`). Drei Kopien derselben
// Liste laufen auseinander, sobald jemand nur eine davon anfasst: die Karte
// zeigte dann eine andere Reihenfolge, als das Verschieben zugrunde legt. Sie
// steht deshalb nur noch hier, und wer sie braucht, importiert sie.
//
// Beides ist der Stand, den XP33 am 03.09.2026 eingestellt hatte, nicht die
// ursprüngliche Vorgabe: das Silo vorn (80/s, ab Min 10 das wertvollste
// Einzelgebäude), danach die beiden Ölraffinerien, dann die Lazarette. Arsenal
// und Söldnerfabrik stehen hinten und bekommen mit `0` auch keine Slots —
// Assassinen und Sammler decken Phase 2 ab.
//
// **Kopieren, nicht durchreichen.** `changeBldSlot` schreibt mit `bs[key]=…`
// direkt in das Objekt, das `getBldSlots` liefert. Käme dort die Vorgabe selbst
// heraus, veränderte ein Klick auf `+` die Vorgabe für alle Teams und alle
// Allianzen — und der Standard wäre nach dem ersten Klick nicht mehr der
// Standard. Deshalb `Object.freeze` auf der Liste und eine Funktion für die
// Slots, die jedes Mal ein frisches Objekt baut.
export const BLD_ORDER_DEFAULT=Object.freeze([
  'silo','oelraf1','oelraf2','laz1','laz3','laz2','laz4',
  'sciencehub','infozentrum','arsenal','soeldner','oelquellen',
]);
// Team B hält die Ölraffinerien mit vier statt zwei Plätzen — das ist so
// eingestellt und bewusst nicht angeglichen: die Slots sind Kapazität, kein
// Sollwert, und wie viele Spieler tatsächlich kommen, entscheidet der Kader.
export function bldSlotsDefault(team){
  const b=team==='B';
  return{
    // Zone 1
    oelraf1:b?4:2, infozentrum:2,
    // Zone 2
    laz2:2, laz4:2,
    // Zone 3
    oelraf2:b?4:2, sciencehub:2,
    // Zone 4
    laz1:2, laz3:2,
    // Zone 5 (Phase 2) — Arsenal und Söldnerfabrik werden nicht besetzt,
    // Assassinen und Sammler reichen. Die Gebäude bleiben in der Strategie-Karte
    // erklärt, sie sind nur keine Rolle mehr, der man Spieler zuweist.
    silo:4, arsenal:0, soeldner:0,
    // Sammler/Endgame (Ölquellen)
    oelquellen:0,
  };
}

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
  data:{events:[],participation:[],players:[],vsWeeks:[],vsEntries:[],zugRides:[],priority:[]},
  vsWeekId:null,vsFromDate:null,vsToDate:null,
  playerHistory:{}, // name → [{t1,t2,t3,t4,total_power,hero_power,recorded_at}]
  overlayPlayer:null, // global player profile overlay
  synced:false,syncErr:false,
  planner:{}, // geteilter Planungsstand aus ws_planner_state: key → data (siehe plannerPull)
  presence:[], // wer gerade angemeldet ist (ws_presence) — siehe core/presence.js
  // Aufstellung state — per team
  lineupA:{ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]},
  lineupB:{ass:[],ars:[],sold:[],sup:[],z1:[],z2:[],z3:[],z4:[]},
  lineupReadyA:false,
  lineupReadyB:false,
  // Slots pro Gebäude (pro Team) — Zone-Slots werden daraus abgeleitet (Summe der Gebäude in der Zone).
  bldSlotsA:bldSlotsDefault('A'),
  bldSlotsB:bldSlotsDefault('B'),
  buildingOrder:[...BLD_ORDER_DEFAULT],
  bldAssign:{},
  bldAssignPh2:{},   // zone-player → Phase-2-Gebäude nach minimalem Shift
  teamSide:'none',      // 'left' | 'right' | 'none' — bestimmt welche Lazarett-Zone leer bleibt
  infoCardOpen:true,    // Gebäude-Info-Karte aufgeklappt
  stratCardOpen:true,   // Strategie-Karte aufgeklappt
  wsAdvOpen:false,       // Aufstellung: "Erweitert" (manuelle Zuordnung + Einstellungen) eingeklappt
  mailText:{A:'',B:''},
  mailGeneral:'',
  accepted:[],
  teamAssign:{}, // playerName → 'A' | 'AE' | 'B' | 'BE' | 'C' | null — siehe REG_WERTE in core/rotation.js
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
  // Woher die Wechsler für die späten Gebäude gezogen werden — siehe CS_VERTEILUNG.
  csVerteilung:'schonend',
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
  csView:'aufstellung', // 'aufstellung' | 'anmeldung' | 'prio' | 'fraktion' | 'mail'
  csFaction:{A:'morgen',B:'ordnung'}, // wechselt wöchentlich, im Tab „Fraktion" umstellbar
  csPlanA:null,         // playerName → {s:Startgebäude|null, d:Ziel|null}
  csPlanB:null,
  csSlotsA:null,        // {ass:n, <gebäude>:n} — null = Defaults
  csSlotsB:null,
  csReadyA:false, csReadyB:false,
  csTeamAssign:{},      // playerName → 'A' | 'AE' | 'B' | 'BE' | 'C' — siehe REG_WERTE in core/rotation.js
  csAnmeldungClosed:false,
  csTime:{A:'16:00',B:'16:00'}, // europäische Startzeit je Team, siehe CS_ZEITEN
  csSel:null,
  csInfoOpen:true,
  csAdvOpen:false,       // Aufstellung: "Erweitert" (manuelle Zuordnung + Einstellungen) eingeklappt
  csPartner:'',         // Partnerallianz (nur Morgenbringer)
  csMsg:null,           // Allianz-Text · null = csMsgDefault() verwenden
  csSeite:{A:'ganz',B:'ganz'},  // bespielte Kartenhälfte je Team — siehe CS_SEITEN
  csSpawn:{A:'aus',B:'aus'},    // Gebäude an einer Spawnzone aussparen — siehe CS_SPAWN_REGEL
  csPresets:[],         // gespeicherte Einstellungsvarianten, je Team ladbar
  csPresetSel:'',       // welche Variante im Auswahlfeld steht (nur Anzeige)
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
