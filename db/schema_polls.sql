-- Umfragen für WarSync Stats
-- Anwendbar auf:
--   * Cloud-Supabase (SQL Editor, Projekt ktdzxhyuvukontcxghte)
--   * Lokales Postgres im Docker-Container supabase-db:
--       docker exec -i supabase-db psql -U postgres -d postgres < db/schema_polls.sql

CREATE TABLE IF NOT EXISTS public.ws_polls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ws_polls_active ON public.ws_polls(created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.ws_poll_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id      UUID NOT NULL REFERENCES public.ws_polls(id) ON DELETE CASCADE,
  player_name  TEXT NOT NULL,
  vote         TEXT NOT NULL CHECK (vote IN ('ja','nein')),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by  TEXT,
  CONSTRAINT ws_poll_votes_unique UNIQUE (poll_id, player_name)
);

CREATE INDEX IF NOT EXISTS idx_ws_poll_votes_poll   ON public.ws_poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_ws_poll_votes_player ON public.ws_poll_votes(player_name);

ALTER TABLE public.ws_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ws_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open" ON public.ws_polls;
DROP POLICY IF EXISTS "open" ON public.ws_poll_votes;
CREATE POLICY "open" ON public.ws_polls      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open" ON public.ws_poll_votes FOR ALL USING (true) WITH CHECK (true);
