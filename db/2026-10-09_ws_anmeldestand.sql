-- ══════════════════════════════════════════════════════════════════════════════
--  Anmeldestand: Snapshot des vollen Anmeldewerts je Spieler und Woche
--  09.10.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ws_participation kennt nur die 30 Spieler je Team, die einen Platz bekommen
-- haben (A/AE bzw. B/BE) — wsFreezeTeam() schreibt für sie beim Kader-Lock eine
-- Zeile. Wer AC/BC/ABC war (angemeldet, aber ausgeschlossen), bekommt dort NIE
-- eine Zeile. Rückwirkend ist „angemeldet ohne Platz" von „gar nicht angemeldet"
-- deshalb nicht mehr zu unterscheiden — genau das hat die Rotation am Beispiel
-- ΧΑΣΑΠΗΣ unfair gemacht (02.10.2026: der Kader-Lock dieser Woche lief gar
-- nicht, und ihr tatsächlicher Ausschluss blieb unsichtbar).
--
-- Diese Tabelle hält deshalb den rohen Wert aus APP.teamAssign fest — für JEDEN
-- Eintrag, nicht nur die mit Platz. Geschrieben wird sie einmalig beim
-- Kader-Lock (wsRosterCheck → src/ui/ws.js), zusätzlich zu ws_participation,
-- nicht statt ihr: ws_participation bleibt die Quelle für played/rank/MVP usw.,
-- diese Tabelle ist reine Anmeldehistorie.
--
-- Für Wochen vor dem 09.10.2026 gibt es hier keine Zeilen — die Oberfläche
-- rekonstruiert A/AE/B/BE für sie ersatzweise aus ws_participation und markiert
-- AC/BC/„gar nicht angemeldet" als nicht unterscheidbar (siehe
-- src/core/anmeldehistorie.js).
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_anmeldestand(
  alliance_id uuid not null references alliances(id) on delete cascade,
  player_name text not null,
  mode        text not null default 'ws',
  event_date  date not null,
  wert        text not null,
  created_at  timestamptz not null default now(),
  primary key (alliance_id, player_name, mode, event_date),
  constraint ws_anmeldestand_mode_check check (mode in ('ws','cs')),
  constraint ws_anmeldestand_wert_check check (wert in ('A','AE','B','BE','AC','BC','ABC'))
);

create index if not exists idx_ws_anmeldestand_event on ws_anmeldestand(alliance_id, mode, event_date);

comment on table ws_anmeldestand is
  'Snapshot des vollen Anmeldewerts (A/AE/B/BE/AC/BC/ABC) je Spieler und Woche, geschrieben beim Kader-Lock. Anders als ws_participation auch für AC/BC/ABC — sonst ist „angemeldet ohne Platz" rückwirkend nicht von „gar nicht angemeldet" zu unterscheiden.';

notify pgrst, 'reload schema';
commit;
