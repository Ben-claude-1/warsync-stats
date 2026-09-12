-- Spieler und Allianzen der Weltkarte aus LW Atlas (api.lwatlas.com).
--
-- Wie `karte_basen` gehoeren beide Tabellen dem **Server**, nicht einer Allianz:
-- auf einer Karte stehen die Spieler aller Allianzen, und die fremden sind der
-- interessantere Teil. Sie stehen deshalb bewusst nicht in TENANT_TABLES.
--
-- Der Schluessel ist `player_uid`, nicht der Name. Wer sich umbenennt, bleibt
-- dieselbe Zeile — beim ersten Abgleich am 12.09.2026 war die Haelfte der
-- vermeintlichen Abgaenge in Wahrheit eine Umbenennung mit Sonderzeichen
-- (`SINNER` -> `ꜱɪɴɴᴇʀ`, `ERZAN` -> `ΞRζλη`).

CREATE TABLE IF NOT EXISTS lwa_allianzen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server          text        NOT NULL,
  alliance_id     text        NOT NULL,
  tag             text,
  mitglieder      integer,            -- memberCount: Basen, die ein Scan bestaetigt hat
  gemeldet        integer,            -- reportedMemberCount: was das Spiel selbst nennt
  power           bigint,             -- Summe ueber die Mitglieder
  kills           bigint,
  gescannt_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lwa_allianzen_uidx ON lwa_allianzen (server, alliance_id);
CREATE INDEX IF NOT EXISTS lwa_allianzen_tag_idx ON lwa_allianzen (server, lower(tag));

CREATE TABLE IF NOT EXISTS lwa_spieler (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server          text        NOT NULL,
  player_uid      text        NOT NULL,
  name            text,
  level           integer,
  allianz         text,               -- Kuerzel, mitgefuehrt fuer die Suche
  alliance_id     text,
  rang            integer,            -- allianceRank 1..5
  x               integer,
  y               integer,
  power           bigint,
  army_power      bigint,
  army_kill       bigint,
  last_active_at  timestamptz,        -- spieleigene Zuletzt-aktiv-Zeit
  gesehen_at      timestamptz,        -- lastSeenAt: rueckt nur vor, wenn die Basis sich aendert
  beobachtet_at   timestamptz,        -- observedAt: wann der Scan lief
  quelle          text,               -- 'karte' (alle Spieler) oder 'mitglieder' (mit Kraft/Kills)
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lwa_spieler_uidx ON lwa_spieler (server, player_uid);
CREATE INDEX IF NOT EXISTS lwa_spieler_name_idx ON lwa_spieler (server, lower(name));
CREATE INDEX IF NOT EXISTS lwa_spieler_allianz_idx ON lwa_spieler (server, lower(allianz));
CREATE INDEX IF NOT EXISTS lwa_spieler_kills_idx ON lwa_spieler (server, army_kill DESC NULLS LAST);

-- Die Oberflaeche liest ueber PostgREST mit demselben offenen Zugang wie der Rest.
ALTER TABLE lwa_allianzen ENABLE ROW LEVEL SECURITY;
ALTER TABLE lwa_spieler  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON lwa_allianzen;
DROP POLICY IF EXISTS allow_all ON lwa_spieler;
CREATE POLICY allow_all ON lwa_allianzen USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON lwa_spieler  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
