"""Auf welchem Server steht ein Allianz-Kuerzel? Alle Karten durchsehen.

    .venv/bin/python -u -m scripts.lwatlas.suche XSKX TCK2

Der Developer-Schluessel darf keine Suche (`/alliances?search=` → 403
ENDPOINT_NOT_ALLOWED). Was bleibt, ist die Karte jedes Servers — eine Anfrage
je Server, rund 2500 fuer alle. **Kuerzel sind nicht weltweit eindeutig**,
deshalb wird nicht beim ersten Treffer aufgehoert.

Die Karten werden **nicht** in den Cache gelegt (Gigabytes); festgehalten wird
nur, was gefunden wurde, fortlaufend in `suche_<kuerzel>.json` — ein Abbruch
kostet so nur die Server, die noch fehlen (`--ab`).
"""
from __future__ import annotations

import argparse
import json
import urllib.error
from datetime import datetime

from scripts.lwatlas.api import CACHE, KontingentKnapp, Zugang


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("kuerzel", nargs="+")
    p.add_argument("--nahe", type=int, default=1668, help="von hier aus nach aussen suchen")
    p.add_argument("--ab", type=int, default=0, help="die ersten N Server ueberspringen")
    a = p.parse_args()

    gesucht = {k.casefold() for k in a.kuerzel}
    w = Zugang().hole("warzones", cache_h=24)["warzones"]
    ids = sorted((z["id"] for z in w), key=lambda i: abs(i - a.nahe))
    ziel = CACHE.parent / f"suche_{'_'.join(sorted(gesucht))}.json"
    funde = json.loads(ziel.read_text()) if a.ab and ziel.exists() else []

    zugang = Zugang()
    for n, wz in enumerate(ids[a.ab:], a.ab + 1):
        try:
            d = zugang.hole(f"warzones/{wz}/bases")
        except KontingentKnapp as e:
            print(f"Abbruch bei {n}: {e}", flush=True)
            break
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            print(f"  #{wz}: {e}", flush=True)
            continue
        finally:
            (CACHE / f"warzones_{wz}_bases.json").unlink(missing_ok=True)
        je = {}
        for f in d.get("features", []):
            pr = f["properties"]
            tag = (pr.get("allianceAbbr") or "").strip()
            if tag.casefold() in gesucht:
                e = je.setdefault((tag, pr.get("allianceId")), {"basen": 0, "zuletzt": ""})
                e["basen"] += 1
                e["zuletzt"] = max(e["zuletzt"], pr.get("lastSeenAt") or "")
        for (tag, aid), e in je.items():
            fund = {"server": wz, "tag": tag, "alliance_id": aid, **e,
                    "scan": d.get("lastScanAt")}
            funde.append(fund)
            print(f"  TREFFER {fund}", flush=True)
        if n % 100 == 0:
            print(f"{n}/{len(ids)} · {datetime.now():%H:%M} · {zugang.bericht()}", flush=True)
        ziel.write_text(json.dumps(funde, indent=1))
    print(f"fertig · {len(funde)} Treffer · {zugang.bericht()} → {ziel}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
