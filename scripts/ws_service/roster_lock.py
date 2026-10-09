"""Erzwingt den Kader-Lock, ohne dass jemand die Seite im Browser öffnet.

Der Donnerstag-04:00-Schnitt (`wsRosterCheck()` in src/core/auth.js) läuft rein
im Browser, ausgelöst beim Login/Laden der Seite. Die Geräte-Automatisierung
(dieses Paket) schreibt direkt gegen die Datenbank und lädt die Webseite nie —
blieb in einer Woche jeder Browser-Besuch aus, blieb auch der Lock aus, keine
Teilnahme-Zeilen entstanden, und die Rotations-Fairness (`ws_priority.c_total`)
driftete lautlos auseinander (siehe Vorfall ΧΑΣΑΠΗΣ, Woche 02.10.2026).

Die Logik selbst (wer fest, wer Rotation, wer Warteliste) steht nur in
src/core/rotation.js / ui/ws.js — sie hier in Python nachzubauen hieße zwei
Fassungen derselben Fairness-Regel, die garantiert auseinanderlaufen (siehe
CLAUDE.md: "Ein Symbol gehört genau einem Modul"). Deshalb fährt dieses Skript
stattdessen einen echten (headless) Browser gegen die Live-Seite und meldet
sich mit einem eigenen Dienst-Account an (`WSRoutineBot`, ws_players, XP33,
Rolle R5, `active=false` — taucht dadurch in keiner Kader-/Rotationsliste auf).

Das Passwort steht im Secrets-Tresor (`warsync_ws_routine_bot`) im
local-ai-Projekt, nicht hier im Code. Der Tresor-Zugriff braucht asyncpg und
die local-ai-Umgebung — die hat nur das dortige .venv, nicht dieses Projekt
hier. Deshalb holt `vault_zugang.py` (eigener Prozess, local-ai-.venv) die
Zugangsdaten und reicht sie über Umgebungsvariablen weiter; dieses Skript
selbst braucht nur `playwright`.

Nutzung (normalerweise über scripts/ws_service/roster_lock.sh, das beide
Schritte verbindet):
    WSBOT_USER=... WSBOT_PW=... .venv/bin/python -m scripts.ws_service.roster_lock
    WSBOT_USER=... WSBOT_PW=... .venv/bin/python -m scripts.ws_service.roster_lock --pruefen

Loggt nach ~/.local/state/warsync/ws_service/roster_lock/<zeit>.log.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import os
from pathlib import Path

APP_URL = "https://ben-claude-1.github.io/warsync-stats/"
STATE_DIR = Path.home() / ".local/state/warsync/ws_service/roster_lock"


async def _lauf(pruefen: bool) -> int:
    from playwright.async_api import async_playwright

    name = os.environ.get("WSBOT_USER")
    pw = os.environ.get("WSBOT_PW")
    if not name or not pw:
        print("WSBOT_USER/WSBOT_PW fehlen (siehe roster_lock.sh)")
        return 2

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    stempel = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    log_pfad = STATE_DIR / f"{stempel}.log"
    zeilen: list[str] = [f"Start {dt.datetime.now().isoformat()}"]

    async with async_playwright() as pw_ctx:
        # Ohne das blockiert Chrome den Fetch zur Tailscale-Adresse (Private
        # Network Access): "Permission was denied for this request to access
        # the `local` address space" — eine öffentliche GitHub-Pages-Origin,
        # die auf eine 100.x.x.x-Adresse zugreift, gilt Chrome als Zugriff auf
        # ein privates Netz. Betrifft nur diesen isolierten Bot-Kontext, der
        # ausschließlich die eine Seite besucht.
        browser = await pw_ctx.chromium.launch(
            headless=True,
            args=["--disable-web-security", "--disable-site-isolation-trials"],
        )
        page = await browser.new_page()
        try:
            await page.goto(APP_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.fill("#lu", name)
            await page.fill("#lp", pw)
            await page.click("#login-btn")
            # Erfolg heißt: die Login-Maske (#lu) verschwindet, weil renderShell()
            # den App-Rahmen einsetzt. #login-err existiert von Anfang an und
            # steht per CSS auf "display:none" — "hidden" wäre also auch beim
            # allerersten Render schon wahr und kein Beleg für irgendetwas.
            await page.wait_for_selector("#lu", state="detached", timeout=15_000)
            fehler = await page.locator("#login-err").is_visible()
            if fehler:
                raise RuntimeError('Login fehlgeschlagen: ' + await page.locator("#login-err").inner_text())
            # loadData() läuft parallel; wsRosterCheck() wird darin ungewartet
            # angestoßen (fire-and-forget) — ohne feste Wartezeit wüsste das
            # Skript nicht, ob der Lock schon durch ist, bevor der Browser zu ist.
            if not pruefen:
                await page.wait_for_timeout(15_000)
            zeilen.append("Login + Ladevorgang abgeschlossen" + (" (nur geprüft)" if pruefen else ""))
        except Exception as exc:  # noqa: BLE001 — Lauf soll trotzdem sein Log schreiben
            zeilen.append(f"Fehler: {exc}")
            log_pfad.write_text("\n".join(zeilen), encoding="utf-8")
            await browser.close()
            return 1
        await browser.close()

    log_pfad.write_text("\n".join(zeilen), encoding="utf-8")
    print(f"ok — {log_pfad}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pruefen", action="store_true", help="nur anmelden, nicht auf den Lock warten")
    args = ap.parse_args()
    return asyncio.run(_lauf(args.pruefen))


if __name__ == "__main__":
    raise SystemExit(main())
