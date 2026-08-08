// Inline-Handler im erzeugten HTML (onclick="nav('home')") laufen ueber den
// globalen Namensraum. Nach dem Bundeln gibt es den nicht mehr — hier stehen
// deshalb genau die Namen, die aus HTML-Attributen heraus aufgerufen werden.
// Erzeugt von scripts/split_modules.py; nicht von Hand pflegen.

import { nav, renderPage, setTeam, setWSView } from './render.js';
import { doLogin } from '../core/auth.js';
import { setLang } from '../core/i18n.js';
import { downloadWSCardsPng, downloadWSCombinedPng, downloadWSMapPng, shareWSCombinedPng } from '../core/png.js';
import { APP } from '../core/state.js';
import { admAnalyzeMembers, admApplyMemberChanges, admMemPreview, adminCreatePlayer, adminMergePlayers, adminPromptSetPassword, adminSetAccess, adminSetPassword, adminSetPerm, adminSetVisionUrl, exportPlayersExcel } from '../ui/admin.js';
import { allianzToggleProf, allianzToggleRole, apdRename, apdSaveManual, apdSetActive, apdSetGender, apdSetInactive, apdSetRank, apd_setProfession, applyParsedTruppen, deleteHistoryEntry, parseTruppenText, requestAllianz } from '../ui/allianz.js';
import { autoAssign, changeBldSlot, copyText, cycleBldAssign, efAutoResult, efPtsInput, efRegChange, efShowPreviews, exportAufstellung, exportHinweise, handleSSUp, moveBldPrio, resetLineup, resetWSAnmeldung, saveResult2, saveWSState, setResult, setTeamAssign, wsCloseAnmeldung, wsReopenAnmeldung } from '../ui/buildings.js';
import { _csQ, csAutoAssign, csChangeSlot, csClearMove, csDragStart, csDrop, csImportFromWS, csMoveTo, csMsgInput, csResetLineup, csResetMsg, csResetWoche, csSaveState, csSelectChip, csSetFaction, csSetTeam, csSetTeamAssign, csSetView, downloadCSMapPng, shareCSMapPng, showCSMap } from '../ui/cs.js';
import { showHive } from '../ui/hive.js';
import { showWSAufstellungKarte } from '../ui/karte.js';
import { logout } from '../ui/login.js';
import { closeOverlay, openPlayer } from '../ui/overlay.js';
import { handleStrengthImageApd, handleStrengthImageProf, saveProfilePassword, saveStrength } from '../ui/profil.js';
import { rkSetTab, rkTogglePlayer } from '../ui/rankings.js';
import { createPoll, deletePoll, navUmfragen, restorePoll, togglePollVote } from '../ui/umfragen.js';
import { dragEnd, dragEnterZone, dragLeaveZone, dragStart, dropToBld, dropToZone, handleDrop, handleDropBld, selectChip, setTeamSide, vsAnalyze, vsApplyFix, vsSave, vsShowPreviews } from '../ui/vs.js';
import { ddAddPlayer, ddAnalyze, ddAutoRes, ddMapChange, ddPtsChange, ddRemovePlayer, ddSave, ddSetRes, ddShowPreviews, ddToggleEdit } from '../ui/ws.js';
import { showWSMap, wsmTab } from '../ui/wsmap.js';
import { zugAcceptAll, zugDownloadPng, zugSetField, zugSharePng } from '../ui/zugfahrt.js';
import { setCsStrength, setWsStrength } from '../core/helpers.js';

Object.assign(window, {
  APP, _csQ, admAnalyzeMembers, admApplyMemberChanges, admMemPreview, adminCreatePlayer, adminMergePlayers, adminPromptSetPassword, adminSetAccess, adminSetPassword, adminSetPerm, adminSetVisionUrl, allianzToggleProf, allianzToggleRole, apdRename, apdSaveManual, apdSetActive, apdSetGender, apdSetInactive, apdSetRank, apd_setProfession, applyParsedTruppen, autoAssign, changeBldSlot, closeOverlay, copyText, createPoll, csAutoAssign, csChangeSlot, csClearMove, csDragStart, csDrop, csImportFromWS, csMoveTo, csMsgInput, csResetLineup, csResetMsg, csResetWoche, csSaveState, csSelectChip, csSetFaction, csSetTeam, csSetTeamAssign, csSetView, cycleBldAssign, ddAddPlayer, ddAnalyze, ddAutoRes, ddMapChange, ddPtsChange, ddRemovePlayer, ddSave, ddSetRes, ddShowPreviews, ddToggleEdit, deleteHistoryEntry, deletePoll, doLogin, downloadCSMapPng, downloadWSCardsPng, downloadWSCombinedPng, downloadWSMapPng, dragEnd, dragEnterZone, dragLeaveZone, dragStart, dropToBld, dropToZone, efAutoResult, efPtsInput, efRegChange, efShowPreviews, exportAufstellung, exportHinweise, exportPlayersExcel, handleDrop, handleDropBld, handleSSUp, handleStrengthImageApd, handleStrengthImageProf, logout, moveBldPrio, nav, navUmfragen, openPlayer, parseTruppenText, renderPage, requestAllianz, resetLineup, resetWSAnmeldung, restorePoll, rkSetTab, rkTogglePlayer, saveProfilePassword, saveResult2, saveStrength, saveWSState, selectChip, setCsStrength, setLang, setResult, setTeam, setTeamAssign, setTeamSide, setWSView, setWsStrength, shareCSMapPng, shareWSCombinedPng, showCSMap, showHive, showWSAufstellungKarte, showWSMap, togglePollVote, vsAnalyze, vsApplyFix, vsSave, vsShowPreviews, wsCloseAnmeldung, wsReopenAnmeldung, wsmTab, zugAcceptAll, zugDownloadPng, zugSetField, zugSharePng
});
