#!/usr/bin/env python3
"""
google_oauth_loopback.py — Unified Local OAuth Loopback & Token Sync Engine

Always uses plain HTTP loopback (http://127.0.0.1:<port>) with a Google Cloud
"Desktop app" client (default project: `anymd-515619`) — never https://localhost.

Functions:
  1. Captures offline refresh_tokens via a lightweight ephemeral local HTTP server.
  2. Writes the unified token bundle (~/.config/anymd/google_oauth_token.json or C:\\Scripts\\... / %APPDATA%).
  3. Emits rclone.conf-compatible JSON (`token = {"access_token":..., "refresh_token":...}`)
     and RCLONE_CONFIG_* environment variables for headless zero-disk-write rclone execution.
  4. Automatically rotates/refreshes expired access_tokens via grant_type=refresh_token
     so daemons (anymd_daemon.py :3050, rclone rcd :5572, Kittlibr) never stall or require manual browser re-auth.
  5. Windows console cp1252 safe (reconfigures stdout/stderr to utf-8 with error replacement).
"""

import os
import sys
import json
import time
import urllib.parse
import urllib.request
import urllib.error
import http.server
import socketserver
import webbrowser
from pathlib import Path
from typing import Dict, Any, List, Optional

# Enforce UTF-8 console output to prevent Windows cp1252 charmap encode crashes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Default Client Credentials for Desktop App (project: anymd-515619)
DEFAULT_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "anymd-515619-desktop.apps.googleusercontent.com")
DEFAULT_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"

# Modular Scope Presets
SCOPE_PRESETS: Dict[str, List[str]] = {
    "base": [
        "openid",
        "email",
        "profile"
    ],
    "drive_vault": [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.appdata"
    ],
    "drive_full": [
        "https://www.googleapis.com/auth/drive"
    ],
    # MBB / Somatic / Telemeowtrics expansion scopes
    "mbb_fitness": [
        "https://www.googleapis.com/auth/fitness.activity.read",
        "https://www.googleapis.com/auth/fitness.body.read",
        "https://www.googleapis.com/auth/fitness.location.read"
    ],
    "mbb_location": [
        "https://www.googleapis.com/auth/fitness.location.read"
    ],
    "mbb_contacts": [
        "https://www.googleapis.com/auth/contacts.readonly"
    ]
}


def get_token_storage_path() -> Path:
    """
    Returns the cross-platform canonical path for the AnyMD token bundle:
    - Windows: %APPDATA%\\anymd\\google_oauth_token.json or C:\\Scripts\\google_oauth_token.json
    - Linux/Mac/Android: ~/.config/anymd/google_oauth_token.json
    """
    custom = os.environ.get("ANYMD_TOKEN_PATH")
    if custom:
        return Path(custom)

    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            base = Path(appdata) / "anymd"
        else:
            base = Path.home() / ".config" / "anymd"
    else:
        base = Path.home() / ".config" / "anymd"

    base.mkdir(parents=True, exist_ok=True)
    return base / "google_oauth_token.json"


def resolve_scopes(preset_names: Optional[List[str]] = None, extra_scopes: Optional[List[str]] = None) -> List[str]:
    """Combines requested scope presets and additional scopes, removing duplicates."""
    presets = preset_names or ["base", "drive_vault"]
    scopes: List[str] = []
    for p in presets:
        if p in SCOPE_PRESETS:
            scopes.extend(SCOPE_PRESETS[p])
    if extra_scopes:
        scopes.extend(extra_scopes)
    return list(dict.fromkeys(scopes))


class OAuthLoopbackHandler(http.server.BaseHTTPRequestHandler):
    """Handles the redirect from Google on http://127.0.0.1:<port>."""
    server: "OAuthLoopbackServer"

    def do_GET(self):
        url_parts = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url_parts.query)

        if "code" in query:
            self.server.auth_code = query["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"""
            <html>
            <body style="font-family: sans-serif; background: #0f1015; color: #63b3ed; padding: 40px; text-align: center;">
                <h2>&#10004; AnyMD / Kittlibr / MBB OAuth Captured!</h2>
                <p style="color: #cbd5e0;">Authorization code received via 127.0.0.1 loopback. You can return to your terminal.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
            """)
        elif "error" in query:
            self.server.auth_error = query.get("error_description", query["error"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"OAuth Error: {self.server.auth_error}".encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence default web server access logs
        return


class OAuthLoopbackServer(socketserver.TCPServer):
    allow_reuse_address = True
    auth_code: Optional[str] = None
    auth_error: Optional[str] = None


def run_local_oauth_flow(
    client_id: str = DEFAULT_CLIENT_ID,
    client_secret: str = DEFAULT_CLIENT_SECRET,
    scopes: Optional[List[str]] = None,
    preferred_port: int = 8085,
    timeout_sec: int = 180
) -> Dict[str, Any]:
    """
    Executes an ephemeral loopback HTTP server on 127.0.0.1, opens the system browser,
    captures the code, exchanges it for tokens, and writes the bundle.
    """
    selected_scopes = scopes or resolve_scopes()
    scope_str = " ".join(selected_scopes)

    # Bind to 127.0.0.1 (never localhost/https)
    port = preferred_port
    server = None
    for candidate_port in [preferred_port, preferred_port + 1, preferred_port + 2, 0]:
        try:
            server = OAuthLoopbackServer(("127.0.0.1", candidate_port), OAuthLoopbackHandler)
            port = server.server_address[1]
            break
        except OSError:
            continue

    if not server:
        raise RuntimeError("Could not bind loopback server on 127.0.0.1")

    redirect_uri = f"http://127.0.0.1:{port}"

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope_str,
        "access_type": "offline",      # Required to receive refresh_token
        "prompt": "consent",            # Force consent so refresh_token is returned
        "include_granted_scopes": "true"
    }

    auth_url = f"{AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"
    print(f"\n🐾 AnyMD / Kittlibr / MBB OAuth Loopback Initiating...")
    print(f"  • Redirect URI : {redirect_uri} (plain HTTP loopback)")
    print(f"  • Scopes       : {len(selected_scopes)} requested ({', '.join(selected_scopes[:3])}...)")
    print(f"  • Note on unverified apps: For sensitive/restricted scopes, click 'Advanced -> Go to AnyMD (unsafe)' to proceed.")
    print(f"  • Opening browser: {auth_url}\n")

    webbrowser.open(auth_url)

    server.timeout = 2.0
    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        server.handle_request()
        if server.auth_code or server.auth_error:
            break

    server.server_close()

    if server.auth_error:
        raise RuntimeError(f"Google OAuth failed: {server.auth_error}")
    if not server.auth_code:
        raise TimeoutError(f"OAuth authorization timed out after {timeout_sec} seconds on {redirect_uri}")

    # Exchange authorization code for token bundle
    token_bundle = exchange_code_for_tokens(server.auth_code, client_id, client_secret, redirect_uri)
    token_bundle["client_id"] = client_id
    token_bundle["client_secret"] = client_secret
    token_bundle["requested_scopes"] = selected_scopes
    token_bundle["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    save_token_bundle(token_bundle)
    return token_bundle


def exchange_code_for_tokens(code: str, client_id: str, client_secret: str, redirect_uri: str) -> Dict[str, Any]:
    """Exchanges an OAuth code for access & refresh tokens."""
    data = urllib.parse.urlencode({
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }).encode("utf-8")

    req = urllib.request.Request(TOKEN_ENDPOINT, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        raise RuntimeError(f"Token exchange HTTP {e.code}: {err_msg}")


def refresh_access_token(token_bundle: Dict[str, Any]) -> Dict[str, Any]:
    """
    Uses grant_type=refresh_token to rotate/renew the access token without prompting the user.
    """
    refresh_token = token_bundle.get("refresh_token")
    if not refresh_token:
        raise ValueError("Cannot refresh access token: No refresh_token found in bundle.")

    client_id = token_bundle.get("client_id", DEFAULT_CLIENT_ID)
    client_secret = token_bundle.get("client_secret", DEFAULT_CLIENT_SECRET)

    data = urllib.parse.urlencode({
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token"
    }).encode("utf-8")

    req = urllib.request.Request(TOKEN_ENDPOINT, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            new_data = json.loads(resp.read().decode("utf-8"))
            token_bundle["access_token"] = new_data["access_token"]
            token_bundle["expires_in"] = new_data.get("expires_in", 3600)
            token_bundle["expiry_timestamp"] = int(time.time()) + token_bundle["expires_in"]
            token_bundle["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            save_token_bundle(token_bundle)
            return token_bundle
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        raise RuntimeError(f"Token refresh HTTP {e.code}: {err_msg}")


def load_token_bundle(auto_refresh: bool = True) -> Optional[Dict[str, Any]]:
    """
    Loads token bundle from disk. If expired and auto_refresh is True,
    refreshes access_token automatically.
    """
    path = get_token_storage_path()
    if not path.exists():
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

    # Check if access token is expired or expiring in next 60 seconds
    expiry = data.get("expiry_timestamp", 0)
    if auto_refresh and time.time() > (expiry - 60) and data.get("refresh_token"):
        try:
            data = refresh_access_token(data)
        except Exception as e:
            print(f"[OAuth Warning] Auto-refresh failed: {e}")

    return data


def save_token_bundle(token_bundle: Dict[str, Any]) -> Path:
    """Saves the bundle atomically to disk."""
    path = get_token_storage_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    if "expires_in" in token_bundle and "expiry_timestamp" not in token_bundle:
        token_bundle["expiry_timestamp"] = int(time.time()) + token_bundle["expires_in"]

    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(token_bundle, f, indent=2, ensure_ascii=False)
    tmp_path.replace(path)
    return path


def get_rclone_token_json(token_bundle: Dict[str, Any]) -> str:
    """
    Returns rclone.conf-compatible JSON string format for 'token = {...}'.
    """
    expiry_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(token_bundle.get("expiry_timestamp", time.time() + 3600)))
    rclone_dict = {
        "access_token": token_bundle.get("access_token"),
        "token_type": "Bearer",
        "refresh_token": token_bundle.get("refresh_token"),
        "expiry": expiry_str
    }
    return json.dumps(rclone_dict)


def export_rclone_headless_env(remote_name: str, token_bundle: Dict[str, Any]) -> Dict[str, str]:
    """
    Exports in-memory RCLONE_CONFIG_<REMOTE>_* variables for zero-disk-write rclone execution.
    """
    clean = remote_name.replace(":", "").upper().replace("-", "_")
    token_json = get_rclone_token_json(token_bundle)

    env = {
        f"RCLONE_CONFIG_{clean}_TYPE": "drive",
        f"RCLONE_CONFIG_{clean}_SCOPE": "drive.file",
        f"RCLONE_CONFIG_{clean}_TOKEN": token_json,
    }
    if token_bundle.get("client_id"):
        env[f"RCLONE_CONFIG_{clean}_CLIENT_ID"] = token_bundle["client_id"]
    if token_bundle.get("client_secret"):
        env[f"RCLONE_CONFIG_{clean}_CLIENT_SECRET"] = token_bundle["client_secret"]
    return env


# Module CLI execution
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AnyMD/Kittlibr/MBB Google OAuth Loopback & Token Manager")
    parser.add_argument("--auth", action="store_true", help="Run interactive 127.0.0.1 browser loopback auth")
    parser.add_argument("--refresh", action="store_true", help="Rotate access token using refresh_token")
    parser.add_argument("--status", action="store_true", help="Check current token status and scopes")
    parser.add_argument("--rclone-env", metavar="REMOTE", help="Print RCLONE_CONFIG_* env vars for given remote")
    parser.add_argument("--presets", nargs="+", default=["base", "drive_vault", "mbb_fitness"], help="Scope presets to request")

    args = parser.parse_args()

    if args.auth:
        scopes = resolve_scopes(args.presets)
        bundle = run_local_oauth_flow(scopes=scopes)
        print(f"Token saved to: {get_token_storage_path()}")
        print(f"Rclone Token JSON:\n{get_rclone_token_json(bundle)}")
    elif args.refresh:
        b = load_token_bundle(auto_refresh=False)
        if not b:
            print("No token bundle found to refresh.")
            sys.exit(1)
        refreshed = refresh_access_token(b)
        print(f"Token refreshed successfully. Expires in: {refreshed.get('expires_in')}s")
    elif args.rclone_env:
        b = load_token_bundle(auto_refresh=True)
        if not b:
            print("No token bundle found. Run with --auth first.")
            sys.exit(1)
        env_vars = export_rclone_headless_env(args.rclone_env, b)
        for k, v in env_vars.items():
            print(f"export {k}='{v}'")
    else:
        b = load_token_bundle(auto_refresh=True)
        if b:
            print(f"✅ Token bundle active at: {get_token_storage_path()}")
            print(f"  • Scopes authorized: {b.get('scope', b.get('requested_scopes'))}")
            exp_remaining = int(b.get("expiry_timestamp", 0) - time.time())
            print(f"  • Access token expires in: {exp_remaining} seconds (refresh_token present: {'yes' if 'refresh_token' in b else 'no'})")
        else:
            print(f"⚠️ No active token bundle at {get_token_storage_path()}. Run with --auth to initialize.")
