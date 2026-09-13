"""
Zoom-Level Capture Script
=========================
Scrollt schrittweise aus der Karte raus, macht bei jedem Schritt einen
Screenshot und speichert ihn im zoom/-Ordner.

Koordinaten werden dynamisch aus dem Spielfenster berechnet.
"""

import sys, os, time, ctypes, ctypes.wintypes
import numpy as np
from PIL import ImageGrab

# ── Konfiguration ──────────────────────────────────────────────────────────────
SCROLL_PAUSE   = 1.0      # Warten nach jedem Scroll (Karte laden lassen)
MAX_STEPS      = 300
DIFF_THRESHOLD = 0.0015   # < 0.15% Differenz = keine Änderung mehr
DIFF_CHECK_N   = 4        # N mal stabil = Maximum

OUT_DIR = r'C:\Users\busin\projects\Warsync-stats\zoom'

MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA       = 120

user32   = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# ── Spiel-Fenster finden ───────────────────────────────────────────────────────

def find_game_hwnd():
    result = []
    def cb(hwnd, _):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        if 'Last War' in buf.value and user32.IsWindowVisible(hwnd):
            result.append(hwnd)
        return True
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool,
                                      ctypes.wintypes.HWND,
                                      ctypes.wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return result[0] if result else None

def get_window_rect(hwnd):
    rect = ctypes.wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom

# ── Fokus erzwingen via AttachThreadInput ──────────────────────────────────────

def force_foreground(hwnd):
    fg_hwnd = user32.GetForegroundWindow()
    fg_tid  = user32.GetWindowThreadProcessId(fg_hwnd, None)
    my_tid  = kernel32.GetCurrentThreadId()
    if fg_tid != my_tid:
        user32.AttachThreadInput(fg_tid, my_tid, True)
    user32.ShowWindow(hwnd, 9)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    if fg_tid != my_tid:
        user32.AttachThreadInput(fg_tid, my_tid, False)
    time.sleep(0.2)
    ok = (user32.GetForegroundWindow() == hwnd)
    print(f"    Fokus: {'OK' if ok else 'FAILED'}")
    return ok

# ── Scroll ─────────────────────────────────────────────────────────────────────

def scroll_out(hwnd, scroll_x, scroll_y):
    """Einen Notch rauszoomen."""
    force_foreground(hwnd)
    user32.SetCursorPos(scroll_x, scroll_y)
    time.sleep(0.1)
    # Negatives delta = rauszoomen
    user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0,
                       ctypes.c_ulong(-WHEEL_DELTA).value, 0)
    time.sleep(SCROLL_PAUSE)

# ── Screenshot des Spielfensters ───────────────────────────────────────────────

def screenshot(left, top, right, bottom):
    bbox = (left, top, right, bottom)
    return ImageGrab.grab(bbox=bbox, all_screens=True)

def img_diff(a, b):
    arr_a = np.array(a.convert('L'), dtype=np.float32)
    arr_b = np.array(b.convert('L'), dtype=np.float32)
    return np.mean(np.abs(arr_a - arr_b)) / 255.0

def save(img, level, note=''):
    name = f'zoom_{level:04d}{("_" + note) if note else ""}.png'
    path = os.path.join(OUT_DIR, name)
    img.save(path)
    return path

# ── Haupt-Loop ─────────────────────────────────────────────────────────────────

def main():
    start_level = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    os.makedirs(OUT_DIR, exist_ok=True)

    hwnd = find_game_hwnd()
    if not hwnd:
        print("FEHLER: Last War Fenster nicht gefunden!")
        sys.exit(1)

    # Spielfenster-Koordinaten dynamisch ermitteln
    win_left, win_top, win_right, win_bottom = get_window_rect(hwnd)
    win_w = win_right - win_left
    win_h = win_bottom - win_top

    # Scroll-Position: Mitte des Fensters, 40% von oben
    scroll_x = (win_left + win_right) // 2
    scroll_y = win_top + int(win_h * 0.40)

    print(f"Last War HWND: {hwnd}")
    print(f"Fenster: left={win_left}, top={win_top}, right={win_right}, bottom={win_bottom} ({win_w}x{win_h})")
    print(f"Scroll-Position: ({scroll_x}, {scroll_y})")

    # Erstes Bild
    prev_img = screenshot(win_left, win_top, win_right, win_bottom)
    path = save(prev_img, start_level, 'MAX_IN')
    print(f"[{start_level:04d}] {os.path.basename(path)}  (Startbild)")

    stable_count = 0
    MIN_FIRST_DIFF = 0.003

    for step in range(1, MAX_STEPS + 1):
        level = start_level + step
        print(f"[{level:04d}] Scrolle raus...")

        scroll_out(hwnd, scroll_x, scroll_y)

        cur_img = screenshot(win_left, win_top, win_right, win_bottom)
        diff    = img_diff(prev_img, cur_img)

        if step == 1 and diff < MIN_FIRST_DIFF:
            print(f"\n!!! FEHLER: Kein Zoom-Wechsel nach erstem Scroll (diff={diff:.5f})")
            print("    Scroll funktioniert nicht — Script wird beendet.")
            save(cur_img, level, 'SCROLL_FAILED')
            sys.exit(1)

        if diff < DIFF_THRESHOLD:
            stable_count += 1
            note = f'STABLE{stable_count}'
        else:
            stable_count = 0
            note = ''

        path = save(cur_img, level, note)
        print(f"         diff={diff:.5f}  -> {os.path.basename(path)}")

        if stable_count >= DIFF_CHECK_N:
            save(cur_img, level, 'MAX_OUT')
            print(f"\n=== MAXIMUM ZOOM OUT bei Stufe {level} ===")
            break

        prev_img = cur_img

    print(f"\nFertig. Bilder in: {OUT_DIR}")

if __name__ == '__main__':
    main()
