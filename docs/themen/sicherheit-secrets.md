---
thema: Sicherheit und Zugangsdaten — Passwortleak, Tresor, offene Endpunkte
verwandt: vision-server-ports, datenbank-backup, frontend-build-deploy
---

# Sicherheit und Zugangsdaten

## Der Passwortleak vom 13.09.2026

Ein **Klartext-Passwort für das Supabase-Projekt** wurde versehentlich ins öffentliche Repo
gepusht. Entfernt; der Wert wird jetzt aus der Umgebung geladen.

**Zwei Ursachen, beide vermeidbar:**

- **Scan und Push in einer Zeile.** Die Prüfung lief im selben Befehl wie der Push — ein
  Fund konnte den Push nicht mehr verhindern.
- **Ein unvollständiges Suchmuster.** Es hat den Treffer nicht gesehen.

Der Push umfasste zwei Commits mit 71 Dateien (Werkzeug-Skripte, DB-Schemata,
Konfigurationen). Merke: **bei einem großen Push zuerst scannen, das Ergebnis lesen, dann
in einem zweiten Schritt pushen.**

## Ein gelöschter Commit ist nicht weg

Über `main` waren Spielerdaten entfernt, aber wer die alte Commit-ID `e1b5ba2…` kannte,
bekam sie von GitHub weiter geliefert, bis deren Aufräumlauf sie einsammelte. Damals wurde
gegen ein Support-Ticket entschieden: die ID stand nirgends öffentlich, und es waren
Spielernamen mit Truppenstärken — kein Passwort, keine Klarnamen. Bei einem echten
Geheimnis wäre die Entscheidung anders.

## Der Vision-Server hat keine Anmeldung

Der Login der App schützt ihn nicht — er sitzt im Browser-Code, der Tailscale-Funnel ist
ein eigener Endpunkt daneben. Wer den Hostnamen kennt, kann `POST /analyze-ws` direkt
schicken und fremde Bilder durch das lokale Ollama jagen. Abschalten notfalls mit
`tailscale funnel --https=10000 off`. Details in `vision-server-ports.md`.

Auch die Datenbank steht über den Funnel `…:8443/rest/v1/` erreichbar; die
Rechteprüfungen (`canAccess(...)`) sitzen im Client, die Tabellen selbst stehen offen.
Das ist bekannt und akzeptiert — aber es heißt: **kein Geheimnis in eine Tabelle legen.**

## Zugangsdaten holt man sich selbst

Der „Tresor" ist der Secrets-Tresor des `local-ai`-Projekts, kein Passwortmanager:

```bash
cd "/Users/ben/Projects/Mac Studio/local-ai"
.venv/bin/python -m local_ai.vault_cli list          # Namen + Metadaten
.venv/bin/python -m local_ai.vault_cli get <name>    # entschlüsselte Felder als JSON
```

`vault_cli` ist laut eigenem Docstring ausdrücklich der **unbeaufsichtigte Lesepfad für
Server und Claude Code** — kein 2FA, das 2FA-Gate sitzt nur im Router für die menschliche
UI. Jeder Zugriff landet mit `actor='automation'` im `vault_access_log`. Es braucht also
keine Rückfrage, um ein Secret zu lesen.

**Aufbau:** Chiffretext (Fernet) in Postgres `vault_secrets.fields_enc`, Master-Key in der
macOS Keychain (`service=local-ai-vault`, `account=master-key`), Fallback
`LOCAL_AI_VAULT_KEY`. Fehlt der Key, ist der Tresor gesperrt (`VaultLocked`).

**Zwei Stolpersteine:** der Aufruf braucht `dangerouslyDisableSandbox: true` (sonst kein
Keychain-Zugriff), und es muss das Projekt-`.venv` sein, nicht das globale `python3`.

**Passwörter nie ins Protokoll schreiben.** Für Web-Logins ein kleines Skript schreiben,
das den Wert direkt aus dem Tresor in den CDP-`Runtime.evaluate` steckt, und nur den Status
ausgeben (URL, Titel, `meta[name=user-login]`). Der Debug-Chrome hängt auf Port 9222,
Profil `~/.claude-chrome-profile`; ein neuer Tab über `PUT /json/new` startet auf
`about:blank` und muss per `Page.navigate` angesteuert werden.

**Relevante Einträge:**

| Eintrag | was |
|---|---|
| `Github` (`user`, `password`) | Browser-Login für `Ben-claude-1`. `gh` ist **nicht** angemeldet, es liegt kein Token im Tresor — schreibende GitHub-Aktionen laufen über den Browser-Login. |
| `Last war developer` | der LW-Atlas-Schlüssel (zusätzlich in `~/.config/warsync/lwatlas.env`, Rechte 600) |

## Schlüssel außerhalb des Repos

`~/.config/warsync/lwatlas.env` — der LW-Atlas-Schlüssel ist **nicht wiederherstellbar**,
die Website zeigt nur eine gekürzte Vorschau. Verliert man ihn, ist der Zugang weg.

## Passwörter der Spieler

Als Hash gespeichert (`password_hash` in `ws_players`), nicht zurücklesbar. Der
Super-Admin kann ein Passwort neu setzen, aber kein bestehendes lesen. Wer ein neues Recht
bekommt (etwa `alliance_admin`), behält sein bisheriges Passwort — das muss ihm jemand
sagen.

## Sessions

- `docs/sessions/2026-09-13-cda9d784.md` — der Passwortleak und seine zwei Ursachen
- `docs/sessions/2026-09-02-5b960667.md` — Entscheidung gegen das GitHub-Ticket
- `docs/sessions/2026-08-25-1a86077f.md` — binabean bekam ein Recht, kein Passwort
