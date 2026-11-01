"""Security and authentication management for One EAD.

Provides local portal session authentication to protect local endpoints and data
against drive-by cross-origin attacks (CSRF, DNS rebinding, and unauthorized LAN access).
Implements a single-use ticket exchange to prevent token exposure in URLs and browser history.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Optional, Union
import subprocess

_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = _ROOT / "data"
TOKEN_FILE = DATA_DIR / ".portal_session_token"

SESSION_COOKIE_NAME = "one_ead_session"
AUTH_PARAM_NAME = "auth"
TICKET_PARAM_NAME = "ticket"
AUTH_HEADER_NAME = "X-OneEAD-Token"

_CACHED_TOKEN: Optional[str] = None

# Ephemeral single-use login tickets for secure browser launching
# Maps ticket string -> expiration timestamp (epoch seconds)
_TICKETS: dict[str, float] = {}
_TICKETS_LOCK = threading.Lock()
TICKET_TTL_SECONDS = 60.0  # 1-minute validity window for initial browser handshake

# Pattern matching sensitive auth parameters in URLs and query strings
SENSITIVE_PARAM_PATTERN = re.compile(
    r'([?&](?:auth|ticket|token|code|key|secret)=)[^&\s"\']+',
    re.IGNORECASE,
)




def _verify_windows_acl(p: Path, username: str) -> bool:
    """Verifies that the file/dir ACL strictly contains only the authorized user and SYSTEM,
    with no inherited permissions and no unauthorized explicit ACEs.
    """
    try:
        check_res = subprocess.run(["icacls", str(p)], capture_output=True, text=True, check=False)
        if check_res.returncode != 0:
            return False

        allowed_names = {
            username.lower(),
            "system",
            "nt authority\\system",
            "*s-1-5-18",
            "s-1-5-18",
        }
        found_user = False
        found_system = False

        for line in check_res.stdout.splitlines():
            clean = line.strip()
            if not clean or "successfully processed" in clean.lower():
                continue
            idx = clean.find(":(")
            if idx == -1:
                continue
            before_perm = clean[:idx]
            perm = clean[idx + 2 :].split(")")[0].lower()

            for p_cand in [str(p).lower(), p.name.lower(), str(p.resolve()).lower()]:
                if before_perm.lower().startswith(p_cand):
                    before_perm = before_perm[len(p_cand) :].strip()

            p_name = before_perm.strip().lower()
            if "\\" in p_name:
                short_name = p_name.split("\\")[-1]
            else:
                short_name = p_name

            # Reject any inherited permission (I)
            if "(i)" in clean.lower() or "i" in perm.split(","):
                return False

            # Verify principal authorization
            if p_name in allowed_names or short_name in allowed_names:
                if "f" in clean[idx:].lower():
                    if short_name == username.lower() or p_name == username.lower():
                        found_user = True
                    if "system" in short_name or "*s-1-5-18" in p_name:
                        found_system = True
            else:
                # Unauthorized explicit ACE detected!
                return False

        return found_user and found_system
    except Exception:
        return False


def secure_path_permissions(path: Union[Path, str], is_dir: bool = False) -> bool:
    r"""Restricts permissions on a sensitive file or directory to current user and SYSTEM.

    Removes unauthorized explicit ACEs and strips inherited permissions.
    On Windows: Uses icacls.exe to reset explicit ACEs (/reset), remove inheritance (/inheritance:r),
    grant Full Control strictly to current user and SYSTEM, and verifies final ACL before returning True.
    On POSIX: Uses os.chmod with 0o700 for directories and 0o600 for files.
    """
    p = Path(path)
    if not p.exists():
        return False

    if os.name == "nt":
        username = os.environ.get("USERNAME")
        if not username and hasattr(os, "getlogin"):
            try:
                username = os.getlogin()
            except Exception:
                pass
        if not username:
            return False

        perm = "(OI)(CI)(F)" if is_dir else "(F)"
        try:
            # 1. Reset permissions to remove unauthorized explicit ACEs
            r_reset = subprocess.run(["icacls", str(p), "/reset"], capture_output=True, text=True, check=False)
            if r_reset.returncode != 0:
                return False

            # 2. Explicitly remove any broad or unauthorized principal ACEs
            r_remove = subprocess.run(
                ["icacls", str(p), "/remove:g", "Everyone", "BUILTIN\\Users", "Authenticated Users", "Guests"],
                capture_output=True,
                text=True,
                check=False,
            )
            if r_remove.returncode != 0:
                return False

            # 3. Strip inherited permissions
            r_inherit = subprocess.run(["icacls", str(p), "/inheritance:r"], capture_output=True, text=True, check=False)
            if r_inherit.returncode != 0:
                return False

            # 4. Grant Full Control exclusively to current user and SYSTEM
            grant_res = subprocess.run(
                ["icacls", str(p), "/grant:r", f"{username}:{perm}", f"*S-1-5-18:{perm}"],
                capture_output=True,
                text=True,
                check=False,
            )
            if grant_res.returncode != 0:
                return False

            # 5. Verify the final ACL before returning True
            return _verify_windows_acl(p, username)
        except Exception:
            return False
    else:
        try:
            os.chmod(p, 0o700 if is_dir else 0o600)
            return True
        except Exception:
            return False


def get_portal_token() -> str:
    """Retrieves or generates the persistent local portal session token."""
    global _CACHED_TOKEN

    env_tok = os.environ.get("ONE_EAD_PORTAL_TOKEN")
    if env_tok and len(env_tok.strip()) >= 32:
        return env_tok.strip()

    if _CACHED_TOKEN and len(_CACHED_TOKEN) >= 32:
        return _CACHED_TOKEN

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not secure_path_permissions(DATA_DIR, is_dir=True):
        raise PermissionError(f"Failed to confirm secure permissions on portal data directory at {DATA_DIR}")

    if TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if len(tok) >= 32:
            _CACHED_TOKEN = tok
            if not secure_path_permissions(TOKEN_FILE, is_dir=False):
                raise PermissionError(f"Failed to confirm secure permissions on existing portal session token at {TOKEN_FILE}")
            return tok

    # Generate high-entropy 256-bit token
    new_token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(new_token, encoding="utf-8")
    if not secure_path_permissions(TOKEN_FILE, is_dir=False):
        try:
            TOKEN_FILE.unlink()
        except OSError:
            pass
        raise PermissionError(f"Failed to apply secure NTFS permissions on newly generated portal token at {TOKEN_FILE}")

    _CACHED_TOKEN = new_token
    return new_token


def verify_portal_token(candidate: Optional[str]) -> bool:
    """Verifies candidate token against the active portal token using constant-time comparison."""
    if not candidate or not isinstance(candidate, str):
        return False
    active = get_portal_token()
    return secrets.compare_digest(candidate.strip(), active)


def _sign_ticket(nonce: str, expiry: str) -> str:
    import hashlib
    import hmac
    msg = f"{nonce}.{expiry}".encode()
    return hmac.new(get_portal_token().encode(), msg, hashlib.sha256).hexdigest()


def create_login_ticket() -> str:
    """Create a short-lived, single-use, HMAC-signed login ticket.

    The reusable portal token is never placed in the URL. Being signed, the ticket
    is valid in any server process (e.g. uvicorn reload workers); single-use is
    enforced by the consuming process remembering used nonces.
    """
    nonce = secrets.token_urlsafe(16)
    expiry = str(int(time.time() + TICKET_TTL_SECONDS))
    return f"{nonce}.{expiry}.{_sign_ticket(nonce, expiry)}"


def _replay_dir() -> Path:
    override = os.environ.get("ONE_EAD_TICKET_REPLAY_DIR", "").strip()
    return Path(override) if override else DATA_DIR / ".used_tickets"


def _claim_nonce(nonce: str) -> bool:
    """Atomically claim a nonce in a shared on-disk store (O_CREAT|O_EXCL).

    Shared by every server process on this machine and persistent across restarts, so a
    ticket can be redeemed exactly once. Any storage error fails closed (ticket rejected).
    """
    import hashlib

    d = _replay_dir()
    try:
        d.mkdir(parents=True, exist_ok=True)
        # Purge markers that can no longer matter (their tickets have expired)
        cutoff = time.time() - 2 * TICKET_TTL_SECONDS - 60
        for entry in os.scandir(d):
            try:
                if entry.is_file() and entry.stat().st_mtime < cutoff:
                    os.unlink(entry.path)
            except OSError:
                pass
        if not secure_path_permissions(d, is_dir=True):
            return False
        marker = d / hashlib.sha256(nonce.encode()).hexdigest()[:40]
        fd = os.open(str(marker), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        if not secure_path_permissions(marker, is_dir=False):
            try:
                marker.unlink()
            except OSError:
                pass
            return False
        return True
    except FileExistsError:
        return False
    except OSError:
        return False


def consume_login_ticket(ticket: Optional[str]) -> bool:
    """Verify signature/expiry and atomically consume a ticket. Replay is rejected."""
    if not ticket or not isinstance(ticket, str):
        return False
    parts = ticket.strip().split(".")
    if len(parts) != 3:
        return False
    nonce, expiry, sig = parts
    if not secrets.compare_digest(sig, _sign_ticket(nonce, expiry)):
        return False
    try:
        exp = float(expiry)
    except ValueError:
        return False
    now = time.time()
    if now > exp or exp > now + TICKET_TTL_SECONDS + 5:
        return False
    return _claim_nonce(nonce)


def redact_sensitive_url(url_or_query: str) -> str:
    """Redacts credentials and one-time tickets from URLs or log strings."""
    if not url_or_query:
        return ""
    return SENSITIVE_PARAM_PATTERN.sub(r'\1[REDACTED]', url_or_query)


class CredentialRedactingFilter(logging.Filter):
    """Logging filter that ensures URLs with auth tokens or tickets are never logged with credentials."""
    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    new_args.append(redact_sensitive_url(arg))
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)
        if isinstance(record.msg, str):
            record.msg = redact_sensitive_url(record.msg)
        return True


def install_credential_redacting_logger() -> None:
    """Installs credential redacting filters on uvicorn and root loggers."""
    flt = CredentialRedactingFilter()
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", ""):
        log = logging.getLogger(name)
        if not any(isinstance(f, CredentialRedactingFilter) for f in log.filters):
            log.addFilter(flt)


def render_lock_screen_html(error_message: Optional[str] = None) -> str:
    """Renders a standalone, dark-themed session lock screen with a secure POST form."""
    err_html = f'<div class="lock-error">{error_message}</div>' if error_message else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
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
    input[type="password"], input[type="text"] {{
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
    input[type="password"]:focus, input[type="text"]:focus {{
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
    <form action="/auth/login" method="POST">
      <label for="token">Session Authentication Token</label>
      <div class="input-row">
        <input type="password" id="token" name="token" placeholder="Paste your session token here..." required autofocus autocomplete="off" />
        <button type="submit">Unlock</button>
      </div>
    </form>
    <div class="tip-box">
      <strong>Zero-Friction Tip:</strong> Launching from <code>run.py</code> or <code>start.bat</code> uses a single-use exchange ticket to automatically authenticate your browser without exposing your session token in the URL.
    </div>
  </div>
</body>
</html>"""


SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


_DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin_tuple(scheme: str, hostname, port):
    scheme = (scheme or "").lower()
    if scheme not in _DEFAULT_PORTS or not hostname:
        return None
    return (scheme, hostname.lower(), port if port is not None else _DEFAULT_PORTS[scheme])


def _origin_of_url(value: str):
    from urllib.parse import urlsplit

    try:
        u = urlsplit(value)
        return _origin_tuple(u.scheme, u.hostname, u.port)
    except ValueError:
        return None


def is_same_origin_request(method: str, headers, scheme: str = "http") -> bool:
    """CSRF check for state-changing requests using Fetch Metadata, Origin and Referer.

    Origin/Referer are compared as full origins (scheme, hostname, port), not just the host
    string, against the origin the request was actually sent to (`scheme` + Host header).
    Browsers always send Sec-Fetch-Site/Origin on cross-site writes, so a page served from
    another port, host or scheme is rejected. Non-browser clients that send none of these
    headers (curl, tests, scripts) are allowed; they still need the session token.
    """
    if (method or "").upper() in SAFE_METHODS:
        return True
    from urllib.parse import urlsplit

    site = (headers.get("sec-fetch-site") or "").lower()
    if site and site not in ("same-origin", "none"):
        return False

    host = headers.get("host") or ""
    try:
        h = urlsplit("//" + host)
        expected = _origin_tuple(scheme, h.hostname, h.port)
    except ValueError:
        expected = None

    for name in ("origin", "referer"):
        value = headers.get(name)
        if value:
            if expected is None or _origin_of_url(value) != expected:
                return False
    return True
