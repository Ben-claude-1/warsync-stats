-- Zugfahrt: eine Zeile pro Tag (Single-Alliance). Zugführer (driver) + VIP.
CREATE TABLE IF NOT EXISTS public.zug_rides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_date   date NOT NULL UNIQUE,
  driver_name text,
  vip_name    text,
  auto        boolean NOT NULL DEFAULT false,  -- true = per Auto-Rotation übernommen, false = manuell gesetzt
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zug_rides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open" ON public.zug_rides;
CREATE POLICY "open" ON public.zug_rides USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.zug_rides TO anon, authenticated;
