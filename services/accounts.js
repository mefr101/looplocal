// Creating accounts: joining an existing organization with its code, or creating a
// brand-new organization (the creator becomes its first admin).
import bcrypt from 'bcryptjs';
import { db, withTransaction } from '../database/db.js';
import { HttpError } from './errors.js';
import { FieldErrors, isEmail, isNonEmptyString } from './validation.js';
import { ORGANIZATION_TYPES, createOrganizationWithAdmin, findOrganizationByCode } from './organizations.js';

function checkPerson(input, errors) {
  if (!isNonEmptyString(input.name, { max: 100 })) errors.add('name', 'Enter your name.');
  if (!isEmail(input.email)) errors.add('email', 'Enter a valid email address.');
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
    errors.add('email', 'That email is already registered.');
  }
  if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200) {
    errors.add('password', 'Use at least 8 characters.');
  }
}

function failIfInvalid(errors) {
  if (errors.hasAny) throw new HttpError(400, 'Please fix the highlighted fields.', errors.errors);
}

/** Join an existing organization using its code. Returns the new user's id. */
export function registerMember(body) {
  const input = body ?? {};
  const errors = new FieldErrors();
  checkPerson(input, errors);

  const organization = findOrganizationByCode(input.joinCode);
  if (!organization) errors.add('joinCode', 'That code was not recognized. Ask your organization admin for the current code.');

  // They must say which unit(s) they belong to, and each must be a unit of THIS organization.
  const unitIds = Array.isArray(input.unitIds) ? [...new Set(input.unitIds)] : [];
  if (organization) {
    const valid = unitIds.length > 0 && unitIds.every((id) =>
      Number.isInteger(id) && db.prepare('SELECT 1 FROM units WHERE id = ? AND organization_id = ?').get(id, organization.id));
    if (!valid) errors.add('unitIds', 'Choose at least one unit you belong to.');
  }
  failIfInvalid(errors);

  return withTransaction(() => {
    const userId = Number(db.prepare(
      'INSERT INTO users (organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(organization.id, input.name.trim(), input.email, bcrypt.hashSync(input.password, 10), 'member').lastInsertRowid);
    const link = db.prepare('INSERT INTO user_units (user_id, unit_id, role) VALUES (?, ?, ?)');
    for (const unitId of unitIds) link.run(userId, unitId, 'member');
    return userId;
  });
}

/** Create a new organization and its first admin. Returns the admin's user id. */
export function registerOrganization(body) {
  const input = body ?? {};
  const errors = new FieldErrors();
  checkPerson(input, errors);

  if (!isNonEmptyString(input.organizationName, { min: 2, max: 100 })) {
    errors.add('organizationName', 'Enter your organization\'s name (2 to 100 characters).');
  } else if (db.prepare('SELECT 1 FROM organizations WHERE name = ?').get(input.organizationName.trim())) {
    errors.add('organizationName', 'An organization with that name already exists.');
  }
  if (!ORGANIZATION_TYPES.includes(input.type)) errors.add('type', 'Choose what kind of organization this is.');
  failIfInvalid(errors);

  return createOrganizationWithAdmin({
    orgName: input.organizationName.trim(),
    type: input.type,
    adminName: input.name.trim(),
    email: input.email,
    passwordHash: bcrypt.hashSync(input.password, 10),
  });
}
