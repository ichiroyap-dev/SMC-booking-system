from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from parse import (  # noqa: E402
    DIRECTION_BUY,
    DIRECTION_FLAT,
    DIRECTION_SELL,
    HEADERS,
    TAIPEI,
    battery_verb,
    grid_direction,
    live_status_to_row,
    row_values,
    taipei_time_str,
    unwrap_live_status,
    watts_to_kw,
)

FIXTURE = ROOT / "fixtures" / "live_status_redacted.json"


class WattsAndDirectionTests(unittest.TestCase):
    def test_watts_to_kw_two_decimals(self) -> None:
        self.assertEqual(watts_to_kw(18240), 18.24)
        self.assertEqual(watts_to_kw(-2650), -2.65)
        self.assertEqual(watts_to_kw(0), 0.0)
        self.assertIsNone(watts_to_kw(None))

    def test_grid_direction_buy_sell_flat(self) -> None:
        self.assertEqual(grid_direction(2500), DIRECTION_BUY)
        self.assertEqual(grid_direction(-2650), DIRECTION_SELL)
        self.assertEqual(grid_direction(20), DIRECTION_FLAT)
        self.assertEqual(grid_direction(-20), DIRECTION_FLAT)
        self.assertEqual(grid_direction(0), DIRECTION_FLAT)

    def test_battery_verb(self) -> None:
        self.assertEqual(battery_verb(-3180), "充電")
        self.assertEqual(battery_verb(970), "放電")
        self.assertEqual(battery_verb(10), "持平")


class UnwrapAndTimestampTests(unittest.TestCase):
    def test_unwrap_nested_or_bare(self) -> None:
        nested = {"response": {"solar_power": 1}}
        self.assertEqual(unwrap_live_status(nested)["solar_power"], 1)
        self.assertEqual(unwrap_live_status({"solar_power": 2})["solar_power"], 2)

    def test_taipei_from_iso_with_offset(self) -> None:
        self.assertEqual(taipei_time_str("2026-09-09T11:42:00+08:00"), "2026-09-09 11:42:00")

    def test_taipei_from_utc_z(self) -> None:
        self.assertEqual(taipei_time_str("2026-09-09T03:42:00Z"), "2026-09-09 11:42:00")

    def test_taipei_from_unix_seconds(self) -> None:
        # 2026-09-09 11:42:00 +08
        self.assertEqual(taipei_time_str(1788925320), "2026-09-09 11:42:00")

    def test_missing_timestamp_uses_now(self) -> None:
        now = datetime(2026, 9, 9, 18, 0, 0, tzinfo=TAIPEI)
        self.assertEqual(taipei_time_str(None, now=now), "2026-09-09 18:00:00")


class FixtureRowTests(unittest.TestCase):
    def test_redacted_lunch_export_row(self) -> None:
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        row = live_status_to_row(payload)
        self.assertEqual(row["時間 (Asia/Taipei)"], "2026-09-09 11:42:00")
        self.assertEqual(row["電量%"], 86.4)
        self.assertEqual(row["太陽能kW"], 18.24)
        self.assertEqual(row["負載kW"], 12.41)
        self.assertEqual(row["電池充放電kW"], -3.18)
        self.assertEqual(row["市電kW"], -2.65)
        self.assertEqual(row["市電方向"], DIRECTION_SELL)
        self.assertEqual(row["island/grid_status"], "on_grid / Active")
        self.assertIn("電池充電 3.18 kW", row["備註"])
        values = row_values(row)
        self.assertEqual(len(values), len(HEADERS))
        self.assertEqual(len(HEADERS), 9)

    def test_night_import_and_discharge(self) -> None:
        payload = {
            "response": {
                "solar_power": 0,
                "percentage_charged": 41.2,
                "battery_power": 6500,
                "load_power": 9000,
                "grid_power": 2500,
                "grid_status": "Active",
                "island_status": "on_grid",
                "timestamp": "2026-09-09T20:15:00+08:00",
            }
        }
        row = live_status_to_row(payload)
        self.assertEqual(row["太陽能kW"], 0.0)
        self.assertEqual(row["負載kW"], 9.0)
        self.assertEqual(row["電池充放電kW"], 6.5)
        self.assertEqual(row["市電kW"], 2.5)
        self.assertEqual(row["市電方向"], DIRECTION_BUY)
        self.assertIn("電池放電 6.50 kW", row["備註"])

    def test_off_grid_note(self) -> None:
        row = live_status_to_row(
            {
                "solar_power": 0,
                "percentage_charged": 55,
                "battery_power": 4000,
                "load_power": 4000,
                "grid_power": 0,
                "grid_status": "Inactive",
                "island_status": "off_grid",
                "storm_mode_active": True,
                "timestamp": "2026-09-09T02:00:00+08:00",
            }
        )
        self.assertEqual(row["市電方向"], DIRECTION_FLAT)
        self.assertEqual(row["island/grid_status"], "off_grid / Inactive")
        self.assertIn("Storm Mode 開啟", row["備註"])
        self.assertIn("island=off_grid", row["備註"])


if __name__ == "__main__":
    unittest.main()
