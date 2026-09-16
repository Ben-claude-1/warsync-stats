---
thema: Geteilter Planungsstand (ws_planner_state) und Anwesenheit (ws_presence)
code: src/core/state.js (plannerResolve, plannerPush), src/core/presence.js
migrationen: db/2026-08-31_ws_presence.sql
verwandt: mehrere-allianzen-rollen, wuestensturm, schluchtsturm, vs-duell
---

# Geteilter Planungsstand und Anwesenheit

## Der Planungsstand

Aufstellung (WS + CS), Gebäude-Zuordnung, Kartenbild, Label-Positionen und der VS-Gegner
liegen in `ws_planner_state` (`key` → `data` jsonb). Keys: `ws`, `cs`, `karte`, `karte_bg`,
`vs`. Vorher lag das nur im `localStorage`, deshalb sah die Aufstellung auf jedem Gerät
anders aus.

Regeln beim Laden (`plannerResolve`):

- **Die DB gewinnt.** Der lokale Stand nur dann, wenn sein `savedAt` neuer ist **und** der
  Nutzer schreiben darf — das ist der Offline-Fall.
- **Ein leerer Stand verdrängt nie automatisch einen gefüllten.** Sonst hätte das Gerät
  gewonnen, das zufällig zuerst lädt.
- **Bewusstes Leeren** (Aufstellung zurücksetzen, Wochen-Reset) läuft über `saveWSState` →
  `plannerPush` und geht immer durch.

Schreiben darf nur `canAccess('ws')` / `canAccess('cs')` — der Check sitzt im Client, die
Tabelle selbst steht wie alle anderen offen. `updated_at` setzt ein Trigger in der DB,
nicht der Client; verglichen wird ausschließlich das `savedAt` im Payload.

**`plannerPush` merkt sich die Allianz beim Einplanen, nicht beim Ausführen.** Der Push ist
um 900 ms entprellt; wer in der Zwischenzeit umschaltet, überschriebe sonst die fremde
Aufstellung. Drei Schichten sichern das (Details in `mehrere-allianzen-rollen.md`).

**Schreibende Dienste müssen `savedAt` mitziehen.** Der Anmelde-Scan legt vor dem Schreiben
eine Sicherung ab und setzt `savedAt` hoch — sonst hält ein offener Browser-Tab seinen
älteren Stand für den neueren und schreibt ihn zurück.

**Beim Einbau neuer Felder erst pushen, dann Werte setzen.** Ein laufender Client, der die
neuen Felder (`csSeite`, `csSpawn`, `csPresets`) noch nicht kennt, schreibt sie beim
nächsten Speichern wieder weg. Nach einem solchen Deploy: **einmal hart neu laden.**

Sicherungen von Hand liegen als eigene Zeilen daneben (z. B. `ws_planner_state_bak_20260901`).

## Anwesenheit — „🟢 Gerade angemeldet"

Seit 31.08.2026. Im Admin-Bereich steht ganz oben die Karte. Die Anmeldung lebt
ausschließlich im Browser-Tab (`APP.user`, ein Neuladen führt zurück auf die Anmeldeseite)
— **es gibt keine Sitzung auf dem Server, die man fragen könnte.** Wer da ist, meldet sich
deshalb selbst: jeder angemeldete Tab schreibt im Minutentakt eine Zeile in `ws_presence`
fort.

Vier Dinge, die zusammengehören:

- **Zeitstempel statt Flag.** Wer den Tab zumacht, meldet sich nicht ab. Ein Feld `online`
  stünde danach bis in alle Ewigkeit auf „an"; `last_seen` verfällt von selbst. Als anwesend
  gilt, wer sich in den letzten drei Minuten gemeldet hat (`PRESENCE_ONLINE_MS`), alle
  anderen stehen unter „Zuletzt gesehen".
- **Nur der sichtbare Tab schlägt.** Ein Tab im Hintergrund heißt nicht, dass jemand am
  Gerät sitzt. Ein weggelegtes Handy fällt so nach drei Minuten aus der oberen Liste — die
  ehrlichere Auskunft.
- **Je Gerät eine Zeile.** Schlüssel ist `(alliance_id, player_name, device_id)`; die
  `device_id` liegt als zufällige ID im `localStorage`, bewusst **ohne**
  `lsKey()`-Suffix — sie gehört dem Browser und nicht der Allianz. Ohne sie überschrieben
  sich Handy und Laptop desselben Menschen. Die Anzeige fasst sie wieder zu einer Zeile
  zusammen: „Ben · iPhone · Mac".
- **`first_seen` wird bei jedem Schlag mitgeschickt.** Ließe man das Feld weg, bliebe der
  Wert der vorigen Sitzung stehen und die Karte behauptete „angemeldet seit gestern 09:00"
  für jemanden, der eben erst kam.

**Beim Wechsel der Allianz löscht `presenceBeat` erst die Zeile in der alten** — sonst
stünde man dort noch minutenlang. **Beim Abmelden räumt `presenceRemove` die Zeile weg,
bevor `APP.user` auf `null` geht**; danach wüsste sie nicht mehr, wessen Zeile gemeint ist.

**Die Karte frischt sich alle 30 Sekunden selbst auf** (`presenceRefreshCard` schreibt nur
in `#adm-presence-body`) und **nicht** über `renderPage()`: das würde jedes Mal wegwerfen,
was der Admin gerade in „Neuen Spieler anlegen" oder ins Passwortfeld getippt hat.

Getestet in `tests/anwesenheit.spec.js`.

## Sessions

- `docs/sessions/2026-08-31-40553b32.md` — Anwesenheit eingebaut
- `docs/sessions/2026-09-01-bdf4fb08.md` — erst pushen, dann Werte setzen
