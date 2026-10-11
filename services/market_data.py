"""Optional data-provider adapters.

No provider is assumed. With no configured endpoint/API key every response is
explicitly marked as demo. A production deployment can point these generic
adapters to the licensed provider selected by the product owner.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import requests


def configured() -> bool:
    return bool(os.getenv("MARKET_DATA_API_URL") or os.getenv("ECONOMIC_CALENDAR_API_URL"))


def fetch_json(url_env: str, key_env: str) -> list[dict[str, Any]] | None:
    url = os.getenv(url_env, "").strip()
    if not url:
        return None
    headers = {"Accept": "application/json"}
    key = os.getenv(key_env, "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        payload = requests.get(url, headers=headers, timeout=12).json()
        return payload if isinstance(payload, list) else payload.get("data", [])
    except (requests.RequestException, ValueError, AttributeError):
        return None


def quote_snapshot() -> dict[str, Any]:
    """Return status only; a licensed quote adapter must be configured for live prices."""
    return {
        "is_live": bool(os.getenv("MARKET_DATA_API_URL")),
        "source": "configured-provider" if os.getenv("MARKET_DATA_API_URL") else "DEMO",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "message": "Live quote connector configured" if os.getenv("MARKET_DATA_API_URL") else "No market-data provider configured; quote inputs remain user supplied.",
    }
