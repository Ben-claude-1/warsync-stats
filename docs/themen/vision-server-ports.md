---
thema: Vision-Server (OCR-Dienst), Ports und Tailscale
code: scripts/vision_server.py, scripts/com.onemann.warsync-vision.plist · src/core/config.js
verwandt: texterkennung-ocr, datenbank-backup, sicherheit-secrets
---

# Vision-Server, Ports und Tailscale

## Was der Dienst tut

Die Ergebnis-OCR im Browser: „🔍 Analysieren" im aufgeklappten Event (`ddAnalyze`) schickt
die Screenshots an `/analyze-ws` und ordnet die erkannten Namen per Fuzzy-Match der
Aufstellung zu. Es gibt außerdem `/analyze-vs`, `/analyze-strength` und `/analyze`.

`scripts/vision_server.py` bindet nur auf `127.0.0.1` — von außen kommt man ausschließlich
über Tailscale heran.

## Freigaben

| Endpunkt | Art |
|---|---|
| `https://mac-studio.taild5562c.ts.net:10000` | **Funnel, öffentlich** — entspricht dem Default in `src/core/config.js`, deshalb braucht die App keine Einstellung |
| `https://mac-studio.taild5562c.ts.net:5447` | tailnet only, Rückfalloption |

Funnel lässt nur 443, 8443 und 10000 zu; 443/8443 gehören PostgREST. Vorher lag hinter
Port 10000 nichts, daher kam beim Hochladen der Kampfergebnisse „❌ Failed to fetch".

Netzwerkfehler laufen über `visionErr()` und bekommen den Zusatz „Ist der Vision-Server
erreichbar?" — sonst steht dort nur „Failed to fetch".

**`tailscale serve/funnel` muss über `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
laufen** — die Homebrew-CLI stürzt auf diesem Mac ab.

## Der Portkonflikt vom 05.09.2026 — warum es PORTS.md gibt

Der Vision-Server wurde per LaunchAgent von Port 8444 auf **8445** umgezogen, weil 8444
belegt war. Die beiden Tailscale-Funnel-Regeln zeigten aber weiterhin auf 8444 — und dort
saß seit dem **02.08.2026** ein durchgehend laufender `python -m http.server` eines
anderen Projekts („Lern App"/„Vokabel-Rätsel"), ad-hoc gestartet und nirgends verwaltet.
Die App fragte `…:10000/analyze-ws` an und landete bei dieser fremden App, die mit `POST`
nichts anfangen kann und mit `501` antwortet. Im Browser kam das als Upload-Fehler an —
nicht am Bild, nicht an der Mitgliederliste, sondern an einem verwaisten Funnel-Ziel.

Daraus wurde eine projektübergreifende Regel:

- **`~/.claude/PORTS.md`** — Liste aller bekannten Ports, wer sie hält, wie sie verwaltet
  werden, plus die komplette Tailscale-Serve/Funnel-Zuordnung. Enthält auch eine Sektion
  „noch nicht zugeordnet".
- **`~/CLAUDE.md`** (lädt in jeder Session unter `/Users/ben`) trägt die Regel: **vor jedem
  neuen Server/Dienst zuerst in `PORTS.md` nachsehen und den Port danach sofort
  eintragen.** Gilt für Dev-Server, `python -m http.server`, LaunchAgents, Docker-Container.

Der Dienst speichert seit demselben Tag fehlerhafte Bilder unter
`~/.local/state/warsync/vision_failed/`.

## Der Server hat keine Anmeldung

Der Login der App schützt ihn nicht: er sitzt im Browser-Code, der Funnel ist ein eigener
Endpunkt daneben. Wer den Hostnamen kennt, kann `POST /analyze-ws` direkt schicken und
damit fremde Bilder durch das lokale Ollama jagen. Abschalten notfalls mit
`tailscale funnel --https=10000 off`.

## Die Vision-Modelle halluzinieren

Ein leeres 1×1-Pixel liefert erfundene Spieler mit Punktzahlen statt einer leeren Antwort.
Die erkannten Werte sind ein **Vorschlag zum Gegenlesen, keine Quelle**.

Konfiguration: `qwen2.5vl:7b` mit `num_ctx=4096`; `qwen2.5vl:72b` crasht auf Ollama 0.21.2
auf diesem Mac.

## Weitere Ports im Umlauf

Statische Test-Server für das Tool wurden auf 8792, 8799 und 8798 gestartet
(`python3 -m http.server`); vom Handy erreichbar über die Tailscale-Adresse
(`http://100.124.51.51:<port>/index.html`). `claude-ui` hält Port 3000, das
CloudCLI-Backend 3001, das Portal 8080, Postgres 5432. Vor jedem neuen Bind:
`~/.claude/PORTS.md`.

## Offen

`handleSSUp` (Screenshot der Anmeldeliste) ist weiterhin nur ein Platzhalter. Die geänderte
`scripts/com.onemann.warsync-vision.plist` (8444→8445) lag zuletzt uncommittet im Repo.

## Sessions

- `docs/sessions/2026-09-05-9478adb6.md` — Portkonflikt, PORTS.md angelegt
- `docs/sessions/2026-09-08-c132e9fc.md` — `/analyze-strength` aktiviert und getestet
