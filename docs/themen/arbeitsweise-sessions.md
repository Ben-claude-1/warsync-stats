---
thema: Arbeitsweise — Terminal, parallele Sessions, Session-Journal, Handoff
code: ~/.local/share/claude-handoff/bin/ (session_journal.py, prune_sessions.py, build_project_claude_md.py, claude_softcompact.py)
verwandt: bluestacks-steuerung, frontend-build-deploy
---

# Arbeitsweise in diesem Projekt

## Terminal- und Maus-Regeln (hart)

- **Skripte immer in einem sichtbaren Terminal starten**, keine Hintergrund-Jobs. Das
  Fenster am Ende schließen.
- **Alle Maus-Skripte müssen MouseGuard enthalten.**
- **`do script` startet im Home-Verzeichnis.** Den Befehl deshalb immer mit
  `cd <repo> && …` und absolutem Pfad bauen und **vor dem Absenden per grep prüfen**. Am
  11.09.2026 wurden fünfmal hintereinander dieselbe fehlerhafte Zeile abgeschickt, weil der
  Wechsel ins Projektverzeichnis fehlte.
- **Terminal-Fenster lassen sich per AppleScript nicht schließen** — `close` wird von
  Terminal.app ignoriert, nur Cmd+W erledigt sie.
- **Lange Läufe aktiv überwachen:** `python -u` ohne Pipe, Zwischenstand nach jedem
  Abschnitt speichern, Zähler gegenprüfen.

## Parallele Claude-Sessions sind eine echte Fehlerquelle

Sie stören sich am gemeinsamen Gerät und am gemeinsamen Arbeitsbaum. Belegte Fälle:

- **Am selben Repo:** eine zweite Sitzung committete während der Arbeit (`be89bfc`) und
  fasste `scripts/ws_service/roster.py` an — Dateien verschwanden unter dem laufenden Lauf
  aus dem Arbeitsbaum.
- **Am selben BlueStacks:** die Gerätesperre hält (PID-Lock), aber solange ein Scan läuft,
  darf in anderen Sessions nichts am Gerät gestartet werden. Duplikate erklären
  Rücksprünge und scheinbare „Hänger".
- **Wiederholt neu gestartete Sessions:** am 05.09.2026 startete etwas auf dem Mac dieselbe
  Session zweimal neu (vermutlich ein LaunchAgent oder Watchdog rund um CloudCLI/claude-ui)
  — mitten in einem 561-Turn-Scan.
- Am 02.09.2026 liefen **fünf** weitere Sessions in diesem Projekt, zwischen 2 und 15 Tagen
  alt; eine hatte ungefragt gepusht.

**Vor jedem Gerätezugriff `ps … --resume` prüfen.** Duplikate nicht ungefragt killen.

## `softcompact` schreibt die laufende Session um

Es kürzt die laufende `.jsonl` und hängt „Continue from where you left off" an. Das war die
Ursache widersprüchlicher Antworten und ist seit dem 06.09.2026 pausiert.

## Das dreistufige Gedächtnis dieses Projekts

| Ebene | Datei | Kosten |
|---|---|---|
| Immer geladen | `CLAUDE.md` (Regeln) + `MEMORY.md` (Index) | hart budgetiert |
| **Themen** | `docs/themen/*.md` — **eine Datei je Thema** | nur bei Bedarf gelesen |
| Journal | `SESSIONS.md` — eine Zeile je Session, per Grep | 0, wird nicht geladen |
| Rohauszug | `docs/sessions/<datum>-<id>.md` — Digest je Session | 0, gezielt lesen |

**Wenn ein Thema genannt wird, zuerst die passende Datei unter `docs/themen/` lesen.** Der
Index steht in `docs/themen/README.md`. Reicht das nicht, per Grep in `SESSIONS.md` suchen
und den verlinkten Digest unter `docs/sessions/` öffnen.

### Wie die Dateien entstehen

- **`session_journal.py`** baut aus den Session-`jsonl` je Session einen Digest und daraus
  `SESSIONS.md` neu. Die Zusammenfassung macht das lokale Ollama (`qwen2.5:32b`) — keine
  Cloud, keine Kosten. Aus einer 18-MB-Session werden ~1700 Token Eingabe: nur die
  Nutzerfragen und die letzten Assistant-Antworten, denn dort steht das Fazit.
  Idempotent, darf jederzeit abbrechen.
  `--min-age-hours 1` lässt die noch laufende Session in Ruhe.
- **`prune_sessions.py`** komprimiert alte `jsonl` (rund 10× kleiner). Es behält je Projekt
  die N jüngsten unangetastet — **nur die lassen sich mit `claude --resume` fortsetzen und
  nur die zeigt CloudCLI in der Liste.** Sicherung: eine Session wird **nur** angefasst,
  wenn es zu ihr einen Digest unter `docs/sessions/` gibt.
- **`build_project_claude_md.py`** (LaunchAgent `local.claude-handoff-watch`) überschreibt
  in `CLAUDE.md` **nur** den Block zwischen den `handoff:sessions`-Markern — Text davor und
  danach bleibt erhalten. Wer in `CLAUDE.md` schreibt, muss das wissen.

Wiederherstellen einer komprimierten Session:
`gunzip -k ~/.claude/projects/<projekt>/<id>.jsonl.gz`

## Handoff-Dokumente

Läuft eine Session ins Token-Limit, schreibt sie eine Übergabe (`session-<id>.md` im
Projekt-Root). Die Folgesession beginnt dann mit „Lies zuerst @session-XXXX.md als
Kontext". Mehrere Ketten im September sind so entstanden (`5723e3d1` → `f9d406eb` →
`1a507d83` → `fb02f5f1` → `15d63953` → `108be771`). Diese Dateien sind durch
`docs/themen/` und `docs/sessions/` ersetzt, aber die alten liegen noch.

## Zwei Haltungen, die sich durch das ganze Projekt ziehen

**Eine Prüfung, die den Fall nicht enthält, ist grün und wertlos.** Belegt an den blauen
Namen auf der Karte (24 weiße Schilder in der Stichprobe, der halbe Kern unlesbar), an
Bens gelbgrüner Basis, am Team-Schild im Export und am Namen in der Anmeldezeile — jedes
Mal war die Suite grün und Ben hat den Fehler gesehen. Wenn ein Fall auffällt, kommt er in
die Stichprobe, nicht nur der Fix in den Code.

**Lieber eine Lücke als ein plausibel aussehender falscher Wert.** `NULL` heißt „nicht
gelesen", nicht „Stufe 0". Ein unsicherer Name wird gemeldet, nicht geraten. Eine halb
gelesene Liste wird nicht geschrieben. Der Grund ist immer derselbe: ein Fehler, der
vollständig aussieht, wird nicht gefunden.

## Sessions

- `docs/sessions/2026-09-05-5c96f6c4.md` — doppelt gestartete Sessions (561 Turns)
- `docs/sessions/2026-09-02-5b960667.md` — fünf parallele Sessions beendet
- `docs/sessions/2026-09-08-27fd042d.md` — fremde Session im selben Repo
- `docs/sessions/2026-09-11-3cba7da7.md` — Terminal startet im Home
