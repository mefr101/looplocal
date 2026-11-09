// Organizations: creating them, join codes, units, and managing people.
// An organization is a private workspace; every function here takes the
// organization from the signed-in admin, never from the request body.
import crypto from 'node:crypto';
import { db, withTransaction } from '../database/db.js';
import { HttpError } from './errors.js';
import { recordAudit } from './audit.js';
import { isNonEmptyString } from './validation.js';

export const ORGANIZATION_TYPES = ['school', 'nonprofit', 'other'];
export const UNIT_KINDS = ['department', 'club', 'team', 'program', 'other'];

/** Every new organization starts with these categories and can edit them later. */
export const DEFAULT_CATEGORIES = [
  'Containers & Storage', 'Art Supplies', 'Lab & Science', 'Furniture',
  'Electronics', 'Sports & Recreation', 'Kitchen & Food Service', 'Books & Media',
];

// --- Join codes ---------------------------------------------------------------
// 8 characters from an alphabet without look-alikes (no 0/O or 1/I): about 850 billion
// possibilities, and the sign-in endpoints are rate limited, so guessing isn't practical.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateJoinCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM organizations WHERE join_code = ?').get(code)) return code;
  }
}

/** People may type "abcd-efgh" or "ABCD EFGH": keep letters and digits, uppercase. */
export function normalizeJoinCode(input) {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "ABCDEFGH" -> "ABCD-EFGH", easier to read aloud. */
export function formatJoinCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function findOrganizationByCode(input) {
  const code = normalizeJoinCode(input);
  if (code.length !== 8) return null;
  return db.prepare('SELECT id, name, type FROM organizations WHERE join_code = ?').get(code) ?? null;
}

// --- Creating an organization ---------------------------------------------------

/** Creates the organization, its default categories, and its first admin, all or nothing. */
export function createOrganizationWithAdmin({ orgName, type, adminName, email, passwordHash }) {
  return withTransaction(() => {
    const orgId = Number(db.prepare('INSERT INTO organizations (name, type, join_code) VALUES (?, ?, ?)')
      .run(orgName, type, generateJoinCode()).lastInsertRowid);
    const insertCategory = db.prepare('INSERT INTO categories (organization_id, name) VALUES (?, ?)');
    for (const name of DEFAULT_CATEGORIES) insertCategory.run(orgId, name);
    return Number(db.prepare(
      'INSERT INTO users (organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, adminName, email, passwordHash, 'org_admin').lastInsertRowid);
  });
}

// --- Reading and settings ---------------------------------------------------------

export function getOrganization(organizationId) {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    joinCode: formatJoinCode(row.join_code),
    brandColor: row.brand_color,
    logoFilename: row.logo_filename,
    reviewRequests: row.review_requests === 1,
    planApprovalMode: row.plan_approval_mode,
    planApprovalThresholdCents: row.plan_approval_threshold_cents,
  };
}

export function regenerateJoinCode(admin) {
  const code = generateJoinCode();
  db.prepare('UPDATE organizations SET join_code = ? WHERE id = ?').run(code, admin.organizationId);
  recordAudit(admin, 'organization.join_code', 'organizations', admin.organizationId);
  return formatJoinCode(code);
}

// --- Units ------------------------------------------------------------------------

/** Public to anyone holding the join code: just ids, names and kinds, never people. */
export function listUnitsForJoining(organizationId) {
  return db.prepare('SELECT id, name, kind FROM units WHERE organization_id = ? ORDER BY name').all(organizationId);
}

export function listUnits(organizationId) {
  return db.prepare(
    `SELECT u.id, u.name, u.kind,
            (SELECT COUNT(*) FROM user_units uu WHERE uu.unit_id = u.id) AS member_count
     FROM units u WHERE u.organization_id = ? ORDER BY u.name`).all(organizationId)
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind, memberCount: row.member_count }));
}

function checkUnitInput({ name, kind }) {
  const fields = {};
  if (!isNonEmptyString(name, { min: 2, max: 60 })) fields.name = 'Enter a name (2 to 60 characters).';
  if (!UNIT_KINDS.includes(kind)) fields.kind = 'Choose a type.';
  if (Object.keys(fields).length) throw new HttpError(400, 'Please fix the highlighted fields.', fields);
  return { name: name.trim(), kind };
}

export function createUnit(admin, input) {
  const { name, kind } = checkUnitInput(input ?? {});
  if (db.prepare('SELECT 1 FROM units WHERE organization_id = ? AND name = ?').get(admin.organizationId, name)) {
    throw new HttpError(409, 'A unit with that name already exists.', { name: 'A unit with that name already exists.' });
  }
  const id = Number(db.prepare('INSERT INTO units (organization_id, name, kind) VALUES (?, ?, ?)')
    .run(admin.organizationId, name, kind).lastInsertRowid);
  recordAudit(admin, 'unit.create', 'units', id, name);
  return id;
}

export function updateUnit(admin, unitId, input) {
  const { name, kind } = checkUnitInput(input ?? {});
  const unit = db.prepare('SELECT id FROM units WHERE id = ? AND organization_id = ?').get(unitId, admin.organizationId);
  if (!unit) throw new HttpError(404, 'Unit not found.');
  const clash = db.prepare('SELECT id FROM units WHERE organization_id = ? AND name = ? AND id <> ?')
    .get(admin.organizationId, name, unitId);
  if (clash) throw new HttpError(409, 'A unit with that name already exists.', { name: 'A unit with that name already exists.' });
  db.prepare('UPDATE units SET name = ?, kind = ? WHERE id = ?').run(name, kind, unitId);
  recordAudit(admin, 'unit.update', 'units', unitId, name);
}

// --- People -----------------------------------------------------------------------

export function listMembers(organizationId) {
  const users = db.prepare(
    'SELECT id, name, email, role FROM users WHERE organization_id = ? ORDER BY name').all(organizationId);
  const memberships = db.prepare(
    `SELECT uu.user_id, uu.unit_id, uu.role FROM user_units uu
     JOIN units un ON un.id = uu.unit_id WHERE un.organization_id = ?`).all(organizationId);
  return users.map((user) => ({
    id: user.id, name: user.name, email: user.email, role: user.role,
    units: memberships.filter((m) => m.user_id === user.id).map((m) => ({ unitId: m.unit_id, role: m.role })),
  }));
}

function memberOf(admin, userId) {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND organization_id = ?').get(userId, admin.organizationId);
  if (!user) throw new HttpError(404, 'Person not found.');
  return user;
}

export function setMemberRole(admin, userId, role) {
  if (!['member', 'org_admin'].includes(role)) throw new HttpError(400, 'Choose member or admin.');
  withTransaction(() => {
    const target = memberOf(admin, userId);
    if (target.role === 'org_admin' && role !== 'org_admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'org_admin'")
        .get(admin.organizationId).n;
      if (admins <= 1) throw new HttpError(409, 'An organization needs at least one admin.');
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    recordAudit(admin, 'member.role', 'users', userId, role);
  });
}

/** Replace the set of units a person belongs to. memberships: [{ unitId, role: 'member' | 'manager' }] */
export function setMemberUnits(admin, userId, memberships) {
  if (!Array.isArray(memberships) || memberships.length > 100) throw new HttpError(400, 'Invalid unit list.');
  const seen = new Set();
  for (const item of memberships) {
    if (!Number.isInteger(item?.unitId) || !['member', 'manager'].includes(item.role) || seen.has(item.unitId)) {
      throw new HttpError(400, 'Invalid unit list.');
    }
    seen.add(item.unitId);
  }
  withTransaction(() => {
    memberOf(admin, userId);
    for (const { unitId } of memberships) {
      if (!db.prepare('SELECT 1 FROM units WHERE id = ? AND organization_id = ?').get(unitId, admin.organizationId)) {
        throw new HttpError(404, 'Unit not found.');
      }
    }
    db.prepare('DELETE FROM user_units WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO user_units (user_id, unit_id, role) VALUES (?, ?, ?)');
    for (const { unitId, role } of memberships) insert.run(userId, unitId, role);
    recordAudit(admin, 'member.units', 'users', userId, JSON.stringify(memberships));
  });
}
