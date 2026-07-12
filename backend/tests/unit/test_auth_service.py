import unittest

from app.services import auth_service


class TestPasswordHashing(unittest.TestCase):
    def test_roundtrip(self):
        h, salt = auth_service.hash_password("correct horse battery staple")
        self.assertTrue(auth_service.verify_password("correct horse battery staple", salt, h))

    def test_wrong_password_rejected(self):
        h, salt = auth_service.hash_password("correct horse battery staple")
        self.assertFalse(auth_service.verify_password("wrong password", salt, h))

    def test_same_password_different_salts_gives_different_hashes(self):
        h1, salt1 = auth_service.hash_password("same password")
        h2, salt2 = auth_service.hash_password("same password")
        self.assertNotEqual(salt1, salt2)
        self.assertNotEqual(h1, h2)

    def test_empty_password_rejected(self):
        with self.assertRaises(ValueError):
            auth_service.hash_password("")


class TestTokens(unittest.TestCase):
    def test_roundtrip(self):
        token = auth_service.create_token("user-123", secret="s3cr3t", now=1000)
        payload = auth_service.verify_token(token, secret="s3cr3t", now=1005)
        self.assertIsNotNone(payload)
        self.assertEqual(payload.user_id, "user-123")

    def test_expired_token_rejected(self):
        token = auth_service.create_token("user-123", secret="s3cr3t", ttl_seconds=10, now=1000)
        payload = auth_service.verify_token(token, secret="s3cr3t", now=1011)
        self.assertIsNone(payload)

    def test_wrong_secret_rejected(self):
        token = auth_service.create_token("user-123", secret="s3cr3t", now=1000)
        payload = auth_service.verify_token(token, secret="different-secret", now=1005)
        self.assertIsNone(payload)

    def test_tampered_payload_rejected(self):
        token = auth_service.create_token("user-123", secret="s3cr3t", now=1000)
        payload_b64, sig_b64 = token.split(".")
        tampered = payload_b64 + "x." + sig_b64
        self.assertIsNone(auth_service.verify_token(tampered, secret="s3cr3t", now=1005))

    def test_garbage_token_rejected(self):
        self.assertIsNone(auth_service.verify_token("not-a-valid-token", secret="s3cr3t"))


class TestLoginRateLimiter(unittest.TestCase):
    def test_blocks_after_max_attempts(self):
        limiter = auth_service.LoginRateLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            limiter.record_failure("alice", now=1000)
        self.assertTrue(limiter.is_blocked("alice", now=1001))

    def test_does_not_block_other_users(self):
        limiter = auth_service.LoginRateLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            limiter.record_failure("alice", now=1000)
        self.assertFalse(limiter.is_blocked("bob", now=1001))

    def test_window_expiry_unblocks(self):
        limiter = auth_service.LoginRateLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            limiter.record_failure("alice", now=1000)
        self.assertFalse(limiter.is_blocked("alice", now=1100))

    def test_reset_clears_attempts(self):
        limiter = auth_service.LoginRateLimiter(max_attempts=3, window_seconds=60)
        for _ in range(3):
            limiter.record_failure("alice", now=1000)
        limiter.reset("alice")
        self.assertFalse(limiter.is_blocked("alice", now=1001))


if __name__ == "__main__":
    unittest.main()
