-- ══════════════════════════════════════════════════════════════════════════════
--  Basen der Weltkarte — was der Kartenscan gefunden hat
--  08.09.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Der Kartenscan (scripts/karten_archiv) fotografiert die Weltkarte kachelweise
-- ab und liest die Banner der Basen. Diese Tabelle ist die Ablage dafür: eine
-- Zeile je Basis, mit Name, Allianz-Kürzel, Stufe und Weltkoordinate.
--
-- ── Warum diese Tabelle NICHT in TENANT_TABLES gehört ────────────────────────
--
-- Die Projektregel lautet: eine neue Tabelle kommt in `TENANT_TABLES`, sonst ist
-- sie über alle Allianzen hinweg sichtbar. Genau das ist hier gewollt, und der
-- Grund ist keine Bequemlichkeit, sondern der Gegenstand selbst.
--
-- Die Weltkarte gehört dem **Server**, nicht einer Allianz. Auf ihr stehen die
-- Basen aller Allianzen — die fremden sind sogar der interessantere Teil. AR1S
-- und XP33 spielen beide auf #1668 und sehen dieselbe Karte; eine Basis, die der
-- eine Scan gefunden hat, ist für den anderen dieselbe Basis an derselben
-- Stelle. Mandantengetrennt hieße: 15.000 Zeilen doppelt, zwei Scans nötig, und
-- zwei Wahrheiten über denselben Fleck Karte.
--
-- Der Zuschnitt ist deshalb `server`, und der ist Pflichtfeld. Wer die Tabelle
-- ohne Server-Filter abfragt, mischt Karten verschiedener Welten — das wäre
-- derselbe Fehler wie eine vergessene `alliance_id`, nur eine Ebene höher.
--
-- ── Was eine Zeile eindeutig macht ───────────────────────────────────────────
--
-- Der Schlüssel ist die **Koordinate**, nicht der Name. Auf einem Feld steht
-- genau eine Basis; wer umzieht, hinterlässt seinen Platz einem anderen. Beim
-- Namen wäre es umgekehrt falsch: derselbe Name kann durch einen Lesefehler
-- zweimal entstehen, und ein Umzug hinterließe eine Leiche an der alten Stelle.
--
-- ── Was der OCR-Text bedeutet ────────────────────────────────────────────────
--
-- `name_roh` ist der unveränderte Text, den Tesseract aus dem Banner gelesen
-- hat; `name` das, was nach der Zuordnung gegen den Kader daraus wurde. Beide
-- stehen nebeneinander, weil die Erkennung nicht buchstabengetreu ist (aus
-- `IIBlackJackII` wird `IBlackJackli`). Wer später eine bessere Erkennung baut,
-- kann sie am Rohtext messen, statt neu scannen zu müssen.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists karte_basen (
  id          uuid primary key default gen_random_uuid(),
  server      text        not null,
  x           integer     not null,
  y           integer     not null,
  name        text,
  name_roh    text,
  allianz     text,
  level       integer,
  quelle      text,
  gesehen_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Eine Basis je Feld. `on_conflict=server,x,y` beim Import.
create unique index if not exists karte_basen_ort_uidx
  on karte_basen (server, x, y);

-- Die Suche läuft über den Namen und ist case-insensitiv. Ein Index auf
-- lower(name) trägt den Präfixfall („Ben*"); für die Teilstringsuche („*men*")
-- braucht es Trigramme, sonst liest Postgres die Tabelle durch. Bei 15.000
-- Zeilen wäre auch das erträglich — der Index kostet aber nichts.
create index if not exists karte_basen_name_idx
  on karte_basen (server, lower(name));
create index if not exists karte_basen_allianz_idx
  on karte_basen (server, allianz);

create extension if not exists pg_trgm;
create index if not exists karte_basen_name_trgm_idx
  on karte_basen using gin (name gin_trgm_ops);

alter table karte_basen enable row level security;
drop policy if exists allow_all on karte_basen;
create policy allow_all on karte_basen using (true) with check (true);

comment on table karte_basen is
  'Basen der Weltkarte aus dem Kartenscan. Zuschnitt ist der Server, NICHT die Allianz — die Karte gehört allen Allianzen desselben Servers gemeinsam.';
comment on column karte_basen.name_roh is
  'Unveränderter OCR-Text des Banners. Bleibt stehen, damit eine bessere Erkennung später am selben Material gemessen werden kann.';
comment on column karte_basen.level is
  'Basisstufe vom Schild unter dem Banner. NULL heißt „nicht gelesen", nicht „Stufe 0".';

notify pgrst, 'reload schema';
commit;
