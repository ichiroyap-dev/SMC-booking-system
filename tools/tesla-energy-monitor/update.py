#!/usr/bin/env python3
"""Fetch Tesla energy live_status and update the SMC Google Sheet.

Usage:
  python3 update.py --dry-run
  python3 update.py --dry-run --fixture fixtures/live_status_redacted.json
  python3 update.py --quiet
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from parse import HEADERS, live_status_to_row, row_values
from tesla_client import TeslaAuthError, fetch_live_status

DEFAULT_SHEET_ID = "1wYslB5UNTLc_Cy3DsdD4Zly9ZmDDY_8qu3UfVvvm0WA"


def _load_env() -> None:
    if load_dotenv is None:
        return
    load_dotenv(TOOL_DIR / ".env")
    load_dotenv(Path.cwd() / ".env")


def _load_fixture(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"Fixture not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Fixture is not valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("Fixture JSON must be an object.")
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Update SMC Tesla energy monitor Google Sheet from Fleet live_status."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the snapshot row and skip Google Sheet writes.",
    )
    parser.add_argument(
        "--sheet-id",
        default=None,
        help="Google Sheet id (default: env TESLA_SHEET_ID or the SMC sheet).",
    )
    parser.add_argument(
        "--site-id",
        default=None,
        help="Tesla energy site id (default: env TESLA_ENERGY_SITE_ID or 水美土雞城).",
    )
    parser.add_argument(
        "--fixture",
        default=None,
        metavar="PATH",
        help="Use a local live_status JSON file instead of calling Tesla (for tests).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Print nothing on success (exit 0).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    _load_env()
    args = build_parser().parse_args(argv)

    if args.fixture:
        payload = _load_fixture(Path(args.fixture).expanduser())
    else:
        try:
            payload = fetch_live_status(site_id=args.site_id)
        except TeslaAuthError as exc:
            print(str(exc), file=sys.stderr)
            return 1

    row = live_status_to_row(payload)

    if args.dry_run:
        if not args.quiet:
            print("dry-run row:")
            for header, value in zip(HEADERS, row_values(row)):
                print(f"  {header}: {value}")
        return 0

    sheet_id = (
        args.sheet_id
        or os.environ.get("TESLA_SHEET_ID", "").strip()
        or DEFAULT_SHEET_ID
    )

    try:
        from sheets_client import SheetsError, write_snapshot
    except ImportError:
        print(
            "Google Sheets libraries missing. Run: pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 1

    try:
        write_snapshot(sheet_id, row)
    except SheetsError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # last-resort operator-friendly error; no token dumps
        print(f"Sheet write failed: {exc}", file=sys.stderr)
        return 1

    if not args.quiet:
        print(
            "Updated {time}  電量 {soc}%  太陽能 {solar} kW  負載 {load} kW  市電 {grid} ({direction})".format(
                time=row.get("時間 (Asia/Taipei)"),
                soc=row.get("電量%"),
                solar=row.get("太陽能kW"),
                load=row.get("負載kW"),
                grid=row.get("市電kW"),
                direction=row.get("市電方向"),
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
