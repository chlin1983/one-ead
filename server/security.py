"""Security and authentication management for One EAD.

Provides local portal session authentication to protect local endpoints and data
against drive-by cross-origin attacks (CSRF, DNS rebinding, and unauthorized LAN access).
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = _ROOT / "data"
TOKEN_FILE = DATA_DIR / ".portal_session_token"

SESSION_COOKIE_NAME = "one_ead_session"
AUTH_PARAM_NAME = "auth"
AUTH_HEADER_NAME = "X-OneEAD-Token"

_CACHED_TOKEN: Optional[str] = None


def get_portal_token() -> str:
    """Retrieves or generates the persistent local portal session token."""
    global _CACHED_TOKEN

    env_tok = os.environ.get("ONE_EAD_PORTAL_TOKEN")
    if env_tok and len(env_tok.strip()) >= 32:
        return env_tok.strip()

    if _CACHED_TOKEN and len(_CACHED_TOKEN) >= 32:
        return _CACHED_TOKEN

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if TOKEN_FILE.exists():
        try:
            tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
            if len(tok) >= 32:
                _CACHED_TOKEN = tok
                return tok
        except Exception:
            pass

    # Generate high-entropy 256-bit token
    new_token = secrets.token_urlsafe(32)
    try:
        TOKEN_FILE.write_text(new_token, encoding="utf-8")
        # Try setting restrictive permissions on Unix/macOS if applicable
        if hasattr(os, "chmod"):
            try:
                os.chmod(TOKEN_FILE, 0o600)
            except Exception:
                pass
    except Exception:
        pass

    _CACHED_TOKEN = new_token
    return new_token


def verify_portal_token(candidate: Optional[str]) -> bool:
    """Verifies candidate token against the active portal token using constant-time comparison."""
    if not candidate or not isinstance(candidate, str):
        return False
    active = get_portal_token()
    return secrets.compare_digest(candidate.strip(), active)


def render_lock_screen_html(error_message: Optional[str] = None) -> str:
    """Renders a standalone, dark-themed session lock screen."""
    err_html = f'<div class="lock-error">{error_message}</div>' if error_message else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>One EAD — Session Locked</title>
  <style>
    :root {{
      --bg: #0f131a;
      --card-bg: #181d28;
      --border: #262e3d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }}
    .lock-card {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      max-width: 480px;
      width: 100%;
      padding: 36px 32px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      text-align: center;
    }}
    .lock-icon {{
      width: 56px;
      height: 56px;
      margin: 0 auto 20px;
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.25);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }}
    .lock-icon svg {{
      width: 28px;
      height: 28px;
    }}
    h1 {{
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text);
    }}
    p {{
      font-size: 14px;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }}
    .lock-error {{
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 20px;
      text-align: left;
    }}
    form {{
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: left;
    }}
    label {{
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
    }}
    .input-row {{
      display: flex;
      gap: 8px;
    }}
    input[type="text"] {{
      flex: 1;
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 14px;
      font-size: 14px;
      border-radius: 6px;
      outline: none;
      transition: border-color 0.15s ease;
      font-family: monospace;
    }}
    input[type="text"]:focus {{
      border-color: var(--accent);
    }}
    button {{
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }}
    button:hover {{
      background: var(--accent-hover);
    }}
    .tip-box {{
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      line-height: 1.4;
      text-align: left;
    }}
    .tip-box strong {{
      color: var(--text);
    }}
    code {{
      background: #0d1117;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      color: #93c5fd;
    }}
  </style>
</head>
<body>
  <div class="lock-card">
    <div class="lock-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    </div>
    <h1>One EAD Session Locked</h1>
    <p>This workstation is protected by local security hardening to prevent unauthorized cross-origin access.</p>
    {err_html}
    <form action="/" method="GET">
      <label for="auth">Session Authentication Token</label>
      <div class="input-row">
        <input type="text" id="auth" name="auth" placeholder="Paste your session token here..." required autofocus autocomplete="off" />
        <button type="submit">Unlock</button>
      </div>
    </form>
    <div class="tip-box">
      <strong>Zero-Friction Tip:</strong> Double-clicking <code>start.bat</code> will automatically authenticate your browser and open the portal. No typing required.
    </div>
  </div>
</body>
</html>"""
