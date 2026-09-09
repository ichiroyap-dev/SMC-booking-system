"""Tesla Fleet API client: load tokens, refresh when needed, one live_status GET."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

DEFAULT_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com"
DEFAULT_TOKEN_URL = "https://auth.tesla.com/oauth2/v3/token"
DEFAULT_SITE_ID = "2534007359185439"
USER_AGENT = "smc-tesla-energy-monitor/1.0"
REFRESH_SKEW_SECONDS = 60
HTTP_TIMEOUT = 30


class TeslaAuthError(RuntimeError):
    """Token missing, refresh failed, or Fleet API rejected the access token."""


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip()


def tokens_json_path() -> Path | None:
    raw = _env("TESLA_TOKENS_JSON")
    if not raw:
        return None
    return Path(raw).expanduser()


def load_tokens() -> dict[str, Any]:
    """Load tokens from TESLA_TOKENS_JSON and/or env. Env wins on overlap."""
    tokens: dict[str, Any] = {}
    path = tokens_json_path()
    if path:
        if not path.is_file():
            raise TeslaAuthError(f"TESLA_TOKENS_JSON not found: {path}")
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise TeslaAuthError(f"TESLA_TOKENS_JSON is not valid JSON: {path}") from exc
        if isinstance(loaded, dict):
            tokens.update(loaded)

    access = _env("TESLA_ACCESS_TOKEN")
    refresh = _env("TESLA_REFRESH_TOKEN")
    if access:
        tokens["access_token"] = access
    if refresh:
        tokens["refresh_token"] = refresh
    return tokens


def save_tokens(tokens: dict[str, Any]) -> None:
    """Persist rotated tokens when TESLA_TOKENS_JSON is set. Never logs secrets."""
    path = tokens_json_path()
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "access_token": tokens.get("access_token", ""),
        "refresh_token": tokens.get("refresh_token", ""),
        "expires_in": tokens.get("expires_in", 0),
        "expires_at": tokens.get("expires_at", 0),
        "token_type": tokens.get("token_type", "Bearer"),
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def access_token_expired(tokens: dict[str, Any], now: float | None = None) -> bool:
    expires_at = tokens.get("expires_at")
    if not expires_at:
        return False
    try:
        expiry = float(expires_at)
    except (TypeError, ValueError):
        return False
    current = time.time() if now is None else now
    return expiry <= (current + REFRESH_SKEW_SECONDS)


def refresh_access_token(tokens: dict[str, Any]) -> dict[str, Any]:
    client_id = _env("TESLA_FLEET_CLIENT_ID")
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not client_id:
        raise TeslaAuthError("TESLA_FLEET_CLIENT_ID is required to refresh the access token.")
    if not refresh_token:
        raise TeslaAuthError("No refresh_token available. Set TESLA_REFRESH_TOKEN or TESLA_TOKENS_JSON.")

    token_url = _env("TESLA_TOKEN_URL", DEFAULT_TOKEN_URL)
    body: dict[str, str] = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }
    secret = _env("TESLA_FLEET_CLIENT_SECRET")
    if secret:
        body["client_secret"] = secret

    try:
        response = requests.post(
            token_url,
            data=body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
            timeout=HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise TeslaAuthError(f"Token refresh request failed: {exc}") from exc

    if response.status_code >= 400:
        raise TeslaAuthError(
            f"Token refresh failed HTTP {response.status_code}. "
            "Check client id / refresh token, or set TESLA_TOKEN_URL to "
            "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise TeslaAuthError("Token refresh returned non-JSON.") from exc

    access = data.get("access_token")
    if not access:
        raise TeslaAuthError("Token refresh response missing access_token.")

    merged = dict(tokens)
    merged["access_token"] = access
    if data.get("refresh_token"):
        merged["refresh_token"] = data["refresh_token"]
    if data.get("token_type"):
        merged["token_type"] = data["token_type"]
    expires_in = data.get("expires_in")
    if expires_in:
        try:
            seconds = int(expires_in)
        except (TypeError, ValueError):
            seconds = 0
        merged["expires_in"] = seconds
        if seconds:
            merged["expires_at"] = int(time.time()) + seconds
    save_tokens(merged)
    if tokens_json_path() is None:
        print(
            "Warning: Tesla refresh token rotated but TESLA_TOKENS_JSON is unset, "
            "so the new token was not saved to disk.",
            file=sys.stderr,
        )
    return merged


def _auth_header(tokens: dict[str, Any]) -> dict[str, str]:
    access = str(tokens.get("access_token") or "").strip()
    if not access:
        raise TeslaAuthError(
            "No access_token. Set TESLA_ACCESS_TOKEN or TESLA_TOKENS_JSON."
        )
    token_type = str(tokens.get("token_type") or "Bearer")
    return {
        "Authorization": f"{token_type} {access}",
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }


def fetch_live_status(
    site_id: str | None = None,
    tokens: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """GET /api/1/energy_sites/{id}/live_status. One call per successful run."""
    site = (site_id or _env("TESLA_ENERGY_SITE_ID", DEFAULT_SITE_ID)).strip()
    if not site:
        raise TeslaAuthError("Energy site id is empty.")

    current = tokens if tokens is not None else load_tokens()
    if current.get("refresh_token") and (
        not current.get("access_token") or access_token_expired(current)
    ):
        current = refresh_access_token(current)

    api_base = _env("TESLA_FLEET_API_BASE", DEFAULT_API_BASE).rstrip("/")
    url = f"{api_base}/api/1/energy_sites/{site}/live_status"

    def _get(auth_tokens: dict[str, Any]) -> requests.Response:
        return requests.get(url, headers=_auth_header(auth_tokens), timeout=HTTP_TIMEOUT)

    try:
        response = _get(current)
    except requests.RequestException as exc:
        raise TeslaAuthError(f"live_status request failed: {exc}") from exc

    if response.status_code in (401, 403) and current.get("refresh_token"):
        current = refresh_access_token(current)
        try:
            response = _get(current)
        except requests.RequestException as exc:
            raise TeslaAuthError(f"live_status retry failed: {exc}") from exc

    if response.status_code >= 400:
        raise TeslaAuthError(
            f"live_status failed HTTP {response.status_code} for site {site}."
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise TeslaAuthError("live_status returned non-JSON.") from exc

    if not isinstance(payload, dict):
        raise TeslaAuthError("live_status JSON was not an object.")
    return payload
