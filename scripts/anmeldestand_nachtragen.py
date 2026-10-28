#!/usr/bin/env python3
"""Anmeldehistorie nachtragen — AC/BC/ABC für die Wochen vor dem Kader-Lock.

`ws_anmeldestand` wird beim Kader-Lock geschrieben (src/ui/ws.js) und war am
16.10.2026 leer: für jede Woche davor gab es die Tabelle noch nicht, und der
Lock dieser Woche lief nicht. In der Anmeldehistorie stand damit kein einziges
`AC`/`BC` — sichtbar war nur, was sich aus ws_participation rekonstruieren
lässt (A/AE/B/BE). Ausgerechnet die Ausschlüsse, an denen die Rotation hängt,
fehlten ganz.

**Zwei Belege liegen dafür auf der Platte**, und beide legt der Dienst ohnehin
ab:

  * `suche_*/bericht.json` — ein Suchlauf schlägt JEDEN Kadernamen einzeln im
    Suchfeld nach. Er sagt deshalb nicht nur, wer wie stand, sondern auch, wer
    **nicht angemeldet** war (`nicht_angemeldet`) — die einzige Quelle mit
    dieser negativen Auskunft. Es gibt ihn erst ab dem 25.09.2026.
  * `sicherungen/ws_planner_*.json` — der Planungsstand, den der Dienst vor
    jedem Schreiben sichert. `teamAssign` darin trägt die vollen Werte; wer
    dort fehlt, war zu diesem Zeitpunkt nicht angemeldet.

**Welcher Beleg zu welcher Woche gehört, entscheidet sein Zeitpunkt**: der
nächste Freitag ab der Aufnahme (ein Beleg von Freitag früh gehört noch zu
diesem Freitag) — dieselbe Rechnung wie bei `ws_anmeldebeleg.event_date`.

**Gewählt wird je Woche der Beleg mit der vollständigsten Einteilung**, nicht
der letzte. Der Grund steht in den Daten: der Suchlauf vom 29.09. kennt 74
Namen und *keine* Einteilung (die Allianz war im Spiel noch nicht aufgestellt,
alle lesen als `AC`/`BC`), der vom 01.10. kennt 70 Namen und die volle
Aufstellung, gegengeprüft an den Zählern im Spiel (20/20 + 10/10). Nach „der
letzte gewinnt" wäre das richtig, nach „die meisten Namen gewinnen" falsch —
deshalb zählt erst die Zahl der **Plätze**, dann die der Namen, dann die Zeit.

**Der fixierte Kader schlägt den Beleg.** `ws_participation` ist für eine
Woche mit `roster_locked_at` der Schlussstand: wer dort eine Zeile hat, hatte
einen Platz. Wer im Beleg angemeldet ist und dort keine Zeile hat, hatte
keinen — sein Wert wird deshalb auf die C-Form gebracht (`A`→`AC`). Ohne diese
Umrechnung stünde die halbe Allianz mit dem Platz da, den sie am Mittwoch noch
hatte. Umgekehrt bleibt ein Platz aus dem Beleg stehen, solange die Woche
**nicht** fixiert ist (02.10. und 16.10.) — dort gibt es keinen Schlussstand,
der ihn widerlegen könnte.

**Geschrieben wird mit `quelle='nachtrag'` und `stand_um`** (Migration
db/2026-10-16_ws_anmeldestand_nachtrag.sql). Ein Nachtrag ist ein Stand zu
einem Zeitpunkt, nicht der Stand zum Anmeldeschluss — beim 02.10. liegen drei
Stunden dazwischen, beim 18.09. anderthalb Tage. Die Oberfläche zeigt ihn
deshalb gepunktet und nennt den Zeitpunkt. Eine Zeile vom Kader-Lock
(`quelle='lock'`) wird **nie** überschrieben.

    python3 scripts/anmeldestand_nachtragen.py                 # nur Bericht
    python3 scripts/anmeldestand_nachtragen.py --schreiben
"""

import argparse
import difflib
import glob
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ZEITZONE = ZoneInfo('Europe/Berlin')
STATE = os.path.expanduser('~/.local/state/warsync/ws_service')
CONTAINER = 'supabase-db'

PLATZ_WERTE = ('A', 'AE', 'B', 'BE')
C_FORM = {'A': 'AC', 'AE': 'AC', 'B': 'BC', 'BE': 'BC'}
ERLAUBT = ('A', 'AE', 'B', 'BE', 'AC', 'BC', 'ABC', 'C')


def psql(sql):
    """Eine Abfrage, Zeilen als Listen. `-i` ist Pflicht, sonst kommt das SQL nie an."""
    out = subprocess.run(
        ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-t', '-A', '-F', '\x1f', '-c', sql],
        capture_output=True, text=True, check=True).stdout
    return [z.split('\x1f') for z in out.splitlines() if z.strip()]


def naechster_freitag(dt):
    """Der Freitag, zu dem ein Beleg gehört — der Tag selbst, wenn es ein Freitag ist."""
    tage = (4 - dt.weekday()) % 7          # 4 = Freitag
    return (dt.date() + timedelta(days=tage)).isoformat()


# ── Die Belege einsammeln ───────────────────────────────────────────────────

def _lokal(iso):
    """ISO-Zeitstempel auf lokale Zeit bringen. Der Planungsstand trägt sein
    `savedAt` in UTC (`…Z`), der Scan-Bericht seinen Zeitpunkt ohne Zone —
    beide Sorten müssen vergleichbar sein, sonst landet ein Beleg in der
    falschen Woche."""
    if not iso:
        return None
    s = iso.replace('Z', '+00:00')
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZEITZONE)
    return dt.astimezone(ZEITZONE)


def belege_sammeln(aid):
    quellen = []
    # Der **lebende** Planungsstand zählt mit. Für die laufende Woche gibt es
    # noch keine Sicherung mit ihr darin — der Dienst sichert, was er
    # überschreibt, und das ist jeweils der Stand der Vorwoche. Für den
    # 16.10.2026 steht die Einteilung deshalb nur hier: 20 + 10 je Team und
    # fünf ohne Platz, geschrieben am 14.10. um 22:17.
    for savedAt, ta in psql(f"""
          select coalesce(data->>'savedAt', updated_at::text), coalesce(data->'teamAssign', '{{}}'::jsonb)
          from ws_planner_state where alliance_id = '{aid}' and key = 'ws';"""):
        werte = {k: v for k, v in json.loads(ta).items() if v in ERLAUBT}
        zeit = _lokal(savedAt.replace(' ', 'T'))
        if werte and zeit:
            quellen.append({'art': 'planungsstand*', 'datei': 'ws_planner_state',
                            'zeit': zeit, 'werte': werte, 'nicht': []})
    for pfad in sorted(glob.glob(os.path.join(STATE, 'sicherungen', 'ws_planner_*.json'))):
        try:
            d = json.load(open(pfad))
        except (ValueError, OSError):
            continue
        ta = {k: v for k, v in (d.get('teamAssign') or {}).items() if v in ERLAUBT}
        zeit = _lokal(d.get('savedAt'))
        if not ta or not zeit:
            continue
        quellen.append({'art': 'planungsstand', 'datei': os.path.basename(pfad),
                        'zeit': zeit, 'werte': ta, 'nicht': []})
    for pfad in sorted(glob.glob(os.path.join(STATE, 'suche_*', 'bericht.json'))
                       + glob.glob(os.path.join(STATE, 'anmeldung_*', 'bericht.json'))):
        try:
            b = json.load(open(pfad))
        except (ValueError, OSError):
            continue
        werte = {k: v for k, v in (b.get('zuordnung') or {}).items() if v in ERLAUBT}
        zeit = _lokal(b.get('zeitpunkt'))
        if not werte or not zeit:
            continue
        quellen.append({'art': b.get('art') or 'suchlauf',
                        'datei': os.path.basename(os.path.dirname(pfad)),
                        'zeit': zeit, 'werte': werte,
                        'nicht': list(b.get('nicht_angemeldet') or [])})
    return quellen


def bester(quellen, schluss, kader_fix):
    """Welcher Beleg für die Woche gilt — in dieser Reihenfolge:

    1. **vor dem Anmeldeschluss.** Danach fehlen in der Liste die Zeit-Balken,
       und ohne sie ist „angemeldet, kein Platz" von „nie gemeldet" nicht zu
       unterscheiden (siehe ws-dienst-anmeldung.md).
    2. **die vollständigere Einteilung** — aber nur, wenn die Woche *nicht*
       fixiert ist. Ist sie fixiert, liefert `ws_participation` die Plätze
       ohnehin, und dann zählt am Beleg allein, wen er überhaupt gesehen hat.
       Ohne diese Unterscheidung gewann für den 25.09. ein Suchlauf mit fünf
       Namen gegen eine Sicherung mit 71.
    3. **die meisten Namen**, dann der jüngste.
    """
    def rang(q):
        plaetze = sum(1 for v in q['werte'].values() if v in PLATZ_WERTE)
        return (q['zeit'] <= schluss, 0 if kader_fix else plaetze, len(q['werte']), q['zeit'])
    return max(quellen, key=rang)


# ── Namen, die es im Kader nicht mehr gibt ──────────────────────────────────
# Ein Beleg trägt den Namen, der zu seiner Zeit galt: in der Sicherung vom
# 02.09. steht `IIBlackJackII`, im Kader heißt er heute `lIBlackJackll`. Als
# eigene Zeile geschrieben wäre das ein zweiter Spieler mit halber Historie —
# dieselbe Falle wie bei `apdRename`, nur rückwärts.
#
# Verglichen wird auf dem **lateinischen Kern** (wie in ergebnis.py): ohne
# Diakritika, ohne Sonderzeichen, Zwillinge `l`/`1`/`|` auf `i`. `H一A一N一A一Nツ`
# wird damit zu `hanan` und trifft `H A N A N`, `lemon小木瓜` zu `lemon` und
# trifft `小木瓜lemon`. Wer darunter bleibt, wird **gemeldet statt geraten** —
# ein falsch zusammengelegter Name schreibt die Historie eines Fremden.
ZWILLINGE = str.maketrans({'l': 'i', '1': 'i', '|': 'i', '0': 'o'})

# Umbenennungen, die der Kern nicht trägt. `Pastejen` kommt auf 0,77 gegen
# `Pastª` — unter der Schwelle, und die Schwelle dafür zu senken hieße, auch
# fremde Namen zusammenzulegen. Der Beleg steht stattdessen hier: über alle
# Belege hinweg tauchen die beiden **nie gemeinsam** auf (`Pastejen` bis zum
# 16.09., `Pastª` ab dem 24.09.), immer in Team B und auf demselben Platz.
# Dasselbe Muster wie bei `ASTRID 1ッド`, nur ohne gemeinsame Zeichen.
UMBENANNT = {'Pastejen': 'Pastª'}


def kern(s):
    roh = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', roh.lower()).translate(ZWILLINGE)


def namensloeser(roster, aliase):
    kerne = {}
    for name in roster:
        k = kern(name)
        if k:
            kerne.setdefault(k, []).append(name)

    def loesen(name):
        if name in roster:
            return name, None
        if UMBENANNT.get(name) in roster:
            return UMBENANNT[name], 'umbenannt'
        for kadername, lesarten in aliase.items():
            if kadername.startswith('_') or not isinstance(lesarten, list):
                continue
            # Nur wenn der Kadername noch existiert: `skyluna` steht in
            # aliase.json als Lesart von `senasinasona`, inzwischen heißt der
            # Spieler aber selbst so.
            if name in lesarten and kadername in roster:
                return kadername, 'aliase.json'
        k = kern(name)
        if not k:
            return None, None
        if k in kerne and len(kerne[k]) == 1:
            return kerne[k][0], 'Kern'
        treffer = sorted(((difflib.SequenceMatcher(None, k, kk).ratio(), kk) for kk in kerne),
                         reverse=True)
        if treffer and treffer[0][0] >= 0.80 and len(kerne[treffer[0][1]]) == 1 \
                and (len(treffer) == 1 or treffer[0][0] - treffer[1][0] >= 0.05):
            return kerne[treffer[0][1]][0], f'Ähnlichkeit {treffer[0][0]:.2f}'
        return None, None
    return loesen


# ── Der Stand der Woche ─────────────────────────────────────────────────────

def kader_lesen(aid):
    """Je Woche: der fixierte Kader und ob die Woche überhaupt fixiert ist."""
    # Die Wahrheitswerte kommen als 'true'/'false' — `boolean::text` ist nicht
    # das 't'/'f' der psql-Anzeige. Mit dem Vergleich auf 't' galt keine Woche
    # als fixiert und jede Ersatzbank als Startaufstellung.
    zeilen = psql(f"""
      select e.event_date::text, e.team, (e.roster_locked_at is not null)::text,
             p.player_name, p.substitute::text
      from ws_events e join ws_participation p on p.event_id = e.id
      where e.alliance_id = '{aid}' and e.mode = 'ws';""")
    kader, fixiert = {}, {}
    for datum, team, locked, name, sub in zeilen:
        kader.setdefault(datum, {})[name] = team + ('E' if sub == 'true' else '')
        if locked == 'true':
            fixiert.setdefault(datum, set()).add(team)
    return kader, fixiert


def stand_bauen(quelle, kader, fixierte_teams):
    """Ein Wert je Spieler für diese Woche, plus die Begründung je Umrechnung."""
    stand, umgerechnet = {}, []
    for name, wert in kader.items():          # der fixierte Kader schlägt den Beleg
        stand[name] = wert
    for name, wert in quelle['werte'].items():
        if name in kader:
            continue
        team = 'A' if wert in ('A', 'AE') else 'B' if wert in ('B', 'BE') else None
        if team and team in fixierte_teams:
            # Angemeldet, im fixierten Kader seines Teams aber nicht dabei:
            # das ist genau „angemeldet, kein Platz".
            stand[name] = C_FORM[wert]
            umgerechnet.append((name, wert, C_FORM[wert]))
        else:
            stand[name] = wert
    return stand, umgerechnet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--allianz', default='XP33')
    ap.add_argument('--schreiben', action='store_true')
    args = ap.parse_args()

    treffer = psql(f"select id from alliances where tag = '{args.allianz}';")
    if not treffer:
        sys.exit(f'Allianz {args.allianz} nicht gefunden.')
    aid = treffer[0][0]

    roster = {z[0] for z in psql(f"select name from ws_players where alliance_id = '{aid}';")}
    with open(os.path.join(os.path.dirname(__file__), 'ws_service', 'aliase.json')) as f:
        aliase = json.load(f)
    loesen = namensloeser(roster, aliase)
    vorhanden = {(z[0], z[1]): z[2] for z in psql(
        f"select event_date::text, player_name, quelle from ws_anmeldestand"
        f" where alliance_id = '{aid}' and mode = 'ws';")}
    kader, fixiert = kader_lesen(aid)

    nach_woche = {}
    for q in belege_sammeln(aid):
        nach_woche.setdefault(naechster_freitag(q['zeit']), []).append(q)

    wochen = sorted(set(nach_woche) | set(kader))
    zeilen, fremde, gelöst = [], set(), {}
    print(f'Allianz {args.allianz} · {len(wochen)} Wochen\n')
    for woche in wochen:
        quellen = nach_woche.get(woche, [])
        k = kader.get(woche, {})
        teams_fix = fixiert.get(woche, set())
        schluss = datetime.fromisoformat(woche + 'T04:00').replace(tzinfo=ZEITZONE) - timedelta(days=1)
        if not quellen:
            print(f'{woche}  kein Beleg — nur Kader ({len(k)} Zeilen), '
                  f'{"fixiert" if teams_fix else "nicht fixiert"}')
            continue
        q = bester(quellen, schluss, len(teams_fix) == 2)
        # Die Namen des Belegs auf den heutigen Kader bringen, bevor etwas
        # zusammengeführt wird — sonst steht derselbe Mensch zweimal da.
        werte = {}
        for name, wert in q['werte'].items():
            ziel, wie = loesen(name)
            if ziel is None:
                fremde.add(name)
                continue
            if wie:
                gelöst[name] = (ziel, wie)
            werte[ziel] = wert
        stand, umgerechnet = stand_bauen({**q, 'werte': werte}, k, teams_fix)
        c_werte = sorted(n for n, w in stand.items() if w not in PLATZ_WERTE)
        vor = (schluss - q['zeit']).total_seconds() / 3600
        print(f'{woche}  {q["art"]:15s} {q["zeit"]:%d.%m. %H:%M}  '
              f'({vor:+.1f} h zum Schluss{"" if vor >= 0 else " — DANACH, ohne Zeit-Balken"})  '
              f'{len(stand)} Spieler · {len(c_werte)} ohne Platz · '
              f'Kader {len(k)}{"" if len(teams_fix) == 2 else " (nicht fixiert)"} · '
              f'{len(quellen)} Belege zur Wahl')
        if umgerechnet:
            print(f'            {len(umgerechnet)}× Platz→C (angemeldet, aber nicht im fixierten Kader): '
                  + ', '.join(f'{n} {a}→{b}' for n, a, b in umgerechnet[:6])
                  + (' …' if len(umgerechnet) > 6 else ''))
        if c_werte:
            print('            ohne Platz: ' + ', '.join(c_werte[:12]) + (' …' if len(c_werte) > 12 else ''))
        # **Geschrieben wird nur, was ws_participation nicht sagen kann.** Für
        # eine fixierte Woche ist der Kader der Schlussstand, und die
        # Oberfläche liest ihn ohnehin von dort (anmWert → 'teilnahme'); ihn
        # hier als Nachtrag zu wiederholen hieße, hartes Wissen mit dem
        # Unsicherheits-Zeichen eines Nachtrags zu versehen. Fehlt die Fixierung
        # (02.10. und 16.10.), ist es umgekehrt: dort stehen in
        # ws_participation nur die, die gespielt haben — beim 02.10. sogar alle
        # mit `substitute=false`, weil die Zeilen aus der Ergebnis-Mail
        # stammen. Dann gilt der Beleg, auch für die Plätze.
        nur_c = len(teams_fix) == 2
        for name, wert in sorted(stand.items()):
            if nur_c and wert in PLATZ_WERTE:
                continue
            if vorhanden.get((woche, name)) == 'lock':
                continue                      # der Schlussstand wird nie überschrieben
            zeilen.append((name, woche, wert, q['zeit']))

    print(f'\n{len(zeilen)} Zeilen zum Nachtragen.')
    if gelöst:
        print('Auf den heutigen Kadernamen gebracht: '
              + ' · '.join(f'{a} → {b} ({wie})' for a, (b, wie) in sorted(gelöst.items())))
    if fremde:
        print('NICHT zugeordnet und deshalb nicht geschrieben: ' + ', '.join(sorted(fremde)))
    if not args.schreiben:
        print('\nOhne --schreiben passiert nichts.')
        return

    def lit(s):
        return "'" + str(s).replace("'", "''") + "'"
    werte = ',\n'.join(
        f"({lit(aid)},{lit(n)},'ws',{lit(w)},{lit(v)},'nachtrag',{lit(z.isoformat())})"
        for n, w, v, z in zeilen)
    sql = f"""begin;
insert into ws_anmeldestand (alliance_id, player_name, mode, event_date, wert, quelle, stand_um)
values
{werte}
on conflict (alliance_id, player_name, mode, event_date) do update
  set wert = excluded.wert, quelle = excluded.quelle, stand_um = excluded.stand_um
  where ws_anmeldestand.quelle = 'nachtrag';
commit;"""
    p = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres'],
                       input=sql, capture_output=True, text=True)
    print(p.stdout.strip() or p.stderr.strip())
    if p.returncode:
        sys.exit(p.returncode)


if __name__ == '__main__':
    main()
