-- ══════════════════════════════════════════════════════════════════════════════
--  Anmeldestand: nachgetragene Wochen kennzeichnen
--  16.10.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `ws_anmeldestand` (09.10.2026) wird beim Kader-Lock geschrieben und war
-- deshalb am 16.10.2026 noch **leer** — der Lock dieser Woche lief nicht, und
-- für jede Woche davor gab es ihn noch nicht. In der Anmeldehistorie stand
-- damit kein einziges `AC`/`BC`: sichtbar war nur, was sich aus
-- ws_participation rekonstruieren lässt (A/AE/B/BE), und genau die
-- Ausschlüsse — die Zahl, an der die Rotation hängt — fehlten ganz.
--
-- Nachgetragen werden sie aus den Belegen, die der Dienst ohnehin ablegt
-- (scripts/anmeldestand_nachtragen.py):
--   * `suche_*/bericht.json` — ein Suchlauf schlägt JEDEN Kadernamen einzeln
--     nach und sagt deshalb auch, wer **nicht** angemeldet war. Das ist die
--     beste Quelle, aber es gibt sie erst ab dem 25.09.2026.
--   * `sicherungen/ws_planner_*.json` — der Planungsstand, den der Dienst vor
--     jedem Schreiben sichert; `teamAssign` darin trägt die vollen Werte.
--
-- Beides ist ein Stand **zu einem Zeitpunkt**, nicht der Schlussstand: der
-- beste Beleg für den 02.10. liegt 3 Stunden vor dem Anmeldeschluss, der für
-- den 18.09. anderthalb Tage. Wer danach noch umgeplant wurde, steht hier mit
-- dem älteren Wert. Deshalb zwei Spalten statt eines stillen Nachtrags:
--
--   `quelle`   'lock'     — beim Kader-Lock geschrieben, der Schlussstand.
--              'nachtrag' — aus einem Beleg rekonstruiert, Stand von `stand_um`.
--   `stand_um` der Zeitpunkt, für den der Wert gilt (Scan bzw. savedAt).
--
-- Die Oberfläche zeigt nachgetragene Werte deshalb gepunktet unterstrichen und
-- nennt im Titel Quelle und Zeitpunkt (src/ui/anmeldehistorie.js). Ohne diese
-- Unterscheidung sähe ein Stand von Mittwoch aus wie der Schlussstand vom
-- Donnerstag 04:00 — dieselbe Falle wie „Stufe 0" gegen „nicht gelesen".
--
-- `'C'` kommt zusätzlich in die Werte-Prüfung: bis zum 16.09.2026 kannte das
-- Werkzeug nur ein einziges `'C'` ohne Uhrzeit (die Trennung in `AC`/`BC`/`ABC`
-- kam später). In den Sicherungen vom 02.09. und 09.09. steht deshalb genau
-- das, und es ist die ehrliche Auskunft: angemeldet, kein Platz, Uhrzeit nicht
-- erfasst. Als `AC` zu schreiben hieße, eine Zeit zu erfinden.
-- `REG_WERTE` (src/core/rotation.js) bleibt unberührt — `'C'` entsteht nur hier
-- im Nachtrag, nicht mehr in der Anmeldung.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

alter table ws_anmeldestand
  add column if not exists quelle   text not null default 'lock',
  add column if not exists stand_um timestamptz;

alter table ws_anmeldestand drop constraint if exists ws_anmeldestand_quelle_check;
alter table ws_anmeldestand add  constraint ws_anmeldestand_quelle_check
  check (quelle in ('lock','nachtrag'));

alter table ws_anmeldestand drop constraint if exists ws_anmeldestand_wert_check;
alter table ws_anmeldestand add  constraint ws_anmeldestand_wert_check
  check (wert in ('A','AE','B','BE','AC','BC','ABC','C'));

comment on column ws_anmeldestand.quelle is
  '''lock'' = beim Kader-Lock geschrieben (Schlussstand). ''nachtrag'' = aus einem Scan- oder Planungsstand-Beleg rekonstruiert, gültig für stand_um — nicht zwingend der Stand zum Anmeldeschluss.';
comment on column ws_anmeldestand.stand_um is
  'Zeitpunkt, für den der Wert gilt: bei ''nachtrag'' der Scan bzw. das savedAt der Sicherung, bei ''lock'' NULL (dann gilt der Anmeldeschluss).';

notify pgrst, 'reload schema';
commit;
