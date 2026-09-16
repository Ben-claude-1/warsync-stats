# Themen — eine Datei je Thema

> **Wird ein Thema genannt, zuerst hier die passende Datei lesen.** Sie bündelt, was über
> alle Sessions hinweg dazu gelernt wurde: die Regeln, die Messungen dahinter, die
> widerlegten Annahmen und die Sessions zum Nachlesen.
>
> Reicht das nicht: per Grep in [`../../SESSIONS.md`](../../SESSIONS.md) nach dem Stichwort
> suchen und den verlinkten Digest unter [`../sessions/`](../sessions/) öffnen.
>
> Gebaut aus 70 Sessions (05.05.2026 – 16.09.2026).

## Die App

| Thema | Datei | Stichwörter |
|---|---|---|
| Wüstensturm | [`wuestensturm.md`](wuestensturm.md) | Desert Storm, Aufstellung, Gebäude, Silo, Assassinen, Anmeldeschluss, fixierter Kader, Slot-Folge, `autoAssign` |
| Schluchtsturm | [`schluchtsturm.md`](schluchtsturm.md) | Canyon Storm, `csAutoAssign`, Energieturm, Datenzentren, Probenlager, Fraktion, Morgenbringer, Ordnungshüter, Spawnzone, Varianten, Fahrplan |
| Anmeldung, Rotation, Ersatz | [`anmeldung-rotation-ersatz.md`](anmeldung-rotation-ersatz.md) | Anmeldeliste, A/AE/B/BE/C, Prioliste, Einsatz-Bilanz, Leistungsindex, Handmarke ⭐, Marken-Raster |
| Zuteilung „wer schaut zu" | [`zuteilung-wer-schaut-zu.md`](zuteilung-wer-schaut-zu.md) | Reiter Verteilung, `AC`/`BC`, Ersatz-Wunsch, Ausschluss-Regeln, Schrittliste |
| VS-Duell | [`vs-duell.md`](vs-duell.md) | Gegnerwahl, Wochenplan, Wettrüsten, Enemy Buster, 7,2 Mio |
| Mehrere Allianzen und Rollen | [`mehrere-allianzen-rollen.md`](mehrere-allianzen-rollen.md) | Mandantentrennung, `alliance_id`, `TENANT_TABLES`, `api.js`, super_admin, alliance_admin, AR1S, XP33 |
| Planungsstand und Anwesenheit | [`planungsstand-anwesenheit.md`](planungsstand-anwesenheit.md) | `ws_planner_state`, `plannerPush`, `savedAt`, `ws_presence`, device_id |
| Spielerdaten | [`spielerdaten.md`](spielerdaten.md) | Stärke-Verlauf, T1-Typ, Heldenkraft, Avatare, Umbenennen, Importe, Diagramme |
| Kleinere Bereiche | [`kleinere-features.md`](kleinere-features.md) | Hive, Zugfahrt, Allianz-Mail, 500 Zeichen, Discord |

## Technik und Betrieb

| Thema | Datei | Stichwörter |
|---|---|---|
| Frontend, Build, Deploy | [`frontend-build-deploy.md`](frontend-build-deploy.md) | Module, esbuild, `dist/main.js`, Cache-Stempel, `globals.js`, Tests, Pre-Push-Hook, GitHub Pages |
| Sprachen DE/EN | [`i18n-de-en.md`](i18n-de-en.md) | `I18N_EN`, `I18N_EN_RE`, `trs`, `trEN`, `LOC`, Anzeigeschicht, Canvas |
| PNG-Export und Kartenbilder | [`png-export-karten.md`](png-export-karten.md) | Canvas, Schildgröße, Team-Schild, Kartenbild, JPEG |
| Datenbank und Backup | [`datenbank-backup.md`](datenbank-backup.md) | Postgres, `supabase-db`, PostgREST, `NOTIFY pgrst`, Migrationen, Backup, Restore |
| Vision-Server und Ports | [`vision-server-ports.md`](vision-server-ports.md) | OCR-Dienst, Port 8445, Tailscale Funnel, `PORTS.md` |
| Sicherheit und Zugangsdaten | [`sicherheit-secrets.md`](sicherheit-secrets.md) | Passwortleak, Tresor, `vault_cli`, offene Endpunkte |
| Arbeitsweise | [`arbeitsweise-sessions.md`](arbeitsweise-sessions.md) | Terminal, parallele Sessions, Journal, Handoff, `prune_sessions.py` |

## Spiel auslesen (BlueStacks, OCR, Karte)

| Thema | Datei | Stichwörter |
|---|---|---|
| BlueStacks-Steuerung | [`bluestacks-steuerung.md`](bluestacks-steuerung.md) | Emulator, 2560×2560, ADB, Gesten, **Scroll-Hänger**, Touch-Mitschnitt, Bild ins Spiel |
| Dienst: Anmeldung lesen | [`ws-dienst-anmeldung.md`](ws-dienst-anmeldung.md) | `ws_service`, `roster.py`, Team-Abzeichen, Gegenprobe, `mitschreiben.py` |
| Dienst: Kampfergebnis lesen | [`ws-dienst-ergebnis.md`](ws-dienst-ergebnis.md) | `ergebnis.py`, Rangliste, MVP-Block, Aussetzen, `--offen`, `--alias` |
| Texterkennung | [`texterkennung-ocr.md`](texterkennung-ocr.md) | macOS Vision, Tesseract, deepseek-ocr, Sprachen, Zwillinge, `aliase.json` |
| Kartenarchiv / Vollscan | [`kartenarchiv-vollscan.md`](kartenarchiv-vollscan.md) | Weltkarte, Kacheln, Sweep, Y-Modell, Merkpunkt, Stillstands-Wächter |
| Basen-Erkennung | [`basen-erkennung.md`](basen-erkennung.md) | `karte_basen`, Bannerfinder, Namen, Stufe, Allianz-Kürzel, Beschriftungen |
| LW Atlas | [`lw-atlas.md`](lw-atlas.md) | API, Kontingent, `lwa_spieler`, `player_uid`, Kills vs. Kraft |
| Kampfanalyse | [`kampfanalyse.md`](kampfanalyse.md) | `combat_reports`, Moral, Lanchester, Truppentyp-Konter, Codename-Bosse |

## Zwei Haltungen, die überall gelten

**Eine Prüfung, die den Fall nicht enthält, ist grün und wertlos.** Belegt an den blauen
Namen auf der Karte, an Bens gelbgrüner Basis, am Team-Schild im PNG-Export und am Namen
in der Anmeldezeile — jedes Mal war die Suite grün und Ben hat den Fehler gesehen.

**Lieber eine Lücke als ein plausibel aussehender falscher Wert.** `NULL` heißt „nicht
gelesen", nicht „Stufe 0". Ein unsicherer Name wird gemeldet, nicht geraten. Eine halb
gelesene Liste wird nicht geschrieben.
