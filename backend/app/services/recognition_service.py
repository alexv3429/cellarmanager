"""Bottle recognition (requirement 7): reading a label via OCR and matching
it against your wine catalog, combined with matching the photo itself
against bottles you've photographed before.

Per feedback, this is not limited to "have I seen this exact photo before":
`extract_label_text` runs real OCR (via `pytesseract`, calling the
`tesseract-ocr` system binary) on the photo, and `match_text_to_catalog`
fuzzy-matches the extracted text against each wine's producer/cuvée/
appellation/vintage using the standard library's `difflib` (tolerant of the
misreads OCR commonly produces - e.g. a smudged "O" read as "0"). The
perceptual-hash photo match is kept as a second, complementary signal (it
still helps when a label is OCR-unfriendly - handwritten, heavily stylized,
partly obscured - or simply to confirm "this is the exact bottle I
photographed before"); `recognize_bottle` runs both and combines them.

Both signals degrade gracefully and independently: if `pytesseract` or the
`tesseract-ocr` binary isn't installed, OCR matching is skipped (not a
crash) and the photo-hash signal alone is still used, and vice versa if
Pillow is missing.
"""
from __future__ import annotations

import difflib
import io
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

from app.core.domain import Wine

try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when Pillow is missing
    PILLOW_AVAILABLE = False

try:
    import pytesseract
    PYTESSERACT_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when pytesseract is missing
    PYTESSERACT_AVAILABLE = False

HASH_SIZE = 8  # -> 64-bit perceptual hash
MAX_HASH_DISTANCE = HASH_SIZE * HASH_SIZE


class RecognitionUnavailable(Exception):
    """Raised when a required optional dependency (Pillow, pytesseract, or
    the tesseract-ocr binary) isn't installed; callers should degrade
    gracefully (e.g. skip that signal) rather than crash."""


# ---------------------------------------------------------------------------
# perceptual-hash photo matching ("have I photographed this bottle before")
# ---------------------------------------------------------------------------

def compute_phash(image_bytes: bytes) -> str:
    """A 64-bit average hash, computed directly with Pillow (no need for the
    third-party `imagehash` package). Shrink to 8x8 grayscale, compare each
    pixel to the mean, pack the result into 64 bits."""
    if not PILLOW_AVAILABLE:
        raise RecognitionUnavailable("Pillow is not installed; photo matching is disabled.")
    with Image.open(io.BytesIO(image_bytes)) as img:
        small = img.convert("L").resize((HASH_SIZE, HASH_SIZE), Image.LANCZOS)
        pixels = list(small.getdata())
    average = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= average else "0" for p in pixels)
    return f"{int(bits, 2):016x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    return bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1")


@dataclass
class PhotoMatch:
    wine_id: str
    distance: int
    confidence: float  # 0..1, 1 = identical hash


def match_photo_hash(query_image_bytes: bytes, known_hashes: list[tuple[str, str]], *, top_k: int = 3) -> list[PhotoMatch]:
    """`known_hashes` is a list of (wine_id, phash) pairs - see
    ``repositories.list_photo_hashes``."""
    query_hash = compute_phash(query_image_bytes)
    scored = []
    for wine_id, phash in known_hashes:
        distance = hamming_distance(query_hash, phash)
        confidence = max(0.0, 1.0 - distance / MAX_HASH_DISTANCE)
        scored.append(PhotoMatch(wine_id=wine_id, distance=distance, confidence=confidence))
    scored.sort(key=lambda m: m.distance)
    return scored[:top_k]


# ---------------------------------------------------------------------------
# OCR label reading + fuzzy catalog matching
# ---------------------------------------------------------------------------

def _tesseract_languages() -> str:
    """Use French+English if the French language pack is installed (common
    for wine labels), otherwise fall back to English only. Add more packs
    with e.g. `apt-get install tesseract-ocr-fra` (see docs/setup.md)."""
    try:
        available = set(pytesseract.get_languages(config=""))
    except Exception:
        return "eng"
    return "eng+fra" if "fra" in available else "eng"


def extract_label_text(image_bytes: bytes) -> str:
    """Run OCR on a bottle-label photo and return the raw extracted text."""
    if not PILLOW_AVAILABLE:
        raise RecognitionUnavailable("Pillow is not installed; OCR is disabled.")
    if not PYTESSERACT_AVAILABLE:
        raise RecognitionUnavailable(
            "pytesseract is not installed. Run `pip install pytesseract` (and make sure the "
            "tesseract-ocr system package is installed) to enable label OCR."
        )
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            gray = img.convert("L")
            return pytesseract.image_to_string(gray, lang=_tesseract_languages())
    except pytesseract.TesseractNotFoundError as exc:
        raise RecognitionUnavailable(
            "The tesseract-ocr system binary is not installed. Install it (e.g. "
            "`apt-get install tesseract-ocr` on Debian/Ubuntu, `brew install tesseract` on "
            "macOS) to enable label OCR."
        ) from exc


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


_TOKEN_RE = re.compile(r"[A-Z0-9]+")
# Structural words that appear on huge swaths of (mostly French) wine labels
# and carry little distinguishing power on their own - excluded from the
# identity-matching token set so scoring is driven by the actually
# distinctive words (producer surname, cuvée name, appellation).
_LABEL_STOPWORDS = {
    "DE", "DU", "DES", "LA", "LE", "LES", "ET", "EN", "AU", "AUX",
    "CHATEAU", "DOMAINE", "CLOS", "MAS", "CAVE", "CAVES", "VIN", "VINS",
    "APPELLATION", "CONTROLEE", "MIS", "BOUTEILLE", "PRODUCE", "PRODUCT",
}


def _normalize_and_tokenize(text: str) -> set[str]:
    upper = _strip_accents(text).upper()
    return set(_TOKEN_RE.findall(upper))


def _wine_identity_tokens(wine: Wine) -> set[str]:
    text = " ".join(filter(None, [wine.producer, wine.cuvee, wine.appellation]))
    tokens = _normalize_and_tokenize(text)
    return {t for t in tokens if len(t) >= 3 and t not in _LABEL_STOPWORDS}


def score_wine_against_text(wine: Wine, ocr_tokens: set[str]) -> float:
    """0..1 - how well this wine's identity matches a bag of OCR tokens.
    Exact token matches count fully; a close-but-not-exact match (handling
    common OCR misreads) counts partially. An exact vintage-year match adds
    a small bonus, since a 4-digit year match is a strong, distinctive
    signal on its own."""
    identity_tokens = _wine_identity_tokens(wine)
    if not identity_tokens:
        return 0.0
    matched_weight = 0.0
    for token in identity_tokens:
        if token in ocr_tokens:
            matched_weight += 1.0
        else:
            close = difflib.get_close_matches(token, ocr_tokens, n=1, cutoff=0.8)
            if close:
                matched_weight += 0.7
    score = matched_weight / len(identity_tokens)
    if wine.vintage and str(wine.vintage) in ocr_tokens:
        score = min(1.0, score + 0.15)
    return score


@dataclass
class TextMatch:
    wine_id: str
    score: float


def match_text_to_catalog(ocr_text: str, wines: list[Wine], *, top_k: int = 3) -> list[TextMatch]:
    ocr_tokens = _normalize_and_tokenize(ocr_text)
    if not ocr_tokens:
        return []
    scored = [TextMatch(wine_id=w.id, score=score_wine_against_text(w, ocr_tokens)) for w in wines]
    scored = [m for m in scored if m.score > 0]
    scored.sort(key=lambda m: m.score, reverse=True)
    return scored[:top_k]


# ---------------------------------------------------------------------------
# combined entry point
# ---------------------------------------------------------------------------

@dataclass
class CombinedMatch:
    wine_id: str
    confidence: float
    ocr_score: Optional[float] = None
    photo_score: Optional[float] = None
    matched_via: list[str] = field(default_factory=list)


@dataclass
class RecognitionResult:
    ocr_text: Optional[str]
    ocr_available: bool
    photo_match_available: bool
    matches: list[CombinedMatch] = field(default_factory=list)


def recognize_bottle(
    image_bytes: bytes, wines: list[Wine], known_hashes: list[tuple[str, str]], *, top_k: int = 3
) -> RecognitionResult:
    """Run OCR-based catalog matching and photo-hash matching, and combine
    them. Either signal can be unavailable (missing dependency) without
    failing the whole request - the result says which ones ran."""
    ocr_text: Optional[str] = None
    ocr_available = True
    text_scores: dict[str, float] = {}
    try:
        ocr_text = extract_label_text(image_bytes)
        for match in match_text_to_catalog(ocr_text, wines, top_k=max(top_k, 5)):
            text_scores[match.wine_id] = match.score
    except RecognitionUnavailable:
        ocr_available = False

    photo_available = True
    photo_scores: dict[str, float] = {}
    try:
        for match in match_photo_hash(image_bytes, known_hashes, top_k=max(top_k, 5)):
            photo_scores[match.wine_id] = match.confidence
    except RecognitionUnavailable:
        photo_available = False

    combined: list[CombinedMatch] = []
    for wine_id in set(text_scores) | set(photo_scores):
        ocr_score = text_scores.get(wine_id)
        photo_score = photo_scores.get(wine_id)
        matched_via = [name for name, val in (("ocr", ocr_score), ("photo_match", photo_score)) if val is not None]
        parts = [v for v in (ocr_score, photo_score) if v is not None]
        # Agreement bonus: a wine flagged by both independent signals is much
        # more likely to be the right one than a wine flagged by only one.
        agreement_bonus = 0.1 if len(parts) > 1 else 0.0
        combined.append(CombinedMatch(
            wine_id=wine_id, confidence=min(1.0, max(parts) + agreement_bonus),
            ocr_score=ocr_score, photo_score=photo_score, matched_via=matched_via,
        ))
    combined.sort(key=lambda m: m.confidence, reverse=True)

    return RecognitionResult(
        ocr_text=ocr_text, ocr_available=ocr_available, photo_match_available=photo_available,
        matches=combined[:top_k],
    )
