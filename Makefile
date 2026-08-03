SHELL := /bin/bash
PUBLIC_PYPI_INDEX ?= https://pypi.org/simple
.DEFAULT_GOAL := help

.PHONY: help setup sync lock format lint test test-backend test-frontend test-web-v02 ci run hooks requirements protect-main audit clean

help:
	@printf '%s\n' \
	  'make setup         Install the locked dev environment and Git hooks' \
	  'make sync          Synchronize .venv exactly from uv.lock' \
	  'make format        Apply Ruff fixes and formatting' \
	  'make lint          Check Ruff formatting and lint rules' \
	  'make test          Run backend and frontend tests' \
	  'make ci            Run the same required checks as GitHub CI' \
	  'make run           Start CellarManager locally' \
	  'make requirements  Regenerate pip compatibility exports' \
	  'make protect-main  Activate GitHub main-branch protection'

setup:
	uv sync --frozen --group dev
	npm ci
	uv run --frozen pre-commit install --hook-type pre-commit --hook-type pre-push

sync:
	uv sync --frozen --group dev

lock:
	UV_DEFAULT_INDEX="$(PUBLIC_PYPI_INDEX)" uv lock

format:
	uv run --frozen ruff check --fix backend scripts
	uv run --frozen ruff format backend scripts

lint:
	uv run --frozen ruff format --check backend scripts
	uv run --frozen ruff check backend scripts

repository-check:
	uv run --frozen python scripts/check_repository.py

test-backend:
	uv run --frozen pytest -c pyproject.toml --cov=backend/app --cov-report=term-missing backend/tests

test-frontend:
	./scripts/check_javascript.sh
	node --test frontend/tests/*.test.js

test-web-v02:
	npm run web:ci

test: test-backend test-frontend test-web-v02

ci:
	UV_DEFAULT_INDEX="$(PUBLIC_PYPI_INDEX)" uv lock --check
	$(MAKE) lint
	$(MAKE) repository-check
	$(MAKE) test
	$(MAKE) audit

run:
	cd backend && ../.venv/bin/python run.py

hooks:
	uv run --frozen pre-commit install --hook-type pre-commit --hook-type pre-push

requirements:
	./scripts/export_requirements.sh

protect-main:
	./scripts/protect_main.sh

audit:
	uv audit --frozen

clean:
	rm -rf .pytest_cache .ruff_cache htmlcov coverage.xml .coverage
