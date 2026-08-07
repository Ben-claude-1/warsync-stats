-- 2026-08-07 — Wüstensturm: Events eindeutig machen + Kader-Fixierung vorbereiten
--
-- Hintergrund: ensureWeeklyEvents() prüft nur im lokal geladenen APP.data.events,
-- ob der kommende Freitag schon existiert. Öffnen mehrere Geräte die Seite
-- gleichzeitig, legt jedes ein Event-Paar an — am 31.07. sind so 7 Zeilen je Team
-- entstanden. Ohne eindeutigen Schlüssel weiß der Donnerstags-Schnitt nicht,
-- an welche Zeile er die angemeldeten Spieler hängen soll.
--
-- Vor dem Lauf gesichert: .tmp/dbsnap/ws_events_participation_*.sql (data-only)

BEGIN;

-- 1) Dubletten zusammenführen: pro (event_date, team) bleibt die Zeile mit den
--    meisten Teilnahme-Einträgen, bei Gleichstand die älteste.
--    Teilnahmen der Verlierer-Zeilen wandern mit, sofern der Spieler beim
--    Gewinner noch nicht steht (ON CONFLICT greift erst ab Schritt 3, deshalb
--    hier explizit per NOT EXISTS).
CREATE TEMP TABLE _keep AS
SELECT DISTINCT ON (event_date, team) id, event_date, team
FROM public.ws_events e
ORDER BY event_date, team,
         (SELECT count(*) FROM public.ws_participation p WHERE p.event_id = e.id) DESC,
         created_at ASC, id ASC;

CREATE TEMP TABLE _drop AS
SELECT e.id, k.id AS keep_id
FROM public.ws_events e
JOIN _keep k ON k.event_date = e.event_date AND k.team = e.team
WHERE e.id <> k.id;

UPDATE public.ws_participation p
SET event_id = d.keep_id
FROM _drop d
WHERE p.event_id = d.id
  AND NOT EXISTS (
    SELECT 1 FROM public.ws_participation q
    WHERE q.event_id = d.keep_id AND q.player_name = p.player_name
  );

-- Was jetzt noch an den Verlierer-Zeilen hängt, ist eine echte Doppelerfassung
-- desselben Spielers für dasselbe Match (15.05. Team B) — die fällt per CASCADE.
DELETE FROM public.ws_events e USING _drop d WHERE e.id = d.id;

-- 2) Doppelte Teilnahme-Zeilen je Event/Spieler gibt es aktuell nicht (geprüft),
--    der Index sichert das für die Zukunft ab — der Donnerstags-Schnitt schreibt
--    idempotent per ON CONFLICT DO NOTHING dagegen.
CREATE UNIQUE INDEX IF NOT EXISTS ws_participation_event_player_uidx
  ON public.ws_participation (event_id, player_name);

-- 3) Ein Event je Datum und Team.
CREATE UNIQUE INDEX IF NOT EXISTS ws_events_date_team_uidx
  ON public.ws_events (event_date, team);

-- 4) Zeitpunkt des Anmeldeschlusses. Solange NULL, ist der Kader nicht fixiert;
--    gesetzt heißt: die angemeldeten Spieler stehen als ws_participation-Zeilen
--    in der DB und sind für dieses Event fix. Dient zugleich als Sperre gegen
--    mehrfaches Ausführen, wenn mehrere Geräte gleichzeitig laden.
ALTER TABLE public.ws_events
  ADD COLUMN IF NOT EXISTS roster_locked_at timestamptz;

COMMIT;
