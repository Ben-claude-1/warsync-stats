#!/usr/bin/env python3
"""Self-consistency analysis — derive pan_delta from tile-spread of repeated bases.

Logic: If a base is visible in N adjacent columns, the on-screen world width is
(N-1)*pan_delta_x. With one anchor (user's base at known coord) we constrain
the average mapping. With repeated observations across overlapping tiles we
constrain the relative scale.

For each player name observed in 2+ tiles:
- col-span = max(col) - min(col) + 1
- row-span = max(row) - min(row) + 1
- The midpoint (avg col, avg row) gives the most likely (row, col) center for that base

If pan_delta is correct, all observations of one base SHOULD cluster in a small
(row, col) range — typically 2-4 cells in each axis depending on how much one
camera screen shows.

Distribution of col-spans ≈ how many tiles one screen width covers.
If most bases span 3 cols, screen width ≈ 2*pan_delta_x (covers 3 columns).
If most span 4 cols, screen width ≈ 3*pan_delta_x.

This script doesn't change pan_delta; it reports the empirical distribution.
"""
from __future__ import annotations

import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

BASE_X, BASE_Y = 494, 563
PAN_DELTA_X = 6
PAN_DELTA_Y = 4.67


def normalize_name(s: str) -> str:
    if not s:
        return ""
    # strip alliance tag in brackets
    s = re.sub(r"\[[^\]]+\]", "", s)
    # strip language flag prefixes
    s = re.sub(r"^(?:DE|US|FR|GB|JP|JAP|GER|USA|SWE|POL|AT|IT|ES|RU|TR|BR|MX|CN|TW|HK|KR|VN|TH|ID|SG|MY|PH|IN|AU|NZ)\|?\s*", "", s)
    # remove duplicated halves: "Prof BonesProf Bones" → "Prof Bones"
    s2 = s.strip()
    n = len(s2)
    if n >= 4 and n % 2 == 0 and s2[: n // 2] == s2[n // 2 :]:
        s2 = s2[: n // 2]
    return s2.strip().lower()


def main():
    out = Path("/Users/ben/.local/state/warsync/consistency_report.json")
    summary = []

    for grid_dir in sorted(Path("/tmp").glob("grid*x*")):
        result_file = grid_dir / "result.json"
        if not result_file.exists():
            continue
        data = json.loads(result_file.read_text())
        if not data:
            continue
        size = max(t["row"] for t in data) + 1
        center = size // 2

        by_name: dict[str, list[tuple[int, int, dict]]] = defaultdict(list)
        for tile in data:
            for p in tile.get("players", []):
                name = normalize_name(p.get("name") or "")
                if not name or len(name) < 3:
                    continue
                by_name[name].append((tile["row"], tile["col"], p))

        repeats = {n: locs for n, locs in by_name.items() if len(locs) >= 2}
        col_spans, row_spans = [], []
        examples = []
        for name, locs in sorted(repeats.items(), key=lambda x: -len(x[1])):
            rows = [r for r, _, _ in locs]
            cols = [c for _, c, _ in locs]
            cs = max(cols) - min(cols) + 1
            rs = max(rows) - min(rows) + 1
            col_spans.append(cs)
            row_spans.append(rs)
            avg_row = statistics.mean(rows)
            avg_col = statistics.mean(cols)
            pred_x = round(BASE_X + (avg_col - center) * PAN_DELTA_X)
            pred_y = round(BASE_Y + (center - avg_row) * PAN_DELTA_Y)
            examples.append({
                "name": name, "occurrences": len(locs),
                "col_range": [min(cols), max(cols)], "col_span": cs,
                "row_range": [min(rows), max(rows)], "row_span": rs,
                "predicted_xy": [pred_x, pred_y],
            })

        report = {
            "scan": grid_dir.name,
            "size": size,
            "unique_names": len(by_name),
            "repeated_names": len(repeats),
            "col_span_mode": statistics.mode(col_spans) if col_spans else None,
            "col_span_median": statistics.median(col_spans) if col_spans else None,
            "col_span_max": max(col_spans) if col_spans else None,
            "row_span_mode": statistics.mode(row_spans) if row_spans else None,
            "row_span_median": statistics.median(row_spans) if row_spans else None,
            "row_span_max": max(row_spans) if row_spans else None,
            "examples_top10": examples[:10],
        }
        summary.append(report)
        print(f"\n=== {grid_dir.name} ===")
        print(f"  unique names: {len(by_name)}, repeated (≥2 tiles): {len(repeats)}")
        print(f"  col-span: mode={report['col_span_mode']}, median={report['col_span_median']}, max={report['col_span_max']}")
        print(f"  row-span: mode={report['row_span_mode']}, median={report['row_span_median']}, max={report['row_span_max']}")
        print(f"  Top-10 most-seen bases:")
        for e in examples[:10]:
            print(f"    {e['occurrences']:2d}× {e['name']:30s} cols {e['col_range']} ({e['col_span']}-span) rows {e['row_range']} ({e['row_span']}-span) → ({e['predicted_xy'][0]},{e['predicted_xy'][1]})")

    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nsaved: {out}")


if __name__ == "__main__":
    main()
