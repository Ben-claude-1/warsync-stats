-- 2026-08-07 — Wüstensturm: Ersatzspieler
--
-- Pro Team dürfen 20 Spieler gemeldet werden plus 10 Ersatzspieler. Bisher kannte
-- die Einteilung nur 'A' und 'B'; Ersatzspieler waren nicht von gesetzten Spielern
-- zu unterscheiden. Im Planungsstand (ws_planner_state) kommen dafür die Werte
-- 'AE' und 'BE' dazu — das braucht keine Migration, weil dort JSON liegt und die
-- alten Werte 'A'/'B' unverändert gültig bleiben.
--
-- Der fixierte Kader in ws_participation braucht dagegen eine eigene Spalte:
-- ein Ersatzspieler, der nicht zum Einsatz kam, ist etwas anderes als ein
-- gesetzter Spieler, der nicht angetreten ist. Ohne die Unterscheidung würde die
-- Zuverlässigkeitsquote Ersatzspieler wie Absager behandeln.

ALTER TABLE public.ws_participation
  ADD COLUMN IF NOT EXISTS substitute boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ws_participation.substitute IS
  'true = als Ersatzspieler gemeldet (max. 10/Team), false = gesetzt (max. 20/Team)';

-- Bestandsdaten: alles vor der Einführung war "gesetzt" — der Default passt.

NOTIFY pgrst, 'reload schema';
