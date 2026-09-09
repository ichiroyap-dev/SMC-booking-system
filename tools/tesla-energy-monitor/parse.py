"""Parse Tesla energy_sites live_status into a spreadsheet row.

Tesla returns power in watts. Sheet values are kW (2 decimals) and percent
(1 decimal). Time is always shown in Asia/Taipei.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")

# Treat tiny power as flat so the 市電方向 column does not flicker.
GRID_DEADBAND_W = 50.0
BATTERY_DEADBAND_W = 50.0

LIVE_TAB = "即時現況"
HISTORY_TAB = "歷史紀錄"
GUIDE_TAB = "說明"

HEADERS = [
    "時間 (Asia/Taipei)",
    "電量%",
    "太陽能kW",
    "負載kW",
    "電池充放電kW",
    "市電kW",
    "市電方向",
    "island/grid_status",
    "備註",
]

DIRECTION_BUY = "買電"
DIRECTION_SELL = "賣電"
DIRECTION_FLAT = "持平"


def unwrap_live_status(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    """Accept either `{response: {...}}` or a bare live_status object."""
    if not payload:
        return {}
    inner = payload.get("response")
    if isinstance(inner, Mapping):
        return dict(inner)
    return dict(payload)


def watts_to_kw(watts: Any, decimals: int = 2) -> float | None:
    if watts is None or watts == "":
        return None
    try:
        value = float(watts) / 1000.0
    except (TypeError, ValueError):
        return None
    return round(value, decimals)


def round_percent(value: Any, decimals: int = 1) -> float | None:
    if value is None or value == "":
        return None
    try:
        return round(float(value), decimals)
    except (TypeError, ValueError):
        return None


def grid_direction(grid_watts: Any, deadband_w: float = GRID_DEADBAND_W) -> str:
    """Positive grid_power = importing (買電); negative = exporting (賣電)."""
    try:
        watts = float(grid_watts)
    except (TypeError, ValueError):
        return ""
    if abs(watts) <= deadband_w:
        return DIRECTION_FLAT
    if watts > 0:
        return DIRECTION_BUY
    return DIRECTION_SELL


def battery_verb(battery_watts: Any, deadband_w: float = BATTERY_DEADBAND_W) -> str:
    """Positive battery_power = discharging; negative = charging."""
    try:
        watts = float(battery_watts)
    except (TypeError, ValueError):
        return ""
    if abs(watts) <= deadband_w:
        return "持平"
    if watts > 0:
        return "放電"
    return "充電"


def _parse_tesla_timestamp(raw: Any) -> datetime | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        seconds = float(raw)
        if seconds > 1e12:
            seconds = seconds / 1000.0
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    text = str(raw).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def taipei_time_str(tesla_timestamp: Any = None, now: datetime | None = None) -> str:
    parsed = _parse_tesla_timestamp(tesla_timestamp)
    if parsed is None:
        parsed = now or datetime.now(tz=TAIPEI)
    return parsed.astimezone(TAIPEI).strftime("%Y-%m-%d %H:%M:%S")


def format_island_grid(status: Mapping[str, Any]) -> str:
    island = status.get("island_status") or ""
    grid = status.get("grid_status") or ""
    island_s = str(island).strip()
    grid_s = str(grid).strip()
    if island_s and grid_s:
        return f"{island_s} / {grid_s}"
    return island_s or grid_s


def build_notes(status: Mapping[str, Any]) -> str:
    parts: list[str] = []
    verb = battery_verb(status.get("battery_power"))
    kw = watts_to_kw(status.get("battery_power"))
    if verb == "持平":
        parts.append("電池持平")
    elif verb and kw is not None:
        parts.append(f"電池{verb} {abs(kw):.2f} kW")

    if status.get("storm_mode_active"):
        parts.append("Storm Mode 開啟")

    island = str(status.get("island_status") or "")
    if island and island not in ("on_grid", "island_status_unknown"):
        parts.append(f"island={island}")

    if status.get("grid_services_active"):
        parts.append("grid services 運作中")

    return "；".join(parts)


def live_status_to_row(
    payload: Mapping[str, Any] | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    status = unwrap_live_status(payload)
    return {
        "時間 (Asia/Taipei)": taipei_time_str(status.get("timestamp"), now=now),
        "電量%": round_percent(status.get("percentage_charged")),
        "太陽能kW": watts_to_kw(status.get("solar_power")),
        "負載kW": watts_to_kw(status.get("load_power")),
        "電池充放電kW": watts_to_kw(status.get("battery_power")),
        "市電kW": watts_to_kw(status.get("grid_power")),
        "市電方向": grid_direction(status.get("grid_power")),
        "island/grid_status": format_island_grid(status),
        "備註": build_notes(status),
    }


def row_values(row: Mapping[str, Any]) -> list[Any]:
    return [row.get(header, "") for header in HEADERS]
