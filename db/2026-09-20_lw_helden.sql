-- Helden-Katalog: Name -> Truppengattung (Tank/Air/Missile).
--
-- Serverweit wie karte_basen, bewusst NICHT in TENANT_TABLES: ein Held heißt
-- in jeder Allianz gleich und kämpft überall im selben Typ — eine Kopie je
-- Allianz wäre nur eine weitere Stelle, die auseinanderlaufen kann.
--
-- Befüllt zunächst mit den 20 Helden aus Bens eigenem Kader (20.09.2026, per
-- Hand gegen die Portraits abgeglichen, siehe .tmp/helden_zuordnung) — nicht
-- mit dem vollen Season-6-Roster. Ein Held, den niemand in der Allianz
-- spielt, braucht hier keinen Eintrag; ergänzt wird, sobald einer auftaucht.
create table if not exists lw_helden (
  name text primary key,
  typ  text not null check (typ in ('T','A','M')),
  updated_at timestamptz not null default now()
);

insert into lw_helden(name,typ) values
  ('Kimberly','T'),('Murphy','T'),('Scarlett','T'),('Marshall','T'),('Adam','M'),
  ('DVA','A'),('Charlie','A'),('Lucius','A'),('Schuyler','A'),('Morrison','A'),
  ('Williams','T'),('Stetmann','T'),('Tesla','M'),('McGregor','M'),('Swift','M'),
  ('Mason','T'),('Violet','T'),('Monica','T'),('Fiona','M'),('Venom','M')
on conflict (name) do nothing;

notify pgrst, 'reload schema';
