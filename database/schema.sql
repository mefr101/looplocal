-- LoopLocal database schema (SQLite)
--
-- The model: an ORGANIZATION (a school or nonprofit) is a private workspace.
-- Inside it, UNITS (departments, clubs, teams) share surplus with each other.
-- Nothing is ever shared BETWEEN organizations.
--
-- Conventions
--   * Money is stored as integer CENTS to avoid floating-point rounding.
--   * Dates are ISO-8601 text ('2026-11-09' or '2026-11-09T14:30:00Z'); times are 'HH:MM'.
--   * Almost every table carries organization_id, and every query filters on it.
--     The triggers below also refuse rows that link across organizations, so even
--     a buggy query cannot mix two organizations' data.
--   * quantity_reserved is only ever changed inside a transaction
--     (see services/reservations.js). The CHECK on resources is a last line of
--     defence: even a buggy query cannot over-reserve stock.
--
-- Table of contents
--   1. Organizations, units, and people
--   2. Categories, locations, and resources
--   3. Requests
--   4. Reservations, transfers, impact
--   5. Admin support (conflicts, audit log)
--   6. Isolation triggers

PRAGMA foreign_keys = ON;

-- 1. ORGANIZATIONS, UNITS, AND PEOPLE ---------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type       TEXT NOT NULL DEFAULT 'school' CHECK (type IN ('school', 'nonprofit', 'other')),
  -- Secret that lets people join this organization. Admins can regenerate it.
  join_code  TEXT NOT NULL UNIQUE,
  -- Branding (set on the organization settings screen).
  brand_color   TEXT CHECK (brand_color IS NULL OR brand_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
  logo_filename TEXT,
  -- Approval rules.
  --   review_requests = 1: an admin must approve each request before it can be matched.
  --   plan_approval_mode: 'always' = every fulfillment plan needs admin approval,
  --                       'threshold' = only plans worth at least the amount below,
  --                       'never' = plans are approved automatically.
  review_requests               INTEGER NOT NULL DEFAULT 0 CHECK (review_requests IN (0, 1)),
  plan_approval_mode            TEXT NOT NULL DEFAULT 'always' CHECK (plan_approval_mode IN ('always', 'threshold', 'never')),
  plan_approval_threshold_cents INTEGER NOT NULL DEFAULT 20000 CHECK (plan_approval_threshold_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Places where items are kept (buildings, rooms, storage areas). Each organization has its own list.
CREATE TABLE IF NOT EXISTS locations (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (organization_id, name)
);

-- Departments, clubs, teams. Listings and requests belong to a unit.
CREATE TABLE IF NOT EXISTS units (
  id                    INTEGER PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL COLLATE NOCASE,
  kind                  TEXT NOT NULL DEFAULT 'department' CHECK (kind IN ('department', 'club', 'team', 'program', 'other')),
  -- Defaults used for the unit's new listings (days like 'mon,wed'; empty = any day).
  default_pickup_days   TEXT NOT NULL DEFAULT '',
  default_pickup_start  TEXT,
  default_pickup_end    TEXT,
  default_location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  -- member: ordinary account (rights come from unit memberships)
  -- org_admin: runs the organization: approves, manages people, settings
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'org_admin')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A person can belong to several units. A 'manager' can publish and manage that unit's listings.
CREATE TABLE IF NOT EXISTS user_units (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager')),
  PRIMARY KEY (user_id, unit_id)
);

-- 2. CATEGORIES, LOCATIONS, AND RESOURCES -----------------------------------

-- Each organization keeps its own category list.
CREATE TABLE IF NOT EXISTS categories (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS resources (
  id                      INTEGER PRIMARY KEY,
  organization_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id                 INTEGER NOT NULL REFERENCES units(id),
  created_by              INTEGER NOT NULL REFERENCES users(id),
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  category_id             INTEGER NOT NULL REFERENCES categories(id),
  quantity_total          INTEGER NOT NULL CHECK (quantity_total >= 0),
  quantity_reserved       INTEGER NOT NULL DEFAULT 0,
  condition               TEXT NOT NULL CHECK (condition IN ('new', 'good', 'fair', 'worn')),
  location_id             INTEGER NOT NULL REFERENCES locations(id),
  location_note           TEXT NOT NULL DEFAULT '',   -- e.g. "second shelf, blue bins"
  -- When the item can be collected: days like 'mon,wed' (empty = any day) and a time window.
  pickup_days             TEXT NOT NULL DEFAULT '',
  pickup_time_start       TEXT,
  pickup_time_end         TEXT,
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

CREATE INDEX IF NOT EXISTS idx_resources_org_status ON resources (organization_id, status, category_id);
CREATE INDEX IF NOT EXISTS idx_resources_unit ON resources (unit_id);

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

-- Request lifecycle (status):
--   pending_review   waiting for an admin to approve it (only when the organization requires review)
--   rejected         admin declined it (review_note says why)
--   open             live: the Rescue Engine can match it
--   pending_approval a fulfillment plan was submitted and awaits admin approval
--   approved         plan approved, stock committed, transfers scheduled
--   fulfilled        all transfers completed
--   cancelled        withdrawn by the requester (or an admin)
CREATE TABLE IF NOT EXISTS requests (
  id                  INTEGER PRIMARY KEY,
  organization_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id             INTEGER NOT NULL REFERENCES units(id),     -- the unit that needs the item
  requested_by        INTEGER NOT NULL REFERENCES users(id),
  item_name           TEXT NOT NULL,
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  -- Normalised tag the engine matches against resource_tags (e.g. 'reusable-container').
  need_tag            TEXT NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  intended_use        TEXT NOT NULL,
  needed_by           TEXT NOT NULL,
  -- When the requesting unit can collect (or receive) the items.
  pickup_days         TEXT NOT NULL DEFAULT '',   -- e.g. 'mon,wed,fri'; empty means any day
  pickup_time_start   TEXT,                       -- 'HH:MM' or NULL for no limit
  pickup_time_end     TEXT,
  -- pickup: the requester collects from the supplying unit's location.
  -- delivery: the supplying side brings it to deliver_to_location_id.
  fulfillment_method  TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment_method IN ('pickup', 'delivery')),
  deliver_to_location_id INTEGER REFERENCES locations(id),
  notes               TEXT NOT NULL DEFAULT '',
  accepts_substitutes INTEGER NOT NULL DEFAULT 0 CHECK (accepts_substitutes IN (0, 1)),
  accepts_partial     INTEGER NOT NULL DEFAULT 0 CHECK (accepts_partial IN (0, 1)),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('pending_review', 'rejected', 'open', 'pending_approval',
                                        'approved', 'fulfilled', 'cancelled')),
  -- Filled when an admin approves or rejects a pending_review request.
  reviewed_by         INTEGER REFERENCES users(id),
  reviewed_at         TEXT,
  review_note         TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fulfillment_method = 'pickup' OR deliver_to_location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_requests_org_status ON requests (organization_id, status);

-- 4. RESERVATIONS, TRANSFERS, IMPACT ----------------------------------------

-- A reservation is a submitted fulfillment plan for one request.
CREATE TABLE IF NOT EXISTS reservations (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id      INTEGER NOT NULL REFERENCES requests(id),
  status          TEXT NOT NULL DEFAULT 'pending_approval'
                  CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed', 'cancelled')),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  reviewed_by     INTEGER REFERENCES users(id),
  review_note     TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     TEXT
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
  organization_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_id          INTEGER NOT NULL UNIQUE REFERENCES transfers(id),
  resource_id          INTEGER NOT NULL REFERENCES resources(id),
  resource_name        TEXT NOT NULL,
  category_id          INTEGER NOT NULL REFERENCES categories(id),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  supplier_unit_id     INTEGER NOT NULL REFERENCES units(id),
  receiver_unit_id     INTEGER NOT NULL REFERENCES units(id),
  completed_at         TEXT NOT NULL,
  unit_value_cents     INTEGER NOT NULL,
  cost_avoided_cents   INTEGER NOT NULL  -- quantity * unit_value_cents (an ESTIMATE)
);

-- 5. ADMIN SUPPORT -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS conflicts (
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
  id              INTEGER PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id),
  action          TEXT NOT NULL,   -- e.g. 'request.approve'
  entity          TEXT NOT NULL,   -- e.g. 'requests'
  entity_id       INTEGER,
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. ISOLATION TRIGGERS ------------------------------------------------------
-- These refuse any row that links records from two different organizations.

CREATE TRIGGER IF NOT EXISTS user_units_same_org
BEFORE INSERT ON user_units
WHEN (SELECT organization_id FROM users WHERE id = NEW.user_id)
  IS NOT (SELECT organization_id FROM units WHERE id = NEW.unit_id)
BEGIN
  SELECT RAISE(ABORT, 'user and unit belong to different organizations');
END;

CREATE TRIGGER IF NOT EXISTS resources_same_org
BEFORE INSERT ON resources
WHEN (SELECT organization_id FROM units WHERE id = NEW.unit_id) IS NOT NEW.organization_id
  OR (SELECT organization_id FROM categories WHERE id = NEW.category_id) IS NOT NEW.organization_id
  OR (SELECT organization_id FROM locations WHERE id = NEW.location_id) IS NOT NEW.organization_id
BEGIN
  SELECT RAISE(ABORT, 'resource links records from a different organization');
END;

CREATE TRIGGER IF NOT EXISTS requests_same_org
BEFORE INSERT ON requests
WHEN (SELECT organization_id FROM units WHERE id = NEW.unit_id) IS NOT NEW.organization_id
  OR (SELECT organization_id FROM categories WHERE id = NEW.category_id) IS NOT NEW.organization_id
  OR (NEW.deliver_to_location_id IS NOT NULL
      AND (SELECT organization_id FROM locations WHERE id = NEW.deliver_to_location_id) IS NOT NEW.organization_id)
BEGIN
  SELECT RAISE(ABORT, 'request links records from a different organization');
END;
