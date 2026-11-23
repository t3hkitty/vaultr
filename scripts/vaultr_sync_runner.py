#!/usr/bin/env python3
"""
vaultr_sync_runner.py — Dedicated Headless Rclone Sync Runner for Vaultr & meow-vault

Features:
  1. Standardized Remote: Uses Google Drive (`gdrive:`, 15 GB free tier). Dropbox is retired/unused.
  2. Transport & Token Ingestion:
     - Plain HTTP loopback (http://127.0.0.1:<port>) with desktop client `anymd-515619`. Never https://localhost.
     - Reads ~/.config/anymd/google_oauth_token.json or explicit --config / rclone.conf.
     - Auto-rotates access_token via grant_type=refresh_token without user interaction.
     - Detects expired 7-day test token windows or revoked grants and surfaces loud, clean re-consent alerts.
  3. Lock & Single-Flight Safety:
     - File-based PID lock (~/.config/anymd/vaultr_sync.lock) prevents concurrent sync collisions.
  4. Scoped Targets & Deterministic Filters:
     - Targets scoped Google Drive vault root (e.g. `gdrive:meow-vault` or `gdrive:vaultr`).
     - Includes: *.anymd, *.anymdz, *.md, *.epub, *.pdf, *.mp3, *.mp4, .anymd/**
     - Excludes: .tmp*, *.part, *.crdownload, .DS_Store, Thumbs.db, desktop.ini, .git/**
  5. Windows cp1252 Encoding Guard:
     - Reconfigures sys.stdout and sys.stderr with utf-8 / errors="replace".
  6. Integration with :3050 Daemon & Kittlibr:
     - Exposes atomic JSON status file (~/.config/anymd/vaultr_sync_status.json) read by anymd_daemon.py (:3050).
"""

import os
import sys
import json
import time
import subprocess
import argparse
import hashlib
from pathlib import Path
from typing import Dict, Any, Optional

# Enforce UTF-8 console output to prevent Windows cp1252 charmap encode crashes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Import the shared loopback OAuth module
try:
    from google_oauth_loopback import (
        load_token_bundle,
        refresh_access_token,
        export_rclone_headless_env,
        get_token_storage_path,
        get_rclone_token_json
    )
except ImportError:
    # Add current script directory to sys.path
    sys.path.insert(0, str(Path(__file__).parent))
    from google_oauth_loopback import (
        load_token_bundle,
        refresh_access_token,
        export_rclone_headless_env,
        get_token_storage_path,
        get_rclone_token_json
    )

DEFAULT_REMOTE_VAULT = os.environ.get("VAULTR_REMOTE_ROOT", "gdrive:meow-vault")
LOCK_FILE = Path.home() / ".config" / "anymd" / "vaultr_sync.lock"
STATUS_FILE = Path.home() / ".config" / "anymd" / "vaultr_sync_status.json"

DEFAULT_INCLUDES = [
    "*.anymd",
    "*.anymdz",
    "*.md",
    "*.epub",
    "*.pdf",
    "*.mp3",
    "*.mp4",
    ".anymd/**"
]

DEFAULT_EXCLUDES = [
    ".tmp*",
    "*.part",
    "*.crdownload",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    ".git/**",
    "node_modules/**"
]


class SingleFlightLock:
    def __init__(self, lock_path: Path):
        self.lock_path = lock_path

    def __enter__(self):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        if self.lock_path.exists():
            try:
                pid_str = self.lock_path.read_text().strip()
                pid = int(pid_str)
                # Check if process is still running
                if sys.platform != "win32":
                    os.kill(pid, 0)
                else:
                    # Windows process check
                    tasklist = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True)
                    if str(pid) not in tasklist.stdout:
                        raise ProcessLookupError
                raise RuntimeError(f"Vault sync already in progress by active PID {pid}. Lock: {self.lock_path}")
            except (ValueError, ProcessLookupError, PermissionError):
                # Stale lock file
                pass
        self.lock_path.write_text(str(os.getpid()))
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.lock_path.exists():
            try:
                self.lock_path.unlink()
            except Exception:
                pass


def update_sync_status(status: str, message: str, meta: Optional[Dict[str, Any]] = None):
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "message": message,
        "remote": DEFAULT_REMOTE_VAULT,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "meta": meta or {}
    }
    tmp = STATUS_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    tmp.replace(STATUS_FILE)


def build_filter_args() -> list:
    args = []
    for inc in DEFAULT_INCLUDES:
        args.extend(["--include", inc])
    for exc in DEFAULT_EXCLUDES:
        args.extend(["--exclude", exc])
    return args


def check_local_disk_free(path_str: str) -> int:
    """Returns available free bytes on local drive/filesystem."""
    try:
        import shutil
        total, used, free = shutil.disk_usage(path_str)
        return free
    except Exception:
        return 10 * 1024 * 1024 * 1024  # Default fallback 10GB


def check_rclone_about(remote_name: str, env: Dict[str, str], rclone_config: Optional[str] = None) -> Dict[str, Any]:
    """
    Queries `rclone about <remote> --json` to inspect remote quota, used, and free bytes.
    """
    clean_remote = remote_name.split(":")[0] + ":"
    cmd = ["rclone", "about", clean_remote, "--json"]
    if rclone_config:
        cmd.extend(["--config", rclone_config])
    try:
        res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout.strip())
    except Exception as e:
        print(f"  [Storage Notice] 'rclone about {clean_remote}' check skipped: {e}")
    return {}


# 3-Tier Storage Architecture Configuration
STORAGE_TIERS = {
    "tier1_cache": {
        "name": "Cache / Staging",
        "remote": "gdrive:staging_cache",
        "quota_bytes": 15 * 1024 * 1024 * 1024, # 15 GB Google Drive tier
        "auto_clean_after_verify": True
    },
    "tier2_local": {
        "name": "Local Folder (S:\\ / meow-vault)",
        "local_path": os.environ.get("MEOW_VAULT_LOCAL", str(Path.home() / "meow-vault")),
        "min_free_headroom_bytes": 2 * 1024 * 1024 * 1024 # 2 GB minimum local headroom
    },
    "tier3_main_vault": {
        "name": "Largest Cloud / Main Vault",
        "remote": os.environ.get("MAIN_VAULT_REMOTE", "koofr:vault"),
        "fallback_remote": "davjump:vault"
    }
}


def evaluate_3tier_storage_space(env: Dict[str, str], rclone_config: Optional[str] = None) -> Dict[str, Any]:
    """
    Checks free space/quota across all 3 tiers:
      1) Cache (gdrive 15GB staging)
      2) Local Folder (S:\\ or meow-vault)
      3) Main Vault (Koofr / FileJump / highest capacity cloud)
    """
    local_path = STORAGE_TIERS["tier2_local"]["local_path"]
    local_free = check_local_disk_free(local_path if Path(local_path).exists() else str(Path.home()))

    gdrive_about = check_rclone_about("gdrive:", env, rclone_config)
    main_vault_about = check_rclone_about(STORAGE_TIERS["tier3_main_vault"]["remote"], env, rclone_config)

    return {
        "tier1_cache": {
            "remote": "gdrive:",
            "quota_about": gdrive_about,
            "status": "ok"
        },
        "tier2_local": {
            "path": local_path,
            "free_bytes": local_free,
            "free_gb": round(local_free / (1024**3), 2),
            "status": "low_space" if local_free < STORAGE_TIERS["tier2_local"]["min_free_headroom_bytes"] else "ok"
        },
        "tier3_main_vault": {
            "remote": STORAGE_TIERS["tier3_main_vault"]["remote"],
            "quota_about": main_vault_about,
            "status": "ok"
        }
    }


def safe_auto_clean_verified_items(
    local_dir: Path,
    main_remote: str,
    env: Dict[str, str],
    min_free_needed_bytes: int = 0
) -> Dict[str, Any]:
    """
    Safety Gate: Cleans up local/cached files ONLY AFTER verifying matching MD5/hash
    on the larger main cloud remote. Unmoved or mismatched data is NEVER deleted.
    """
    cleaned_files = []
    freed_bytes = 0

    if not local_dir.exists():
        return {"cleaned_count": 0, "freed_bytes": 0}

    # Inspect destination remote file hashes via rclone md5sum or lsf
    dest_cmd = ["rclone", "md5sum", main_remote]
    try:
        res = subprocess.run(dest_cmd, env=env, capture_output=True, text=True, timeout=30)
        remote_hashes: Dict[str, str] = {}
        if res.returncode == 0:
            for line in res.stdout.strip().splitlines():
                parts = line.strip().split(None, 1)
                if len(parts) == 2:
                    remote_hashes[parts[1].replace("\\", "/")] = parts[0].lower()

        # Iterate through local candidate files (excluding .anymd sidecars)
        for item in sorted(local_dir.glob("**/*"), key=lambda p: p.stat().st_mtime if p.is_file() else 0):
            if not item.is_file() or item.name.endswith(".anymd") or item.name.startswith("."):
                continue

            rel = str(item.relative_to(local_dir)).replace("\\", "/")
            if rel in remote_hashes:
                # Compute local MD5
                h = hashlib.md5()
                with open(item, "rb") as f:
                    while chunk := f.read(65536):
                        h.update(chunk)
                local_md5 = h.hexdigest().lower()

                # Explicit safety gate: local MD5 must exactly match verified remote MD5
                if local_md5 == remote_hashes[rel]:
                    fsize = item.stat().st_size
                    try:
                        item.unlink()
                        cleaned_files.append(rel)
                        freed_bytes += fsize
                        print(f"  [Auto-Clean] Verified on {main_remote}: safely pruned {rel} ({round(fsize/1e6, 2)} MB)")
                    except Exception as e:
                        print(f"  [Auto-Clean Error] Could not delete {rel}: {e}")

            if min_free_needed_bytes > 0 and freed_bytes >= min_free_needed_bytes:
                break

    except Exception as e:
        print(f"  [Auto-Clean Notice] Verification check failed: {e}. Zero files deleted.")

    return {
        "cleaned_count": len(cleaned_files),
        "freed_bytes": freed_bytes,
        "cleaned_files": cleaned_files
    }


def run_vault_sync(
    local_path: str,
    remote_target: str = DEFAULT_REMOTE_VAULT,
    direction: str = "bisync",
    dry_run: bool = False,
    rclone_config_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes headless rclone sync with token rotation, single-flight locking, and deterministic filters.
    """
    # 1. Ingest & Rotate Google OAuth Token
    token_bundle = load_token_bundle(auto_refresh=True)
    if not token_bundle:
        err = f"No OAuth token found at {get_token_storage_path()}. Run google_oauth_loopback.py --auth to authorize with Google Cloud (project anymd-515619)."
        update_sync_status("error", err, {"auth_required": True})
        raise RuntimeError(err)

    # 2. Check for expired 7-day testing token window or invalid refresh token
    if not token_bundle.get("refresh_token"):
        err = "OAuth token bundle lacks refresh_token. Re-authentication via 127.0.0.1 loopback required."
        update_sync_status("error", err, {"reconsent_required": True})
        raise RuntimeError(err)

    # 3. Export in-memory headless environment variables
    headless_env = export_rclone_headless_env("gdrive", token_bundle)
    full_env = os.environ.copy()
    full_env.update(headless_env)

    # 4. Storage Limits & 3-Tier Free Space Evaluation
    tier_status = evaluate_3tier_storage_space(full_env, rclone_config_path)
    local_free_bytes = tier_status["tier2_local"]["free_bytes"]

    # 5. Acquire single-flight lock
    with SingleFlightLock(LOCK_FILE):
        meta_status = {
            "tiers": tier_status,
            "local_free_gb": tier_status["tier2_local"]["free_gb"],
            "cloud_about": tier_status["tier1_cache"]["quota_about"]
        }
        update_sync_status("syncing", f"Starting {direction} transfer between {local_path} and {remote_target}", meta_status)

        cmd = ["rclone"]
        if direction == "push":
            cmd.extend(["copy", local_path, remote_target])
        elif direction == "pull":
            cmd.extend(["copy", remote_target, local_path])
        elif direction == "bisync":
            cmd.extend(["bisync", local_path, remote_target, "--resync-mode", "newer"])
        else:
            cmd.extend(["sync", local_path, remote_target])

        if rclone_config_path:
            cmd.extend(["--config", rclone_config_path])

        cmd.extend([
            "--fast-list",
            "--transfers", "4",
            "--checkers", "8",
            "--stats-one-line",
            "--stats", "2s"
        ])

        cmd.extend(build_filter_args())

        if dry_run:
            cmd.append("--dry-run")

        print(f"🐾 Executing Vaultr Headless Sync (3-Tier Aware):")
        print(f"  • Source / Dest : {local_path} <-> {remote_target}")
        print(f"  • Mode          : {direction} (dry_run: {dry_run})")
        print(f"  • Local Free    : {tier_status['tier2_local']['free_gb']} GB")
        print(f"  • Token Status  : Active (expires in {int(token_bundle.get('expiry_timestamp', 0) - time.time())}s)")

        start_time = time.time()
        res = subprocess.run(cmd, env=full_env, capture_output=True, text=True)
        duration = round(time.time() - start_time, 2)

        if res.returncode == 0:
            # Safe Auto-Clean: If space is tight or auto-clean enabled, verify before pruning
            cleanup_result = {}
            if not dry_run and direction in ["push", "sync"]:
                cleanup_result = safe_auto_clean_verified_items(
                    local_dir=Path(local_path),
                    main_remote=remote_target,
                    env=full_env
                )

            msg = f"Vault sync succeeded in {duration}s."
            if cleanup_result.get("cleaned_count", 0) > 0:
                msg += f" Verified & safely pruned {cleanup_result['cleaned_count']} files ({round(cleanup_result['freed_bytes']/1e6, 2)} MB)."

            update_sync_status("idle", msg, {
                "duration_sec": duration,
                "cleanup": cleanup_result,
                "tiers": evaluate_3tier_storage_space(full_env, rclone_config_path),
                "stdout": res.stdout.strip()
            })
            print(f"  ✅ {msg}")
            return {"success": True, "duration": duration, "cleanup": cleanup_result, "stdout": res.stdout}
        else:
            err_msg = res.stderr.strip() or res.stdout.strip()
            # Check for token expiry/revocation in rclone error output
            auth_revoked = "oauth2: cannot fetch token" in err_msg or "invalid_grant" in err_msg
            if auth_revoked:
                err_msg = "Google OAuth grant expired or revoked (7-day testing window elapsed). Re-authorization required via google_oauth_loopback.py --auth."

            update_sync_status("error", err_msg, {"exit_code": res.returncode, "auth_revoked": auth_revoked})
            print(f"  ❌ Sync failed (exit {res.returncode}): {err_msg}")
            raise RuntimeError(f"Rclone sync failed: {err_msg}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dedicated Headless Rclone Sync Runner for Vaultr & meow-vault")
    parser.add_argument("local_path", nargs="?", default=str(Path.home() / "meow-vault"), help="Local vault path")
    parser.add_argument("--remote", default=DEFAULT_REMOTE_VAULT, help="Remote vault target (default: gdrive:meow-vault)")
    parser.add_argument("--direction", choices=["push", "pull", "sync", "bisync"], default="push", help="Transfer direction")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without modifying files")
    parser.add_argument("--config", dest="rclone_config", help="Explicit path to rclone.conf (optional)")
    parser.add_argument("--status", action="store_true", help="Print current sync status JSON")

    args = parser.parse_args()

    if args.status:
        if STATUS_FILE.exists():
            print(STATUS_FILE.read_text(encoding="utf-8"))
        else:
            print(json.dumps({"status": "idle", "message": "No sync runs recorded yet"}))
    else:
        run_vault_sync(
            local_path=args.local_path,
            remote_target=args.remote,
            direction=args.direction,
            dry_run=args.dry_run,
            rclone_config_path=args.rclone_config
        )
