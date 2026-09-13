import ctypes, ctypes.wintypes

user32 = ctypes.windll.user32

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

# Fenster-Rechteck
rect = ctypes.wintypes.RECT()
user32.GetWindowRect(game_hwnd, ctypes.byref(rect))
print(f"Fenster-Rect: left={rect.left}, top={rect.top}, right={rect.right}, bottom={rect.bottom}")
print(f"  Breite={rect.right-rect.left}, Höhe={rect.bottom-rect.top}")

# Alle Monitore auflisten
class MONITORINFOEX(ctypes.Structure):
    _fields_ = [('cbSize', ctypes.c_ulong),
                ('rcMonitor', ctypes.wintypes.RECT),
                ('rcWork',    ctypes.wintypes.RECT),
                ('dwFlags',   ctypes.c_ulong),
                ('szDevice',  ctypes.c_wchar * 32)]

monitors = []
def mon_cb(hmon, hdc, lprect, lparam):
    mi = MONITORINFOEX()
    mi.cbSize = ctypes.sizeof(MONITORINFOEX)
    user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
    r = mi.rcMonitor
    monitors.append((r.left, r.top, r.right, r.bottom, mi.szDevice))
    return True

MONITORENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool,
    ctypes.wintypes.HMONITOR, ctypes.wintypes.HDC,
    ctypes.POINTER(ctypes.wintypes.RECT), ctypes.wintypes.LPARAM)
user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(mon_cb), 0)
print(f"\nAlle Monitore:")
for i, (l, t, r, b, dev) in enumerate(monitors):
    print(f"  Monitor {i+1}: left={l}, top={t}, right={r}, bottom={b}  ({r-l}x{b-t})  {dev}")

# Child-Fenster auflisten
print(f"\nChild-Fenster von {game_hwnd}:")
children = []
def child_cb(hwnd, _):
    buf = ctypes.create_unicode_buffer(256)
    cls = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    user32.GetClassNameW(hwnd, cls, 256)
    cr = ctypes.wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(cr))
    vis = user32.IsWindowVisible(hwnd)
    children.append((hwnd, buf.value, cls.value, cr.left, cr.top, cr.right, cr.bottom, vis))
    return True
WNDENUMPROC2 = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
user32.EnumChildWindows(game_hwnd, WNDENUMPROC2(child_cb), 0)
for hwnd, title, cls, l, t, r, b, vis in children:
    print(f"  HWND={hwnd:8d}  vis={vis}  cls='{cls}'  title='{title[:40]}'")
    print(f"             rect: left={l}, top={t}, right={r}, bottom={b}")

# Mittelpunkt des Spielfensters berechnen
cx = (rect.left + rect.right) // 2
cy = (rect.top + rect.bottom) // 2
print(f"\nSpiel-Mittelpunkt (phys): ({cx}, {cy})")
print(f"Karten-Mitte (ca. 30% von oben): ({cx}, {rect.top + (rect.bottom - rect.top) * 4 // 10})")
