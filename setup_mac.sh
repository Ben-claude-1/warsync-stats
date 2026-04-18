#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  WarSync Video Analyzer — Setup fuer Apple M4 Mac
#  Einmalig ausfuehren: bash setup_mac.sh
# ════════════════════════════════════════════════════════════════

set -e

echo ""
echo "WarSync Video Analyzer -- Setup (Apple M4)"
echo "==========================================="
echo ""

# ── 1. Homebrew ────────────────────────────────────────────────
if command -v brew &>/dev/null; then
    echo "OK Homebrew bereits installiert"
else
    echo "Installiere Homebrew..."
    /bin/bash -c "$(curl -fsSL https://brew.sh/install.sh)"
    echo "OK Homebrew installiert"
fi

# ── 2. Python 3.12 ────────────────────────────────────────────
if command -v python3.12 &>/dev/null; then
    echo "OK Python 3.12 bereits installiert"
else
    echo "Installiere Python 3.12..."
    brew install python@3.12
    echo "OK Python 3.12 installiert"
fi

PYTHON=$(command -v python3.12 || command -v python3)
echo "   Python: $($PYTHON --version)"

# ── 3. Python-Pakete ──────────────────────────────────────────
echo ""
echo "Installiere Python-Pakete..."
$PYTHON -m pip install --upgrade pip --quiet
$PYTHON -m pip install opencv-python pillow --quiet
echo "OK opencv-python, pillow installiert"

# ── 4. Ollama ─────────────────────────────────────────────────
echo ""
if command -v ollama &>/dev/null; then
    echo "OK Ollama bereits installiert"
else
    echo "Installiere Ollama..."
    brew install ollama
    echo "OK Ollama installiert"
fi

# ── 5. Ollama-Dienst starten ──────────────────────────────────
echo ""
echo "Starte Ollama-Dienst..."
brew services start ollama 2>/dev/null || true
sleep 3

if curl -s http://localhost:11434/api/tags &>/dev/null; then
    echo "OK Ollama laeuft (http://localhost:11434)"
else
    echo "WARNUNG Ollama antwortet noch nicht"
    echo "   Manuell starten: ollama serve"
fi

# ── 6. Vision-Modell laden ────────────────────────────────────
echo ""
echo "Lade Vision-Modell qwen2.5vl (ca. 5GB, einmalig)..."
echo "   Das kann beim ersten Mal 5-10 Minuten dauern..."
ollama pull qwen2.5vl
echo "OK qwen2.5vl geladen"

# ── 7. Test ───────────────────────────────────────────────────
echo ""
echo "Teste Installation..."
$PYTHON -c "import cv2, PIL; print('OK OpenCV', cv2.__version__, '+ Pillow')"

# ── Fertig ────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo "Setup abgeschlossen!"
echo "==========================================="
echo ""
echo "Verwendung:"
echo ""
echo "  # Eigenes Profil-Video (kurz, <5min)"
echo "  python3 warsync_analyzer.py mein_profil.mp4 --player Ben_the_men"
echo ""
echo "  # Match-Video analysieren (30min)"
echo "  python3 warsync_analyzer.py match.mp4 --mode match"
echo ""
echo "  # Erst testen ohne Datenbank-Upload"
echo "  python3 warsync_analyzer.py video.mp4 --dry-run"
echo ""
echo "  # Ganzen Ordner auf einmal"
echo "  python3 warsync_analyzer.py ~/Videos/warsync/"
echo ""
echo "Optionen:"
echo "  --player NAME    Spielername falls nicht im Video sichtbar"
echo "  --mode profile   Profil-Modus erzwingen"
echo "  --mode match     Match-Modus erzwingen"
echo "  --interval 10    Sekunden zwischen Frames (default: 5)"
echo "  --model llava    Anderes Vision-Modell verwenden"
echo "  --dry-run        Kein Datenbank-Upload"
echo ""
