from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tesla_client import (  # noqa: E402
    TeslaAuthError,
    access_token_expired,
    load_tokens,
    save_tokens,
)


class TokenExpiryTests(unittest.TestCase):
    def test_expired_with_skew(self) -> None:
        now = 1_000_000.0
        self.assertTrue(access_token_expired({"expires_at": now}, now=now))
        self.assertTrue(access_token_expired({"expires_at": now + 30}, now=now))
        self.assertFalse(access_token_expired({"expires_at": now + 120}, now=now))

    def test_missing_expiry_is_not_expired(self) -> None:
        self.assertFalse(access_token_expired({}))
        self.assertFalse(access_token_expired({"expires_at": ""}))


class TokenFileTests(unittest.TestCase):
    def test_load_and_save_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tesla-tokens.json"
            env = {
                "TESLA_TOKENS_JSON": str(path),
                "TESLA_ACCESS_TOKEN": "",
                "TESLA_REFRESH_TOKEN": "",
            }
            with mock.patch.dict(os.environ, env, clear=False):
                path.write_text(
                    json.dumps(
                        {
                            "access_token": "access-placeholder",
                            "refresh_token": "refresh-placeholder",
                            "expires_at": 1,
                        }
                    ),
                    encoding="utf-8",
                )
                loaded = load_tokens()
                self.assertEqual(loaded["access_token"], "access-placeholder")
                loaded["access_token"] = "rotated-access"
                loaded["refresh_token"] = "rotated-refresh"
                loaded["expires_in"] = 10
                loaded["expires_at"] = int(time.time()) + 10
                save_tokens(loaded)
                on_disk = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(on_disk["access_token"], "rotated-access")
                self.assertNotIn("paste-", on_disk["refresh_token"])

    def test_env_overrides_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tesla-tokens.json"
            path.write_text(
                json.dumps({"access_token": "from-file", "refresh_token": "from-file"}),
                encoding="utf-8",
            )
            env = {
                "TESLA_TOKENS_JSON": str(path),
                "TESLA_ACCESS_TOKEN": "from-env",
                "TESLA_REFRESH_TOKEN": "from-env-refresh",
            }
            with mock.patch.dict(os.environ, env, clear=False):
                loaded = load_tokens()
                self.assertEqual(loaded["access_token"], "from-env")
                self.assertEqual(loaded["refresh_token"], "from-env-refresh")

    def test_missing_json_path_raises(self) -> None:
        env = {"TESLA_TOKENS_JSON": "/tmp/does-not-exist-smc-tesla-tokens.json"}
        with mock.patch.dict(os.environ, env, clear=False):
            with self.assertRaises(TeslaAuthError):
                load_tokens()


if __name__ == "__main__":
    unittest.main()
