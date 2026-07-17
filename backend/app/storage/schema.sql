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
    market_value_currency TEXT,
    market_value_basis TEXT,
    market_value_confidence REAL,
    market_value_source TEXT,
    market_value_updated_at TEXT,
    quick_sale_value REAL,
    quick_sale_currency TEXT,
    quick_sale_confidence REAL,
    quick_sale_source TEXT,
    quick_sale_updated_at TEXT,
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

-- Idempotency ledger for offline mutations. A client operation is reserved
-- before any holding changes happen and completed in the same transaction.
-- This prevents a retried request from mutating stock twice.
CREATE TABLE IF NOT EXISTS processed_operations (
    client_op_id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    holding_id TEXT,
    movement_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_processed_operations_status ON processed_operations(status);

-- Evidence-backed Internet and AI enrichment.
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id TEXT PRIMARY KEY,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    user_id TEXT REFERENCES users(id),
    provider TEXT NOT NULL,
    topics_json TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en',
    auto_apply INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    model TEXT,
    summary TEXT,
    error_code TEXT,
    error_message TEXT,
    usage_json TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    raw_response_json TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS enrichment_sources (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    publisher TEXT,
    domain TEXT NOT NULL,
    source_type TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    published_at TEXT,
    excerpt TEXT,
    content_hash TEXT,
    reliability REAL NOT NULL,
    identity_score REAL NOT NULL,
    metadata_json TEXT,
    UNIQUE(job_id, url)
);

CREATE TABLE IF NOT EXISTS enrichment_candidates (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    topic TEXT NOT NULL,
    label TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    method TEXT NOT NULL,
    rationale TEXT NOT NULL,
    source_ids_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS market_observations (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    source_id TEXT REFERENCES enrichment_sources(id),
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    offer_type TEXT NOT NULL,
    bottle_count INTEGER NOT NULL DEFAULT 1,
    format_ml INTEGER,
    tax_included INTEGER,
    in_stock INTEGER,
    exact_match INTEGER NOT NULL DEFAULT 0,
    observed_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wine_enrichment_profiles (
    wine_id TEXT PRIMARY KEY REFERENCES wines(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wine_external_identifiers (
    wine_id TEXT NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL,
    source_id TEXT REFERENCES enrichment_sources(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (wine_id, scheme)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_wine_created
    ON enrichment_jobs(wine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status
    ON enrichment_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_candidates_job
    ON enrichment_candidates(job_id, topic, status);
CREATE INDEX IF NOT EXISTS idx_market_observations_wine
    ON market_observations(wine_id, observed_at);

-- Unified Add inventory workflow (wine identity, acquisition, storage allocation and media).
CREATE TABLE IF NOT EXISTS wine_identity_details (
    wine_id TEXT PRIMARY KEY REFERENCES wines(id) ON DELETE CASCADE,
    country TEXT,
    region TEXT,
    classification TEXT,
    vineyard TEXT,
    sweetness TEXT,
    alcohol_percentage REAL,
    grapes_json TEXT NOT NULL DEFAULT '[]',
    certifications_json TEXT NOT NULL DEFAULT '[]',
    external_identifiers_json TEXT NOT NULL DEFAULT '{}',
    barcode TEXT,
    field_sources_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acquisitions (
    id TEXT PRIMARY KEY,
    wine_id TEXT NOT NULL REFERENCES wines(id),
    user_id TEXT REFERENCES users(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_mode TEXT NOT NULL CHECK (price_mode IN ('per_bottle', 'total')),
    amount REAL,
    currency TEXT NOT NULL,
    tax_included INTEGER,
    fees REAL NOT NULL DEFAULT 0,
    shipping REAL NOT NULL DEFAULT 0,
    effective_unit_cost REAL,
    purchase_date TEXT,
    vendor TEXT,
    acquisition_type TEXT NOT NULL CHECK (
        acquisition_type IN ('purchase', 'gift', 'inheritance', 'cellar_import', 'other')
    ),
    invoice_reference TEXT,
    notes TEXT,
    fill_level TEXT,
    label_condition TEXT,
    capsule_condition TEXT,
    bottle_condition TEXT,
    provenance TEXT,
    storage_history TEXT,
    original_case INTEGER,
    serial_number TEXT,
    personal_notes TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    client_op_id TEXT UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acquisition_allocations (
    id TEXT PRIMARY KEY,
    acquisition_id TEXT NOT NULL REFERENCES acquisitions(id) ON DELETE CASCADE,
    holding_id TEXT NOT NULL REFERENCES holdings(id),
    cellar_id TEXT REFERENCES cellars(id),
    location TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    storage_backend TEXT NOT NULL DEFAULT 'local',
    relative_path TEXT NOT NULL,
    thumbnail_path TEXT,
    mime_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    category TEXT NOT NULL CHECK (
        category IN (
            'front_label', 'back_label', 'full_bottle', 'capsule', 'original_case',
            'receipt', 'condition', 'cellar_location', 'other'
        )
    ),
    wine_id TEXT REFERENCES wines(id) ON DELETE CASCADE,
    acquisition_id TEXT REFERENCES acquisitions(id) ON DELETE CASCADE,
    holding_id TEXT REFERENCES holdings(id),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_ai_candidates (
    id TEXT PRIMARY KEY,
    wine_id TEXT NOT NULL REFERENCES wines(id) ON DELETE CASCADE,
    acquisition_id TEXT REFERENCES acquisitions(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    label TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    rationale TEXT,
    evidence_links_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer_id TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_acquisitions_wine_created
    ON acquisitions(wine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acquisition_allocations_acquisition
    ON acquisition_allocations(acquisition_id);
CREATE INDEX IF NOT EXISTS idx_acquisition_allocations_holding
    ON acquisition_allocations(holding_id);
CREATE INDEX IF NOT EXISTS idx_media_files_wine
    ON media_files(wine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_files_acquisition
    ON media_files(acquisition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_files_hash
    ON media_files(sha256);
CREATE INDEX IF NOT EXISTS idx_inventory_ai_candidates_wine
    ON inventory_ai_candidates(wine_id, status, created_at DESC);
