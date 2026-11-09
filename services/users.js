// Loading people. A "user" object is everything the rest of the app needs to know
// about who is acting: their organization, role, and the units they belong to.
import { db } from '../database/db.js';

const SELECT_USER = `
  SELECT u.*, o.name AS organization_name, o.brand_color, o.logo_filename
  FROM users u JOIN organizations o ON o.id = u.organization_id`;

function buildUser(row) {
  const units = db.prepare(
    `SELECT un.id, un.name, uu.role
     FROM user_units uu JOIN units un ON un.id = uu.unit_id
     WHERE uu.user_id = ? ORDER BY un.name`).all(row.id);
  const isAdmin = row.role === 'org_admin';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isAdmin,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    brandColor: row.brand_color,
    logoFilename: row.logo_filename,
    units: units.map((unit) => ({ id: unit.id, name: unit.name, role: unit.role })),
    // Admins can publish for any unit; otherwise you must manage at least one unit.
    canPublish: isAdmin || units.some((unit) => unit.role === 'manager'),
  };
}

/**
 * Load a user fresh from the database. Called on every API request, so a role or unit
 * change by an admin takes effect immediately instead of waiting for the person to sign in again.
 */
export function loadUserById(id) {
  const row = db.prepare(`${SELECT_USER} WHERE u.id = ?`).get(id);
  return row ? buildUser(row) : null;
}

/** The raw row (including the password hash) for sign-in checks only. */
export function findLoginRow(email) {
  return db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) ?? null;
}
