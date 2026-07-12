"""Shared test helpers."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.storage.database import Database  # noqa: E402


class DatabaseTestCase(unittest.TestCase):
    """Base class that gives each test a fresh in-memory database."""

    def setUp(self) -> None:
        self.db = Database(":memory:")
        self.conn = self.db.connect()

    def tearDown(self) -> None:
        self.db.close_all()
