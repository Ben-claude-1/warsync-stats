#!/bin/zsh
# grid_full — full pipeline: scan + vision + persist.
# Usage:
#   grid_full.sh [size] [source-tag]
# size:       3|5|7|9 (default 7)
# source-tag: tag string for DB scan-record (default "manual")
#
# Refuses to run unless warsync-mode is "scouting" (avoids kicking iPhone account).
set -e

SIZE="${1:-7}"
TAG="${2:-manual}"
PROJ="/Users/ben/Projects/Warsync-stats"
STATE_DIR="$HOME/.local/state/warsync"
OUT="/tmp/grid_${SIZE}x${SIZE}"
LOG="$STATE_DIR/grid_${SIZE}x${SIZE}_$(/bin/date +%Y%m%d_%H%M).log"
mkdir -p "$STATE_DIR"

MODE_FILE="$STATE_DIR/mode"
MODE=$(/bin/cat "$MODE_FILE" 2>/dev/null || echo unknown)

if [[ "$3" != "--force" && "$MODE" != "scouting" ]]; then
  echo "[$(date)] mode=$MODE, skipping (use --force to override)" | tee -a "$LOG"
  exit 0
fi

if [[ -f /tmp/warsync_autonomous.lock ]]; then
  echo "[$(date)] autonomous lock present — skipping" | tee -a "$LOG"
  exit 0
fi

echo "[$(date)] grid_full size=$SIZE tag=$TAG" | tee -a "$LOG"

/opt/homebrew/bin/uv run --with pillow python3 "$PROJ/scripts/grid_scan.py" --size "$SIZE" --out "$OUT" 2>&1 | tee -a "$LOG"
/opt/homebrew/bin/uv run --with pillow python3 "$PROJ/scripts/grid_vision.py" --in "$OUT" 2>&1 | tee -a "$LOG"
python3 "$PROJ/scripts/grid_persist.py" --in "$OUT/result.json" --source-tag "$TAG" 2>&1 | tee -a "$LOG"

echo "[$(date)] grid_full done" | tee -a "$LOG"
