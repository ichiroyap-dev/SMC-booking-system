from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPDATE = ROOT / "update.py"
FIXTURE = ROOT / "fixtures" / "live_status_redacted.json"


class CliDryRunTests(unittest.TestCase):
    def test_dry_run_fixture_prints_row(self) -> None:
        result = subprocess.run(
            [sys.executable, str(UPDATE), "--dry-run", "--fixture", str(FIXTURE)],
            check=False,
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("dry-run row:", result.stdout)
        self.assertIn("賣電", result.stdout)
        self.assertIn("86.4", result.stdout)
        self.assertIn("18.24", result.stdout)
        self.assertNotIn("access_token", result.stdout.lower())
        self.assertNotIn("refresh_token", result.stdout.lower())

    def test_quiet_success_is_silent(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(UPDATE),
                "--dry-run",
                "--quiet",
                "--fixture",
                str(FIXTURE),
            ],
            check=False,
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
