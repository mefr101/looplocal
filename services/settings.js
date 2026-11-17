// Organization settings: categories, locations, unit pickup defaults, approval rules,
// and branding (name, accent color, logo). Every function takes the admin from the
// session and works only inside that admin's own organization.
import
{
  db,
  withTransaction
} from '../database/db.js';
import
{
  HttpError
} from './errors.js';
import
{
  recordAudit
} from './audit.js';
import
{
  WEEKDAYS
} from './requests.js';
import
{
  detectImageType,
  removeUpload,
  saveImage
} from './uploads.js';
import
{
  FieldErrors,
  isNonEmptyString,
  isTime
} from './validation.js';

export const LIMITS =
{
  orgName:
  {
    min: 2,
    max: 80
  },
  listName:
  {
    min: 2,
    max: 40
  },
  maxThresholdDollars: 1_000_000,
  maxLogoBytes: 1024 * 1024, // 1 MB
};
export const APPROVAL_MODES = ['always', 'threshold', 'never'];

function fail(fields, message = 'Please fix the highlighted fields.')
{
  throw new HttpError(400, message, fields);
}

// Reading everything for the settings page
export function getSettings(organizationId)
{
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  return (
    {
      organization:
      {
        name: org.name,
        type: org.type,
        brandColor: org.brand_color,
        logoFilename: org.logo_filename,
        reviewRequests: org.review_requests === 1,
        reviewListings: org.review_listings === 1,
        planApprovalMode: org.plan_approval_mode,
        planApprovalThresholdCents: org.plan_approval_threshold_cents,
      },
      categories: listCategories(organizationId),
      locations: listLocations(organizationId),
      units: db.prepare(
        `SELECT id, name, kind, default_pickup_days, default_pickup_start, default_pickup_end, default_location_id
       FROM units WHERE organization_id = ? ORDER BY name`).all(organizationId).map((unit) => (
      {
        id: unit.id,
        name: unit.name,
        kind: unit.kind,
        pickupDays: unit.default_pickup_days ? unit.default_pickup_days.split(',') : [],
        pickupStart: unit.default_pickup_start,
        pickupEnd: unit.default_pickup_end,
        locationId: unit.default_location_id,
      })),
    }
  );
}

// Categories and locations (same rules, so one implementation)
/**
 * Describes each editable list. `usage` counts the records that point at one row; a row
 * that is in use can be renamed but not deleted.
 */
const LISTS =
{
  categories:
  {
    table: 'categories',
    singular: 'category',
    usage: `(SELECT COUNT(*) FROM resources WHERE category_id = x.id)
          + (SELECT COUNT(*) FROM requests WHERE category_id = x.id)
          + (SELECT COUNT(*) FROM impact_ledger WHERE category_id = x.id)`,
  },
  locations:
  {
    table: 'locations',
    singular: 'location',
    usage: `(SELECT COUNT(*) FROM resources WHERE location_id = x.id)
          + (SELECT COUNT(*) FROM requests WHERE deliver_to_location_id = x.id)`,
  },
};

function listRows(list, organizationId)
{
  return db.prepare(
      `SELECT x.id, x.name, ${list.usage} AS in_use
     FROM ${list.table} x WHERE x.organization_id = ? ORDER BY x.name`).all(organizationId)
    .map((row) => (
    {
      id: row.id,
      name: row.name,
      inUse: row.in_use
    }));
}

export const listCategories = (organizationId) => listRows(LISTS.categories, organizationId);
export const listLocations = (organizationId) => listRows(LISTS.locations, organizationId);

function checkListName(list, name)
{
  if (!isNonEmptyString(name, LIMITS.listName))
  {
    fail(
    {
      name: `Enter a ${list.singular} name (${LIMITS.listName.min} to ${LIMITS.listName.max} characters).`
    });
  }
  return name.trim();
}

function nameTaken(list, organizationId, name, exceptId = 0)
{
  return Boolean(db.prepare(
    `SELECT 1 FROM ${list.table} WHERE organization_id = ? AND name = ? AND id <> ?`).get(organizationId, name, exceptId));
}

function addToList(list, admin, input)
{
  const name = checkListName(list, input?.name);
  if (nameTaken(list, admin.organizationId, name))
  {
    throw new HttpError(409, `That ${list.singular} already exists.`,
    {
      name: `That ${list.singular} already exists.`
    });
  }
  const id = Number(db.prepare(`INSERT INTO ${list.table} (organization_id, name) VALUES (?, ?)`)
    .run(admin.organizationId, name).lastInsertRowid);
  recordAudit(admin, `${list.singular}.create`, list.table, id, name);
  return id;
}

function renameInList(list, admin, id, input)
{
  const name = checkListName(list, input?.name);
  const row = db.prepare(`SELECT id FROM ${list.table} WHERE id = ? AND organization_id = ?`).get(id, admin.organizationId);
  if (!row) throw new HttpError(404, `That ${list.singular} was not found.`);
  if (nameTaken(list, admin.organizationId, name, id))
  {
    throw new HttpError(409, `That ${list.singular} already exists.`,
    {
      name: `That ${list.singular} already exists.`
    });
  }
  db.prepare(`UPDATE ${list.table} SET name = ? WHERE id = ?`).run(name, id);
  recordAudit(admin, `${list.singular}.rename`, list.table, id, name);
}

/** Deleting is blocked while anything uses the row; the check and delete are one transaction. */
function removeFromList(list, admin, id)
{
  withTransaction(() =>
  {
    const row = db.prepare(
        `SELECT x.name, ${list.usage} AS in_use FROM ${list.table} x WHERE x.id = ? AND x.organization_id = ?`)
      .get(id, admin.organizationId);
    if (!row) throw new HttpError(404, `That ${list.singular} was not found.`);
    if (row.in_use > 0)
    {
      const records = row.in_use === 1 ? '1 record uses' : `${row.in_use} records use`;
      throw new HttpError(409,
        `${records} "${row.name}", so it cannot be deleted. Rename it, or move those items to another ${list.singular} first.`);
    }
    db.prepare(`DELETE FROM ${list.table} WHERE id = ?`).run(id);
    recordAudit(admin, `${list.singular}.delete`, list.table, id, row.name);
  });
}

export const addCategory = (admin, input) => addToList(LISTS.categories, admin, input);
export const renameCategory = (admin, id, input) => renameInList(LISTS.categories, admin, id, input);
export const deleteCategory = (admin, id) => removeFromList(LISTS.categories, admin, id);
export const addLocation = (admin, input) => addToList(LISTS.locations, admin, input);
export const renameLocation = (admin, id, input) => renameInList(LISTS.locations, admin, id, input);
export const deleteLocation = (admin, id) => removeFromList(LISTS.locations, admin, id);

// Unit pickup defaults
/** input: { pickupDays: ['mon','wed'], pickupStart: '14:00' | null, pickupEnd: '16:00' | null, locationId: n | null } */
export function updateUnitDefaults(admin, unitId, input =
{})
{
  const errors = new FieldErrors();

  const days = input.pickupDays ?? [];
  if (!Array.isArray(days) || days.some((day) => !WEEKDAYS.includes(day))) errors.add('pickupDays', 'Choose days from the list.');

  const start = input.pickupStart || null;
  const end = input.pickupEnd || null;
  if ((start && !isTime(start)) || (end && !isTime(end))) errors.add('pickupStart', 'Enter times like 14:00.');
  else if (Boolean(start) !== Boolean(end)) errors.add('pickupStart', 'Enter both a start and an end time, or leave both empty.');
  else if (start && start >= end) errors.add('pickupEnd', 'The end time must be after the start time.');

  const locationId = input.locationId ?? null;
  if (locationId !== null && !Number.isInteger(locationId)) errors.add('locationId', 'Choose a location from the list.');
  if (errors.hasAny) fail(errors.errors);

  withTransaction(() =>
  {
    if (!db.prepare('SELECT 1 FROM units WHERE id = ? AND organization_id = ?').get(unitId, admin.organizationId))
    {
      throw new HttpError(404, 'Unit not found.');
    }
    if (locationId !== null &&
      !db.prepare('SELECT 1 FROM locations WHERE id = ? AND organization_id = ?').get(locationId, admin.organizationId))
    {
      fail(
      {
        locationId: 'Choose a location from the list.'
      });
    }
    db.prepare(
      `UPDATE units SET default_pickup_days = ?, default_pickup_start = ?, default_pickup_end = ?, default_location_id = ?
       WHERE id = ?`).run(WEEKDAYS.filter((day) => days.includes(day)).join(','), start, end, locationId, unitId);
    recordAudit(admin, 'unit.defaults', 'units', unitId);
  });
}

// Approval rules
/**
 * input: { reviewRequests: boolean, reviewListings?: boolean, planApprovalMode, planApprovalThresholdCents }
 * reviewListings is optional: when left out, the current setting is kept.
 * Turning review off leaves requests already waiting where they are, and a new plan rule
 * applies only to plans submitted afterwards: nothing is approved behind anyone's back.
 */
export function updateApprovalRules(admin, input =
{})
{
  const errors = new FieldErrors();
  if (typeof input.reviewRequests !== 'boolean') errors.add('reviewRequests', 'Choose on or off.');
  if (input.reviewListings !== undefined && typeof input.reviewListings !== 'boolean') errors.add('reviewListings', 'Choose on or off.');
  if (!APPROVAL_MODES.includes(input.planApprovalMode)) errors.add('planApprovalMode', 'Choose when plans need approval.');

  let threshold = null;
  if (input.planApprovalMode === 'threshold')
  {
    threshold = input.planApprovalThresholdCents;
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > LIMITS.maxThresholdDollars * 100)
    {
      errors.add('planApprovalThresholdCents', `Enter an amount from $0 to $${LIMITS.maxThresholdDollars.toLocaleString('en-US')}.`);
    }
  }
  if (errors.hasAny) fail(errors.errors);

  db.prepare(
      `UPDATE organizations SET review_requests = ?, review_listings = COALESCE(?, review_listings),
            plan_approval_mode = ?, plan_approval_threshold_cents = COALESCE(?, plan_approval_threshold_cents) WHERE id = ?`)
    .run(input.reviewRequests ? 1 : 0, input.reviewListings === undefined ? null : Number(input.reviewListings),
      input.planApprovalMode, threshold, admin.organizationId);
  recordAudit(admin, 'organization.approvals', 'organizations', admin.organizationId,
    `review=${input.reviewRequests} listings=${input.reviewListings ?? 'unchanged'} plans=${input.planApprovalMode}${threshold === null ? '' : `>=${threshold}`}`);
}

// Branding
/** input: { name, brandColor: '#rrggbb' | null }. The color is not checked for contrast: the page previews it. */
export function updateBranding(admin, input =
{})
{
  const errors = new FieldErrors();
  if (!isNonEmptyString(input.name, LIMITS.orgName))
  {
    errors.add('name', `Enter a name (${LIMITS.orgName.min} to ${LIMITS.orgName.max} characters).`);
  }
  const color = input.brandColor || null;
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) errors.add('brandColor', 'Enter a color like #439de8.');
  if (errors.hasAny) fail(errors.errors);

  const name = input.name.trim();
  const clash = db.prepare('SELECT 1 FROM organizations WHERE name = ? AND id <> ?').get(name, admin.organizationId);
  if (clash) throw new HttpError(409, 'That organization name is already taken.',
  {
    name: 'That organization name is already taken.'
  });

  db.prepare('UPDATE organizations SET name = ?, brand_color = ? WHERE id = ?')
    .run(name, color ? color.toLowerCase() : null, admin.organizationId);
  recordAudit(admin, 'organization.branding', 'organizations', admin.organizationId, `${name} ${color ?? 'default color'}`);
}

export function setLogo(admin, buffer)
{
  if (!buffer?.length) fail(
  {
    logo: 'Choose an image file.'
  }, 'Choose an image file.');
  if (buffer.length > LIMITS.maxLogoBytes) fail(
  {
    logo: 'The logo must be 1 MB or smaller.'
  }, 'The logo must be 1 MB or smaller.');
  const ext = detectImageType(buffer);
  if (!ext) fail(
  {
    logo: 'Use a PNG, JPG, or WebP image.'
  }, 'Use a PNG, JPG, or WebP image.');

  const filename = saveImage(`logo-${admin.organizationId}`, buffer, ext);

  const old = db.prepare('SELECT logo_filename FROM organizations WHERE id = ?').get(admin.organizationId).logo_filename;
  db.prepare('UPDATE organizations SET logo_filename = ? WHERE id = ?').run(filename, admin.organizationId);
  removeUpload(old);
  recordAudit(admin, 'organization.logo', 'organizations', admin.organizationId, filename);
  return filename;
}

export function removeLogo(admin)
{
  const old = db.prepare('SELECT logo_filename FROM organizations WHERE id = ?').get(admin.organizationId).logo_filename;
  db.prepare('UPDATE organizations SET logo_filename = NULL WHERE id = ?').run(admin.organizationId);
  removeUpload(old);
  recordAudit(admin, 'organization.logo_removed', 'organizations', admin.organizationId);
}
