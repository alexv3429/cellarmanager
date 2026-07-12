-- Wine Cellar Manager database schema.
-- Deliberately plain SQL (no ORM) so it can be inspected/edited by hand and
-- exercised by unit tests with nothing but Python's built-in sqlite3 module.

CREATE TABLE IF NOT EXISTS wines (
    id TEXT PRIMARY KEY,
    producer TEXT NOT NULL,
    cuvee TEXT,
    appellation TEXT,
    vintage INTEGER,
    color TEXT NOT NULL DEFAULT 'other',
    area TEXT,
    format TEXT NOT NULL DEFAULT '75cl',
    format_ml INTEGER,
    drink_after TEXT,
    drink_after_confidence REAL,
    drink_after_source TEXT,
    drink_before TEXT,
    drink_before_confidence REAL,
    drink_before_source TEXT,
    market_value REAL,
    market_value_confidence REAL,
    market_value_source TEXT,
    market_value_updated_at TEXT,
    advice_experience TEXT,
    advice_pairing TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cellars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    purpose_level INTEGER,
    is_overflow INTEGER NOT NULL DEFAULT 0,
    max_capacity INTEGER NOT NULL DEFAULT 0,
    threshold INTEGER NOT NULL DEFAULT 0,
    location_rule TEXT,
    layout TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS holdings (
    id TEXT PRIMARY KEY,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    cellar_id TEXT REFERENCES cellars(id),
    location TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'in_cellar',
    price_bought REAL,
    acquired_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    wine_id TEXT,
    holding_id TEXT,
    from_cellar_id TEXT,
    from_location TEXT,
    to_cellar_id TEXT,
    to_location TEXT,
    quantity_delta INTEGER NOT NULL DEFAULT 0,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    user_id TEXT,
    note TEXT,
    details_json TEXT,
    client_op_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL
);

-- Perceptual-hash fingerprints of reference bottle photos, used by the
-- photo-recognition feature (see app.services.recognition_service).
CREATE TABLE IF NOT EXISTS photo_hashes (
    id TEXT PRIMARY KEY,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    phash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_holdings_wine ON holdings(wine_id);
CREATE INDEX IF NOT EXISTS idx_holdings_cellar ON holdings(cellar_id);
CREATE INDEX IF NOT EXISTS idx_holdings_state ON holdings(state);
CREATE INDEX IF NOT EXISTS idx_movements_wine ON movements(wine_id);
CREATE INDEX IF NOT EXISTS idx_movements_holding ON movements(holding_id);
CREATE INDEX IF NOT EXISTS idx_movements_occurred ON movements(occurred_at);
CREATE INDEX IF NOT EXISTS idx_wines_identity ON wines(producer, cuvee, appellation, vintage, format);
CREATE INDEX IF NOT EXISTS idx_photo_hashes_wine ON photo_hashes(wine_id);
