"""Bring native Windows dialogs opened by a background process to the front.

PDF Arranger runs headless (Broadway), so its native Open/Save dialogs are created by a
process that is not in the foreground and Windows keeps them behind the browser.
"""

from __future__ import annotations

import ctypes
import subprocess
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

_ENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

user32.SetWindowPos.argtypes = [
    wintypes.HWND,
    wintypes.HWND,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]

# Explicit 64-bit signatures for window enumeration
user32.EnumWindows.argtypes = [_ENUM, wintypes.LPARAM]
user32.EnumWindows.restype = wintypes.BOOL
user32.EnumDesktopWindows.argtypes = [wintypes.HDESK, _ENUM, wintypes.LPARAM]
user32.EnumDesktopWindows.restype = wintypes.BOOL

user32.OpenDesktopW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
user32.OpenDesktopW.restype = wintypes.HDESK
user32.CloseDesktop.argtypes = [wintypes.HDESK]
user32.CloseDesktop.restype = wintypes.BOOL
user32.SetThreadDesktop.argtypes = [wintypes.HDESK]
user32.SetThreadDesktop.restype = wintypes.BOOL

_HWND_TOPMOST = wintypes.HWND(-1)
_HWND_NOTOPMOST = wintypes.HWND(-2)
_SWP_NOSIZE, _SWP_NOMOVE, _SWP_SHOWWINDOW = 0x1, 0x2, 0x40
_SW_RESTORE = 9
_VK_MENU, _KEYUP = 0x12, 0x2


def windows_of(pid: int) -> list:
    """Find all top-level windows belonging to pid or related dialogs on desktop."""
    found = []

    @_ENUM
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            owner = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == pid:
                found.append(hwnd)
        return True

    # Try Default desktop first (user's interactive screen)
    hDesk = user32.OpenDesktopW("Default", 0, False, 0x01FF)
    if hDesk:
        try:
            user32.EnumDesktopWindows(hDesk, cb, 0)
        finally:
            user32.CloseDesktop(hDesk)
    else:
        user32.EnumWindows(cb, 0)

    return found


def raise_window(hwnd) -> None:
    """Centre the window on screen and force it to the foreground over Chrome."""
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, _SW_RESTORE)

    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    x = max(0, (user32.GetSystemMetrics(0) - (rect.right - rect.left)) // 2)
    y = max(0, (user32.GetSystemMetrics(1) - (rect.bottom - rect.top)) // 3)

    # Bring to topmost immediately so it stays visible over maximized Chrome
    user32.SetWindowPos(hwnd, _HWND_TOPMOST, x, y, 0, 0, _SWP_NOSIZE | _SWP_SHOWWINDOW)
    user32.ShowWindow(hwnd, _SW_RESTORE)

    # An Alt tap plus attaching to the foreground thread lets SetForegroundWindow succeed.
    user32.keybd_event(_VK_MENU, 0, 0, 0)
    user32.keybd_event(_VK_MENU, 0, _KEYUP, 0)
    fg = user32.GetForegroundWindow()
    fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
    this_thread = kernel32.GetCurrentThreadId()
    attached = bool(fg_thread) and fg_thread != this_thread and user32.AttachThreadInput(this_thread, fg_thread, True)

    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)

    if attached:
        user32.AttachThreadInput(this_thread, fg_thread, False)


def watch(proc: subprocess.Popen, interval: float = 0.2) -> None:
    """Raise every new window the process opens, until it exits."""
    # Ensure this watcher thread has access to the user's interactive desktop
    hDesk = user32.OpenDesktopW("Default", 0, False, 0x01FF)
    if hDesk:
        try:
            user32.SetThreadDesktop(hDesk)
        except Exception:
            pass

    seen = set()
    while proc.poll() is None:
        current = {int(h): h for h in windows_of(proc.pid)}
        for key, hwnd in current.items():
            if key not in seen:
                raise_window(hwnd)
        seen = set(current)
        time.sleep(interval)
