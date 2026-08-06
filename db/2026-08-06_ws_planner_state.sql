-- Geteilter Planungsstand für Wüstensturm/Schluchtsturm.
-- Vorher lag alles im localStorage → jedes Gerät zeigte eine andere Aufstellung.
-- Keys: ws | cs | karte | karte_bg
create table if not exists public.ws_planner_state(
  key        text primary key,
  data       jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.ws_planner_state enable row level security;
drop policy if exists "open" on public.ws_planner_state;
create policy "open" on public.ws_planner_state for all using(true) with check(true);
grant all on public.ws_planner_state to anon, authenticated, service_role;

-- updated_at gehört der DB, nicht der Client-Uhr (nur zur Nachvollziehbarkeit;
-- verglichen wird das savedAt im Payload).
create or replace function public.ws_planner_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ws_planner_touch on public.ws_planner_state;
create trigger ws_planner_touch before insert or update on public.ws_planner_state
  for each row execute function public.ws_planner_touch();

notify pgrst, 'reload schema';
