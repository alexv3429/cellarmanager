import unittest

from app.core.domain import Cellar, Holding, Movement, User, Wine, new_id
from app.core.exceptions import ConflictError, NotFoundError
from app.storage import repositories as repo
from tests.conftest_helpers import DatabaseTestCase


class TestWineRepo(DatabaseTestCase):
    def test_insert_and_get(self):
        w = Wine(id=new_id(), producer="Domaine X", color="red")
        repo.insert_wine(self.conn, w)
        fetched = repo.get_wine(self.conn, w.id)
        self.assertEqual(fetched.producer, "Domaine X")

    def test_get_missing_returns_none(self):
        self.assertIsNone(repo.get_wine(self.conn, "does-not-exist"))

    def test_identity_lookup_distinguishes_vintages(self):
        w2020 = Wine(
            id=new_id(),
            producer="X",
            cuvee="Y",
            appellation="Z",
            vintage=2020,
            color="red",
            format="75cl",
        )
        w2021 = Wine(
            id=new_id(),
            producer="X",
            cuvee="Y",
            appellation="Z",
            vintage=2021,
            color="red",
            format="75cl",
        )
        repo.insert_wine(self.conn, w2020)
        repo.insert_wine(self.conn, w2021)
        found = repo.find_wine_by_identity(self.conn, "X", "Y", "Z", 2020, "75cl")
        self.assertEqual(found.id, w2020.id)

    def test_update_optimistic_concurrency(self):
        w = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, w)
        w.producer = "X Updated"
        repo.update_wine(self.conn, w, expected_version=1)
        self.assertEqual(w.version, 2)
        with self.assertRaises(ConflictError):
            w.producer = "X Updated Again"
            repo.update_wine(self.conn, w, expected_version=1)  # stale version

    def test_update_missing_wine_raises_not_found(self):
        ghost = Wine(id="nope", producer="X", color="red")
        with self.assertRaises(NotFoundError):
            repo.update_wine(self.conn, ghost, expected_version=1)


class TestCellarRepo(DatabaseTestCase):
    def test_name_uniqueness_case_insensitive(self):
        repo.insert_cellar(
            self.conn, Cellar(id=new_id(), name="Cave Nord", max_capacity=10, threshold=8)
        )
        with self.assertRaises(ConflictError):
            repo.insert_cellar(
                self.conn, Cellar(id=new_id(), name="cave nord", max_capacity=10, threshold=8)
            )

    def test_delete_blocked_while_holdings_reference_it(self):
        c = Cellar(id=new_id(), name="Cave", max_capacity=10, threshold=8)
        repo.insert_cellar(self.conn, c)
        w = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, w)
        repo.insert_holding(
            self.conn, Holding(id=new_id(), wine_id=w.id, cellar_id=c.id, quantity=1)
        )
        with self.assertRaises(ConflictError):
            repo.delete_cellar(self.conn, c.id)

    def test_delete_succeeds_when_empty(self):
        c = Cellar(id=new_id(), name="Cave", max_capacity=10, threshold=8)
        repo.insert_cellar(self.conn, c)
        repo.delete_cellar(self.conn, c.id)
        self.assertIsNone(repo.get_cellar(self.conn, c.id))

    def test_cellar_fill_sums_active_holdings_only(self):
        c = Cellar(id=new_id(), name="Cave", max_capacity=10, threshold=8)
        repo.insert_cellar(self.conn, c)
        w = Wine(id=new_id(), producer="X", color="red")
        repo.insert_wine(self.conn, w)
        repo.insert_holding(
            self.conn,
            Holding(id=new_id(), wine_id=w.id, cellar_id=c.id, quantity=4, state="in_cellar"),
        )
        repo.insert_holding(
            self.conn, Holding(id=new_id(), wine_id=w.id, cellar_id=c.id, quantity=2, state="drunk")
        )
        self.assertEqual(repo.cellar_fill(self.conn, c.id), 4)


class TestMovementRepo(DatabaseTestCase):
    def test_client_op_id_dedup(self):
        m1 = Movement(id=new_id(), action="add", quantity_delta=1, client_op_id="op-abc")
        m2 = Movement(id=new_id(), action="add", quantity_delta=1, client_op_id="op-abc")
        self.assertIsNotNone(repo.insert_movement(self.conn, m1))
        self.assertIsNone(
            repo.insert_movement(self.conn, m2),
            "second insert with same client_op_id must be a no-op",
        )

    def test_list_movements_filters_by_cellar(self):
        m1 = Movement(
            id=new_id(), action="move", from_cellar_id="c1", to_cellar_id="c2", quantity_delta=1
        )
        m2 = Movement(
            id=new_id(), action="move", from_cellar_id="c3", to_cellar_id="c4", quantity_delta=1
        )
        repo.insert_movement(self.conn, m1)
        repo.insert_movement(self.conn, m2)
        results = repo.list_movements(self.conn, cellar_id="c2")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].id, m1.id)


class TestUserRepo(DatabaseTestCase):
    def test_username_uniqueness_case_insensitive(self):
        repo.insert_user(
            self.conn, User(id=new_id(), username="Alice", password_hash="h", password_salt="s")
        )
        with self.assertRaises(ConflictError):
            repo.insert_user(
                self.conn,
                User(id=new_id(), username="alice", password_hash="h2", password_salt="s2"),
            )

    def test_get_by_username_case_insensitive(self):
        repo.insert_user(
            self.conn, User(id=new_id(), username="Alice", password_hash="h", password_salt="s")
        )
        self.assertIsNotNone(repo.get_user_by_username(self.conn, "ALICE"))

    def test_count_users(self):
        self.assertEqual(repo.count_users(self.conn), 0)
        repo.insert_user(
            self.conn, User(id=new_id(), username="Alice", password_hash="h", password_salt="s")
        )
        self.assertEqual(repo.count_users(self.conn), 1)


if __name__ == "__main__":
    unittest.main()
