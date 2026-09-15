-- Kampfsimulation: Rohdaten einzelner Last-War-Kampfberichte, aus Screenshots
-- abgelesen (Fotos.app auf dem Mac) und von Hand/durch Claude eingetragen.
--
-- Anders als ws_players & Co ist das **kein** Mandanten-Tisch: ein Kampf hat
-- zwei beliebige Parteien, die keiner der beiden Allianzen dieses Werkzeugs
-- angehoeren muessen (z.B. ein Gegner aus einer dritten Allianz). Ein
-- alliance_id-Fremdschluessel wuerde hier nichts abbilden.
--
-- Pro Seite steckt die ganze Auswertung eines Kampfberichts (Name, Kraft je
-- Kategorie, Technologie-Boni, Helden mit Schaden, Einheiten-Verluste) in
-- einer JSONB-Spalte statt in zig Einzelspalten: das Berichts-Layout hat schon
-- zwischen den ersten beiden ausgewerteten Kaempfen variiert (mal mit, mal
-- ohne "Statistiken"-Tab sichtbar), und ein starres Spaltenschema waere bei
-- jeder Abweichung im Weg. Fuer den Vergleich/die Simulation zaehlen ohnehin
-- die Kraftwerte und Schadenszahlen darin, nicht eine SQL-WHERE-Klausel je Feld.
--
-- kampfbericht_id (aus dem Fusszeilen-Text "Kampfbericht-ID: ...") ist der
-- Schluessel gegen Dubletten: dieselben Screenshots koennten sonst bei jedem
-- Hochladen erneut eingetragen werden.

CREATE TABLE IF NOT EXISTS combat_reports (
    id              BIGSERIAL PRIMARY KEY,
    kampfbericht_id TEXT UNIQUE NOT NULL,
    fought_at       TIMESTAMPTZ,
    ort_server      INT,
    ort_x           INT,
    ort_y           INT,
    side_a          JSONB NOT NULL,
    side_b          JSONB NOT NULL,
    notizen         TEXT,
    quelle          TEXT NOT NULL DEFAULT 'foto',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE combat_reports IS
  'Ausgelesene Last-War-Kampfberichte fuer die Kampfsimulation. side_a/side_b: '
  '{name, tag, server, x, y, rolle, ergebnis, verluste, kraft:{helden,armee,'
  'drohne,technologie,dekoration,einheiten,ehrenwand,overlord,kosmetik,andere}, '
  'tech_boni:{...}, einheiten_stats:{besiegt,lazarett,verletzt,ueberleben}, '
  'gesamtschaden, helden:[{name,schaden}]}';

NOTIFY pgrst, 'reload schema';
