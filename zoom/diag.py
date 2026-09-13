import ctypes, ctypes.wintypes, time

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

SCROLL_PHYS_X = 82
SCROLL_PHYS_Y = -1300

# Spiel-Fenster finden
result = []
def cb(hwnd, _):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    if 'Last War' in buf.value and user32.IsWindowVisible(hwnd):
        result.append(hwnd)
    return True
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(cb), 0)
game_hwnd = result[0] if result else None
print(f"Game HWND: {game_hwnd}")

# Spiel in Vordergrund
fg_hwnd = user32.GetForegroundWindow()
fg_tid  = user32.GetWindowThreadProcessId(fg_hwnd, None)
my_tid  = kernel32.GetCurrentThreadId()
user32.AttachThreadInput(fg_tid, my_tid, True)
user32.SetForegroundWindow(game_hwnd)
user32.AttachThreadInput(fg_tid, my_tid, False)
time.sleep(0.3)

fg_now = user32.GetForegroundWindow()
print(f"Foreground jetzt: {fg_now} (game={game_hwnd}, OK={fg_now==game_hwnd})")

# Cursor setzen
user32.SetCursorPos(SCROLL_PHYS_X, SCROLL_PHYS_Y)
time.sleep(0.3)

# Wo ist der Cursor?
pt = ctypes.wintypes.POINT()
user32.GetCursorPos(ctypes.byref(pt))
print(f"Cursor bei: ({pt.x}, {pt.y})")

# Welches Fenster liegt unter dem Cursor?
hwnd_at = user32.WindowFromPoint(pt)
buf = ctypes.create_unicode_buffer(256)
user32.GetWindowTextW(hwnd_at, buf, 256)
cls = ctypes.create_unicode_buffer(256)
user32.GetClassNameW(hwnd_at, cls, 256)
print(f"Fenster unter Cursor: {hwnd_at}")
print(f"  Titel: '{buf.value}'")
print(f"  Klasse: '{cls.value}'")
print(f"  Ist das game? {hwnd_at == game_hwnd}")

# Monitor-Info
class MONITORINFO(ctypes.Structure):
    _fields_ = [('cbSize', ctypes.c_ulong),
                ('rcMonitor', ctypes.wintypes.RECT),
                ('rcWork',    ctypes.wintypes.RECT),
                ('dwFlags',   ctypes.c_ulong)]
mi = MONITORINFO()
mi.cbSize = ctypes.sizeof(MONITORINFO)
hmon = user32.MonitorFromPoint(pt, 2)
user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
r = mi.rcMonitor
print(f"Monitor: left={r.left}, top={r.top}, right={r.right}, bottom={r.bottom}")

print("\nSende Scroll (mouse_event)...")
user32.mouse_event(0x0800, 0, 0, ctypes.c_ulong(-120).value, 0)
print("Scroll gesendet.")
