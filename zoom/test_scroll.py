"""Schnelltest: Einmal scrollen und schauen ob der Zoom sich aendert."""
import ctypes, ctypes.wintypes, time
from PIL import ImageGrab
import numpy as np

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Spiel finden
result = []
def cb(hwnd, _):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    if 'Last War' in buf.value and user32.IsWindowVisible(hwnd):
        result.append(hwnd)
    return True
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(cb), 0)
hwnd = result[0]

rect = ctypes.wintypes.RECT()
user32.GetWindowRect(hwnd, ctypes.byref(rect))
win_left, win_top, win_right, win_bottom = rect.left, rect.top, rect.right, rect.bottom
win_h = win_bottom - win_top
scroll_x = (win_left + win_right) // 2
scroll_y = win_top + int(win_h * 0.40)

print(f"Fenster: {win_left},{win_top} -> {win_right},{win_bottom}")
print(f"Scroll-Pos: ({scroll_x}, {scroll_y})")

# Vorher-Screenshot
def grab():
    return ImageGrab.grab(bbox=(win_left, win_top, win_right, win_bottom), all_screens=True)

img_before = grab()
img_before.save(r'C:\Users\busin\projects\Warsync-stats\zoom\test_before.png')
print("Vorher-Screenshot gespeichert.")

# Fokus
fg_hwnd = user32.GetForegroundWindow()
fg_tid  = user32.GetWindowThreadProcessId(fg_hwnd, None)
my_tid  = kernel32.GetCurrentThreadId()
user32.AttachThreadInput(fg_tid, my_tid, True)
user32.SetForegroundWindow(hwnd)
user32.AttachThreadInput(fg_tid, my_tid, False)
time.sleep(0.3)

fg_now = user32.GetForegroundWindow()
print(f"Fokus OK: {fg_now == hwnd}")

# Cursor setzen & Scroll
user32.SetCursorPos(scroll_x, scroll_y)
time.sleep(0.15)

# Cursor verifizieren
pt = ctypes.wintypes.POINT()
user32.GetCursorPos(ctypes.byref(pt))
print(f"Cursor ist wirklich bei: ({pt.x}, {pt.y}) (erwartet: {scroll_x}, {scroll_y})")

hwnd_at = user32.WindowFromPoint(pt)
buf = ctypes.create_unicode_buffer(256)
user32.GetWindowTextW(hwnd_at, buf, 256)
print(f"Fenster unter Cursor: '{buf.value}' (soll 'Last War...' sein)")

print("Sende Scroll (rauszoomen)...")
user32.mouse_event(0x0800, 0, 0, ctypes.c_ulong(-120).value, 0)

print("Warte 3 Sekunden...")
time.sleep(3.0)

# Nachher-Screenshot
img_after = grab()
img_after.save(r'C:\Users\busin\projects\Warsync-stats\zoom\test_after.png')

arr_b = np.array(img_before.convert('L'), dtype=np.float32)
arr_a = np.array(img_after.convert('L'), dtype=np.float32)
diff = np.mean(np.abs(arr_a - arr_b)) / 255.0
print(f"Differenz: {diff:.5f}")
if diff > 0.01:
    print("-> ZOOM HAT SICH GEAENDERT!")
elif diff > 0.003:
    print("-> Leichte Aenderung (Animationen?)")
else:
    print("-> KEINE Aenderung - Scroll funktioniert NICHT")
