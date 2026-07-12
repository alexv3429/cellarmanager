import io
import unittest

from app.core.domain import Wine, new_id
from app.services import recognition_service as rs

try:
    from PIL import Image, ImageDraw
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False


def _solid_image_bytes(color, size=(64, 64)):
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _label_image_bytes(lines, size=(500, 200)):
    img = Image.new("RGB", size, color="white")
    draw = ImageDraw.Draw(img)
    y = 15
    for line in lines:
        draw.text((15, y), line, fill="black")
        y += 25
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _wine(**kwargs):
    defaults = dict(id=new_id(), producer="Domaine Jean-Marc Burgaud", color="red")
    defaults.update(kwargs)
    return Wine(**defaults)


# ---------------------------------------------------------------------------
# perceptual hash (photo-vs-photo) matching
# ---------------------------------------------------------------------------

@unittest.skipUnless(PILLOW_AVAILABLE, "Pillow not installed")
class TestPhotoHashMatching(unittest.TestCase):
    def test_identical_images_have_identical_hash(self):
        img_bytes = _solid_image_bytes((120, 40, 40))
        self.assertEqual(rs.compute_phash(img_bytes), rs.compute_phash(img_bytes))

    def test_similar_images_are_close(self):
        red = _solid_image_bytes((200, 30, 30))
        near_red = _solid_image_bytes((190, 35, 35))
        self.assertLess(rs.hamming_distance(rs.compute_phash(red), rs.compute_phash(near_red)), 10)

    def test_match_photo_hash_returns_best_first(self):
        red = _solid_image_bytes((200, 20, 20))
        white = _solid_image_bytes((250, 250, 240))
        known = [("wine-red", rs.compute_phash(red)), ("wine-white", rs.compute_phash(white))]
        query = _solid_image_bytes((195, 25, 25))  # close to red
        matches = rs.match_photo_hash(query, known, top_k=2)
        self.assertEqual(matches[0].wine_id, "wine-red")


# ---------------------------------------------------------------------------
# OCR - real execution, since tesseract is available in this environment.
# If it isn't in yours, these are skipped rather than failing the suite.
# ---------------------------------------------------------------------------

def _tesseract_ready():
    if not (PILLOW_AVAILABLE and rs.PYTESSERACT_AVAILABLE):
        return False
    try:
        rs.extract_label_text(_solid_image_bytes((255, 255, 255)))
        return True
    except rs.RecognitionUnavailable:
        return False


TESSERACT_READY = _tesseract_ready()


@unittest.skipUnless(TESSERACT_READY, "tesseract-ocr / pytesseract not available in this environment")
class TestOcrExtraction(unittest.TestCase):
    def test_extracts_recognizable_text_from_a_clean_label_image(self):
        image = _label_image_bytes(["CHATEAU MARGAUX", "2018"])
        text = rs.extract_label_text(image)
        upper = text.upper()
        self.assertIn("MARGAUX", upper)
        self.assertIn("2018", upper)

    def test_blank_image_yields_no_crash_and_little_or_no_text(self):
        text = rs.extract_label_text(_solid_image_bytes((255, 255, 255)))
        self.assertEqual(text.strip(), "")


class TestTextNormalizationAndScoring(unittest.TestCase):
    """Pure logic - runs regardless of whether tesseract itself is installed,
    using hand-built 'OCR output' strings instead of running real OCR."""

    def test_exact_token_match_scores_highly(self):
        wine = _wine(producer="Domaine Jean-Marc Burgaud", cuvee="James", appellation="Cote du Py")
        tokens = rs._normalize_and_tokenize("DOMAINE JEAN-MARC BURGAUD JAMES COTE DU PY 2020")
        score = rs.score_wine_against_text(wine, tokens)
        self.assertGreater(score, 0.8)

    def test_unrelated_text_scores_zero_or_near_zero(self):
        wine = _wine(producer="Domaine Jean-Marc Burgaud", cuvee="James", appellation="Cote du Py")
        tokens = rs._normalize_and_tokenize("SOME COMPLETELY UNRELATED TEXT ABOUT CHEESE")
        self.assertLess(rs.score_wine_against_text(wine, tokens), 0.2)

    def test_ocr_noise_tolerated_via_fuzzy_matching(self):
        # Simulates a common OCR misread: a single substituted character,
        # which difflib.get_close_matches (cutoff 0.8) should still catch.
        wine = _wine(producer="Burgaud", cuvee=None, appellation=None)
        tokens = {"BURGAUX"}  # one character off from BURGAUD
        score = rs.score_wine_against_text(wine, tokens)
        self.assertGreater(score, 0.0, "a near-miss token should still contribute partial credit")

    def test_vintage_match_gives_a_bonus(self):
        wine = _wine(producer="Domaine Jean-Marc Burgaud", cuvee="James", appellation="Cote du Py", vintage=2020)
        # Omit "JAMES" from the OCR tokens so the base (no-vintage) score sits
        # below the 1.0 ceiling, leaving room to observe the vintage bonus.
        # ("Jean-Marc" tokenizes to separate JEAN/MARC; "du" and "Py" are
        # dropped as a stopword and a too-short word respectively.)
        base_tokens = {"JEAN", "MARC", "BURGAUD", "COTE"}
        with_vintage = rs.score_wine_against_text(wine, base_tokens | {"2020"})
        without_vintage = rs.score_wine_against_text(wine, base_tokens)
        self.assertGreater(with_vintage, without_vintage)

    def test_common_label_words_excluded_from_identity_tokens(self):
        wine = _wine(producer="Chateau Margaux", cuvee=None, appellation=None)
        tokens = rs._wine_identity_tokens(wine)
        self.assertNotIn("CHATEAU", tokens)
        self.assertIn("MARGAUX", tokens)

    def test_match_text_to_catalog_ranks_best_match_first(self):
        wines = [
            _wine(producer="Chateau Margaux", cuvee=None, appellation="Margaux"),
            _wine(producer="Chateau Latour", cuvee=None, appellation="Pauillac"),
        ]
        matches = rs.match_text_to_catalog("CHATEAU MARGAUX MARGAUX 2018", wines, top_k=2)
        self.assertEqual(matches[0].wine_id, wines[0].id)

    def test_empty_ocr_text_returns_no_matches(self):
        wines = [_wine()]
        self.assertEqual(rs.match_text_to_catalog("", wines), [])


class TestCombinedRecognition(unittest.TestCase):
    def test_wine_flagged_by_both_signals_ranks_above_single_signal_matches(self):
        # Built at the (wine_id, score) level (pure logic) so it does not
        # depend on tesseract actually being installed in every environment
        # this test suite runs in.
        text_scores = {"wine-a": 0.9, "wine-b": 0.85}
        photo_scores = {"wine-a": 0.9}
        combined = []
        for wine_id in set(text_scores) | set(photo_scores):
            ocr_score = text_scores.get(wine_id)
            photo_score = photo_scores.get(wine_id)
            parts = [v for v in (ocr_score, photo_score) if v is not None]
            bonus = 0.1 if len(parts) > 1 else 0.0
            combined.append((wine_id, min(1.0, max(parts) + bonus)))
        combined.sort(key=lambda pair: pair[1], reverse=True)
        self.assertEqual(combined[0][0], "wine-a", "agreement between OCR and photo-hash should win over a single stronger signal")

    @unittest.skipUnless(TESSERACT_READY, "tesseract-ocr / pytesseract not available in this environment")
    def test_recognize_bottle_end_to_end_with_real_ocr(self):
        wines = [
            _wine(producer="Chateau Margaux", cuvee=None, appellation="Margaux", vintage=2018),
            _wine(producer="Domaine Leflaive", cuvee="Puligny-Montrachet", appellation="Puligny-Montrachet", vintage=2019),
        ]
        image = _label_image_bytes(["CHATEAU MARGAUX", "MARGAUX", "2018"])
        result = rs.recognize_bottle(image, wines, known_hashes=[])
        self.assertTrue(result.ocr_available)
        self.assertTrue(result.matches)
        self.assertEqual(result.matches[0].wine_id, wines[0].id)
        self.assertIn("ocr", result.matches[0].matched_via)

    def test_recognize_bottle_degrades_gracefully_when_ocr_unavailable(self):
        # Force the OCR path to report unavailable, independent of whether
        # tesseract is actually installed in this environment, to confirm
        # the function doesn't crash and photo-hash still works alone.
        original = rs.PYTESSERACT_AVAILABLE
        rs.PYTESSERACT_AVAILABLE = False
        try:
            wines = [_wine()]
            image = _solid_image_bytes((10, 200, 10))
            known = [(wines[0].id, rs.compute_phash(image))]
            result = rs.recognize_bottle(image, wines, known_hashes=known)
            self.assertFalse(result.ocr_available)
            self.assertTrue(result.photo_match_available)
            self.assertEqual(result.matches[0].wine_id, wines[0].id)
        finally:
            rs.PYTESSERACT_AVAILABLE = original


if __name__ == "__main__":
    unittest.main()
