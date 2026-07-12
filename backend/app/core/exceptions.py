"""Application-specific exceptions.

Kept separate from the storage/service layers so the API layer can catch
these and translate them into the right HTTP status codes without importing
FastAPI-specific concepts into the business logic.
"""
from __future__ import annotations

from typing import Any, Optional


class WineCellarError(Exception):
    """Base class for all application-specific errors."""


class ValidationError(WineCellarError):
    """Input did not pass validation (bad CSV row, bad field value, etc.)."""

    def __init__(self, message: str, field: Optional[str] = None):
        super().__init__(message)
        self.field = field


class NotFoundError(WineCellarError):
    """The requested entity does not exist."""


class ConflictError(WineCellarError):
    """Optimistic-concurrency version mismatch, or a uniqueness clash."""

    def __init__(self, message: str, current: Optional[Any] = None):
        super().__init__(message)
        self.current = current


class ConfigurationError(WineCellarError):
    """A cellar/rule/environment configuration is invalid or ambiguous."""


class AuthError(WineCellarError):
    """Authentication or authorization failed."""


class CapacityWarning(WineCellarError):
    """Not a hard error: raised only in code paths that want to *carry* a
    warning message without failing the operation. Callers may catch this,
    read `.args[0]`, and continue.
    """
