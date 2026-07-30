#!/usr/bin/env python3
"""Small, dependency-free repository policy checks used locally and in CI."""

from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    "pyproject.toml",
    "uv.lock",
    ".python-version",
    ".node-version",
    ".pre-commit-config.yaml",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "docs/development.md",
    "docs/github-protection.md",
    "CONTRIBUTING.md",
    "Makefile",
    "scripts/check_javascript.sh",
    "scripts/protect_main.sh",
)
FORBIDDEN_TRACKED_SUFFIXES = (".db", ".db-wal", ".db-shm", ".pem", ".key")
FORBIDDEN_TRACKED_NAMES = {".env", "coverage.xml", ".coverage"}


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def main() -> int:
    errors: list[str] = []

    for relative in REQUIRED_FILES:
        if not (ROOT / relative).is_file():
            errors.append(f"missing required workflow file: {relative}")

    pyproject_path = ROOT / "pyproject.toml"
    if pyproject_path.is_file():
        with pyproject_path.open("rb") as handle:
            project = tomllib.load(handle)
        if "project" not in project:
            errors.append("pyproject.toml has no [project] table")
        if "dev" not in project.get("dependency-groups", {}):
            errors.append("pyproject.toml has no dev dependency group")
        if "ruff" not in project.get("tool", {}):
            errors.append("pyproject.toml has no Ruff configuration")

    lock_path = ROOT / "uv.lock"
    if lock_path.is_file():
        if lock_path.stat().st_size < 500:
            errors.append("uv.lock looks incomplete")
        lock_text = lock_path.read_text(encoding="utf-8")
        for private_marker in ("applied-caas", "internal.api.openai.org"):
            if private_marker in lock_text:
                errors.append(
                    f"uv.lock contains a non-portable private package registry: {private_marker}"
                )
        if "https://pypi.org/simple" not in lock_text:
            errors.append("uv.lock is not resolved from the public PyPI index")

    for relative in tracked_files():
        path = Path(relative)
        if path.name in FORBIDDEN_TRACKED_NAMES:
            errors.append(f"forbidden generated/secret file is tracked: {relative}")
        if relative.startswith(".patch-backups/"):
            errors.append(f"patch backup is tracked: {relative}")
        if relative.startswith("backend/data/") and path.suffix in FORBIDDEN_TRACKED_SUFFIXES:
            errors.append(f"database file is tracked: {relative}")
        if path.suffix in {".pem", ".key"}:
            errors.append(f"possible private key is tracked: {relative}")

    workflow = ROOT / ".github/workflows/ci.yml"
    if workflow.is_file():
        text = workflow.read_text(encoding="utf-8")
        for required in ("pull_request:", "merge_group:", "name: CI Gate", "uv sync --frozen"):
            if required not in text:
                errors.append(f"CI workflow is missing: {required}")

    if errors:
        print("Repository policy checks failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Repository policy checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
