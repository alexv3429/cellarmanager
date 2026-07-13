#!/usr/bin/env python3
"""Create a consistent, integrity-checked backup of the CellarManager SQLite DB.

Run from the ``backend`` directory:

    python3 scripts/backup_db.py

The default source is ``WINECELLAR_DB_PATH`` and the default destination is a
``backups/`` directory next to that database. SQLite's online backup API is used
so the application may remain running, although a quiet maintenance window is
still preferable before a major upgrade.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path


def default_source() -> Path:
    configured = os.environ.get("WINECELLAR_DB_PATH")
    if configured:
        return Path(configured).expanduser()
    try:
        from app import config

        return Path(config.DATABASE_PATH).expanduser()
    except Exception:
        return Path("data/winecellar.db")


def default_destination(source: Path) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    suffix = source.suffix or ".db"
    return source.parent / "backups" / f"{source.stem}-{timestamp}{suffix}"


def create_backup(source: Path, destination: Path | None = None) -> Path:
    source = source.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Database file not found: {source}")

    destination = (destination or default_destination(source)).expanduser().resolve()
    if destination == source:
        raise ValueError("Backup destination must differ from the source database")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.unlink(missing_ok=True)

    source_uri = f"file:{source.as_posix()}?mode=ro"
    try:
        with closing(sqlite3.connect(source_uri, uri=True)) as source_conn:
            with closing(sqlite3.connect(temporary)) as backup_conn:
                source_conn.backup(backup_conn)
                result = backup_conn.execute("PRAGMA integrity_check").fetchone()
                if not result or result[0] != "ok":
                    raise RuntimeError(
                        f"Backup integrity check failed: {result[0] if result else 'no result'}"
                    )
                backup_conn.commit()
        os.chmod(temporary, 0o600)
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=default_source(),
        help="SQLite database path (defaults to WINECELLAR_DB_PATH)",
    )
    parser.add_argument(
        "--destination",
        type=Path,
        help="Output file; defaults to a timestamped file under <db>/backups",
    )
    args = parser.parse_args()

    try:
        destination = create_backup(args.source, args.destination)
    except Exception as exc:
        parser.exit(1, f"Backup failed: {exc}\n")
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
