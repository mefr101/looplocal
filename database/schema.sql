-- LoopLocal database schema (SQLite)
--
-- Conventions
--   * Money is stored as integer CENTS to avoid floating-point rounding.
--   * Dates are ISO-8601 text ('2026-11-09' or '2026-11-09T14:30:00Z').
--   * quantity_reserved is only ever changed inside a transaction
--     (see services/reservations.js). The CHECK constraint on resources is a
--     last line of defence: even a buggy query cannot over-reserve stock.
--
-- Table of contents
--   1. Organizations and users
--   2. Categories and resources
--   3. Requests
--   4. Reservations, transfers, impact
--   5. Admin support (conflicts, audit log)

PRAGMA foreign_keys = ON;

-- 1. ORGANIZATIONS AND USERS -------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('school_department', 'club', 'nonprofit')),
  address       TEXT NOT NULL,
  -- Rough coordinates let the matching engine estimate pickup distance.
  latitude      REAL,
  longitude     REAL,
  contact_email TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  -- member: browse and request | org_manager: also publish resources | admin: approve everything
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'org_manager', 'admin')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. CATEGORIES AND RESOURCES ------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS resources (
  id                      INTEGER PRIMARY KEY,
  organization_id         INTEGER NOT NULL REFERENCES organizations(id),
  created_by              INTEGER NOT NULL REFERENCES users(id),
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  category_id             INTEGER NOT NULL REFERENCES categories(id),
  quantity_total          INTEGER NOT NULL CHECK (quantity_total >= 0),
  quantity_reserved       INTEGER NOT NULL DEFAULT 0,
  condition               TEXT NOT NULL CHECK (condition IN ('new', 'good', 'fair', 'worn')),
  location                TEXT NOT NULL,
  latitude                REAL,
  longitude               REAL,
  -- Estimated replacement value PER UNIT, in cents. Used by the Impact Ledger.
  replacement_value_cents INTEGER NOT NULL CHECK (replacement_value_cents >= 0),
  available_from          TEXT NOT NULL,
  available_until         TEXT NOT NULL,
  -- Listings start as pending_review and become approved when an admin accepts them.
  status                  TEXT NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review', 'approved', 'rejected', 'archived')),
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_total),
  CHECK (available_until >= available_from)
);

CREATE INDEX IF NOT EXISTS idx_resources_status_category ON resources (status, category_id);
CREATE INDEX IF NOT EXISTS idx_resources_org ON resources (organization_id);

CREATE TABLE IF NOT EXISTS resource_images (
  id          INTEGER PRIMARY KEY,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,   -- file name inside the upload directory
  alt_text    TEXT NOT NULL,   -- required for accessibility
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Tags drive matching.
--   identity   = what the item IS         (e.g. 'reusable-container')
--   substitute = what it can STAND IN FOR (e.g. a plastic tub can substitute for 'reusable-container')
CREATE TABLE IF NOT EXISTS resource_tags (
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('identity', 'substitute')),
  PRIMARY KEY (resource_id, tag, kind)
);

-- 3. REQUESTS ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS requests (
  id                 INTEGER PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id),
  requested_by       INTEGER NOT NULL REFERENCES users(id),
  item_name          TEXT NOT NULL,
  category_id        INTEGER NOT NULL REFERENCES categories(id),
  -- Normalised tag the engine matches against resource_tags (e.g. 'reusable-container').
  need_tag           TEXT NOT NULL,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  intended_use       TEXT NOT NULL,
  needed_by          TEXT NOT NULL,
  pickup_constraints TEXT NOT NULL DEFAULT '',
  accepts_substitutes INTEGER NOT NULL DEFAULT 0 CHECK (accepts_substitutes IN (0, 1)),
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'pending_approval', 'approved', 'fulfilled', 'cancelled')),
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);

-- 4. RESERVATIONS, TRANSFERS, IMPACT ----------------------------------------

-- A reservation is a submitted fulfillment plan for one request.
CREATE TABLE IF NOT EXISTS reservations (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  status      TEXT NOT NULL DEFAULT 'pending_approval'
              CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed', 'cancelled')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

-- One line per supplying resource in the plan.
CREATE TABLE IF NOT EXISTS reservation_items (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  resource_id    INTEGER NOT NULL REFERENCES resources(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  match_type     TEXT NOT NULL CHECK (match_type IN ('exact', 'substitute')),
  -- Human-readable explanation produced by the matching engine.
  reason         TEXT NOT NULL,
  pickup_note    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_reservation_items_resource ON reservation_items (resource_id);

-- One transfer per reservation line; completing it writes the impact ledger row.
CREATE TABLE IF NOT EXISTS transfers (
  id                  INTEGER PRIMARY KEY,
  reservation_item_id INTEGER NOT NULL UNIQUE REFERENCES reservation_items(id),
  status              TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  scheduled_for       TEXT,
  completed_at        TEXT,
  confirmed_by        INTEGER REFERENCES users(id)
);

-- Append-only record of completed reuse. Values are SNAPSHOTS taken at completion,
-- so later edits to a listing never change historical savings.
CREATE TABLE IF NOT EXISTS impact_ledger (
  id                   INTEGER PRIMARY KEY,
  transfer_id          INTEGER NOT NULL UNIQUE REFERENCES transfers(id),
  resource_id          INTEGER NOT NULL REFERENCES resources(id),
  resource_name        TEXT NOT NULL,
  category_id          INTEGER NOT NULL REFERENCES categories(id),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  supplier_org_id      INTEGER NOT NULL REFERENCES organizations(id),
  receiver_org_id      INTEGER NOT NULL REFERENCES organizations(id),
  completed_at         TEXT NOT NULL,
  unit_value_cents     INTEGER NOT NULL,
  cost_avoided_cents   INTEGER NOT NULL  -- quantity * unit_value_cents (an ESTIMATE)
);

-- 5. ADMIN SUPPORT -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS conflicts (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('stock_shortfall', 'date_clash', 'duplicate_listing', 'other')),
  resource_id     INTEGER REFERENCES resources(id),
  reservation_id  INTEGER REFERENCES reservations(id),
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT,
  resolved_by     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,   -- e.g. 'resource.approve'
  entity     TEXT NOT NULL,   -- e.g. 'resources'
  entity_id  INTEGER,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
