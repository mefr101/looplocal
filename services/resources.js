// Publishing a listing. People list under units they belong to (admins under any unit). With
// "review listings" on, a new listing waits for an admin unless an admin published it. Pickup times
// default to the unit's settings. The listing, its tags and its optional photo (checked by its real
// bytes, with alt text) are saved together or not at all.
import
{
  db,
  withTransaction
} from '../database/db.js';
import
{
  config
} from '../config.js';
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
  checkDuplicateListing
} from './conflicts.js';
import
{
  publishableUnits
} from './permissions.js';
import
{
  WEEKDAYS
} from './requests.js';
import
{
  normalizeTag
} from './tags.js';
import
{
  detectImageType,
  removeUpload,
  saveImage
} from './uploads.js';
import
{
  FieldErrors,
  isIsoDate,
  isNonEmptyString,
  isTime,
  isoDateFromToday
} from './validation.js';

export const CONDITIONS = ['new', 'good', 'fair', 'worn'];
export const LIMITS =
{
  name:
  {
    min: 2,
    max: 100
  },
  description:
  {
    min: 10,
    max: 1000
  },
  locationNote: 120,
  altText:
  {
    min: 5,
    max: 150
  },
  maxQuantity: 10000,
  maxValueCents: 10_000_000, // $100,000 per unit
  maxSubstitutes: 5,
  maxDaysAhead: 730,
  maxPhotoBytes: config.maxUploadBytes,
};

// "My listings"
/** Listings the person's units have published (admins see the whole organization), newest first, any status. */
export function listMyListings(user)
{
  const sql = `
    SELECT r.id, r.name, r.status, r.review_note, r.quantity_total, r.quantity_reserved, r.available_until, r.created_at,
           u.name AS unit_name, c.name AS category_name,
           (SELECT filename FROM resource_images WHERE resource_id = r.id ORDER BY sort_order LIMIT 1) AS image
    FROM resources r
    JOIN units u ON u.id = r.unit_id
    JOIN categories c ON c.id = r.category_id
    WHERE r.organization_id = ?`;
  const rows = user.isAdmin ?
    db.prepare(`${sql} ORDER BY r.created_at DESC, r.id DESC`).all(user.organizationId) :
    db.prepare(`${sql} AND r.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = ?) ORDER BY r.created_at DESC, r.id DESC`)
    .all(user.organizationId, user.id);
  return rows.map((row) => (
  {
    id: row.id,
    name: row.name,
    status: row.status,
    unitName: row.unit_name,
    categoryName: row.category_name,
    quantityTotal: row.quantity_total,
    quantityReserved: row.quantity_reserved,
    quantityAvailable: row.quantity_total - row.quantity_reserved,
    availableUntil: row.available_until,
    image: row.image,
    reviewNote: row.status === 'rejected' ? row.review_note : null,
  }));
}

// What the form needs
export function getPublishContext(user)
{
  const org = db.prepare('SELECT review_listings FROM organizations WHERE id = ?').get(user.organizationId);
  const allowed = publishableUnits(user).map((unit) => unit.id);
  const units = allowed.length === 0 ? [] : db.prepare(
      `SELECT id, name, default_pickup_days, default_pickup_start, default_pickup_end, default_location_id
     FROM units WHERE organization_id = ? AND id IN (${allowed.map(() => '?').join(',')}) ORDER BY name`)
    .all(user.organizationId, ...allowed).map((unit) => (
    {
      id: unit.id,
      name: unit.name,
      pickupDays: unit.default_pickup_days ? unit.default_pickup_days.split(',') : [],
      pickupTimeStart: unit.default_pickup_start,
      pickupTimeEnd: unit.default_pickup_end,
      locationId: unit.default_location_id,
    }));
  return (
    {
      units,
      categories: db.prepare('SELECT id, name FROM categories WHERE organization_id = ? ORDER BY name').all(user.organizationId),
      locations: db.prepare('SELECT id, name FROM locations WHERE organization_id = ? ORDER BY name').all(user.organizationId),
      conditions: CONDITIONS,
      // Admins review listings, so their own are never held.
      reviewRequired: org.review_listings === 1 && !user.isAdmin,
      limits: LIMITS,
      today: isoDateFromToday(0),
    }
  );
}

// Validation
/** "reusable containers, storage tubs" or an array -> clean tags (no duplicates, not the item's own tag). */
function cleanSubstitutes(input, identityTag, errors)
{
  const raw = Array.isArray(input) ? input : [];
  if (input !== undefined && !Array.isArray(input))
  {
    errors.add('substitutesFor', 'Send the substitutes as a list.');
    return [];
  }
  const tags = [];
  for (const entry of raw)
  {
    const tag = typeof entry === 'string' ? normalizeTag(entry) : '';
    if (tag && tag !== identityTag && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > LIMITS.maxSubstitutes)
  {
    errors.add('substitutesFor', `List up to ${LIMITS.maxSubstitutes} things this can stand in for.`);
  }
  return tags;
}

// Checks a listing from the form and returns clean values plus field errors. Saves nothing.
export function validateListing(body, user, photo = null)
{
  const input = body ??
  {};
  const errors = new FieldErrors();
  const values =
  {};

  // Which unit is this listed under? Must be one this person may publish for.
  const allowed = publishableUnits(user);
  const unitId = input.unitId ?? (allowed.length === 1 ? allowed[0].id : null);
  const unit = allowed.some((candidate) => candidate.id === unitId) ?
    db.prepare('SELECT * FROM units WHERE id = ? AND organization_id = ?').get(unitId, user.organizationId) :
    null;
  if (allowed.length === 0) errors.add('unitId', 'You are not part of any unit yet. Ask an organization admin to add you to one.');
  else if (!unit) errors.add('unitId', 'Choose the unit this listing is for.');
  else values.unitId = unit.id;

  if (!isNonEmptyString(input.name, LIMITS.name))
  {
    errors.add('name', `Enter the item name (${LIMITS.name.min} to ${LIMITS.name.max} characters).`);
  }
  else
  {
    values.name = input.name.trim();
    // Prefer the tag chosen from suggestions; otherwise derive it from the name.
    values.identityTag = normalizeTag(typeof input.identityTag === 'string' && input.identityTag ? input.identityTag : values.name);
    if (!values.identityTag) errors.add('name', 'Use letters or numbers in the item name.');
  }
  values.substitutesFor = cleanSubstitutes(input.substitutesFor, values.identityTag, errors);

  if (!isNonEmptyString(input.description, LIMITS.description))
  {
    errors.add('description', `Describe the item (${LIMITS.description.min} to ${LIMITS.description.max} characters).`);
  }
  else
  {
    values.description = input.description.trim();
  }

  const category = Number.isInteger(input.categoryId) ?
    db.prepare('SELECT id FROM categories WHERE id = ? AND organization_id = ?').get(input.categoryId, user.organizationId) :
    null;
  if (!category) errors.add('categoryId', 'Choose a category.');
  else values.categoryId = category.id;

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > LIMITS.maxQuantity)
  {
    errors.add('quantity', `Enter a whole number from 1 to ${LIMITS.maxQuantity.toLocaleString('en-US')}.`);
  }
  else
  {
    values.quantity = input.quantity;
  }

  if (!CONDITIONS.includes(input.condition)) errors.add('condition', 'Choose the condition.');
  else values.condition = input.condition;

  if (!Number.isInteger(input.replacementValueCents) || input.replacementValueCents < 0 || input.replacementValueCents > LIMITS.maxValueCents)
  {
    errors.add('replacementValueCents', `Enter the value of one item, from $0 to $${(LIMITS.maxValueCents / 100).toLocaleString('en-US')}.`);
  }
  else
  {
    values.replacementValueCents = input.replacementValueCents;
  }

  // Where it is kept: the form's choice, else the unit's default location.
  const locationId = input.locationId ?? unit?.default_location_id ?? null;
  const location = Number.isInteger(locationId) ?
    db.prepare('SELECT id FROM locations WHERE id = ? AND organization_id = ?').get(locationId, user.organizationId) :
    null;
  if (!location) errors.add('locationId', 'Choose where the item is kept.');
  else values.locationId = location.id;

  const note = input.locationNote ?? '';
  if (typeof note !== 'string' || note.trim().length > LIMITS.locationNote)
  {
    errors.add('locationNote', `Keep the location note under ${LIMITS.locationNote} characters.`);
  }
  else
  {
    values.locationNote = note.trim();
  }

  // Pickup days and hours: sent values win; anything not sent comes from the unit's defaults.
  const days = input.pickupDays ?? (unit?.default_pickup_days ? unit.default_pickup_days.split(',') : []);
  if (!Array.isArray(days) || days.some((day) => !WEEKDAYS.includes(day)))
  {
    errors.add('pickupDays', 'Choose days from the list.');
  }
  else
  {
    values.pickupDays = WEEKDAYS.filter((day) => days.includes(day));
  }
  const start = ('pickupTimeStart' in input ? input.pickupTimeStart : unit?.default_pickup_start) || null;
  const end = ('pickupTimeEnd' in input ? input.pickupTimeEnd : unit?.default_pickup_end) || null;
  if ((start && !isTime(start)) || (end && !isTime(end))) errors.add('pickupTimeStart', 'Enter times like 15:30.');
  else if (Boolean(start) !== Boolean(end)) errors.add('pickupTimeStart', 'Enter both an earliest and a latest time, or leave both empty.');
  else if (start && start >= end) errors.add('pickupTimeEnd', 'The latest time must be after the earliest time.');
  else
  {
    values.pickupTimeStart = start;
    values.pickupTimeEnd = end;
  }

  // Availability window.
  const today = isoDateFromToday(0);
  const from = input.availableFrom ?? today;
  if (!isIsoDate(from)) errors.add('availableFrom', 'Choose the first day it can be collected.');
  else if (from < today) errors.add('availableFrom', 'The date cannot be in the past.');
  else values.availableFrom = from;
  const latest = isoDateFromToday(LIMITS.maxDaysAhead);
  if (!isIsoDate(input.availableUntil)) errors.add('availableUntil', 'Choose the last day it can be collected.');
  else if (input.availableUntil > latest) errors.add('availableUntil', 'Choose a date within the next two years.');
  else if (values.availableFrom && input.availableUntil < values.availableFrom) errors.add('availableUntil', 'This must be on or after the first day.');
  else values.availableUntil = input.availableUntil;

  // Photo (optional). Its alt text is required, and the file is checked by its real bytes.
  if (photo)
  {
    if (!isNonEmptyString(photo.altText, LIMITS.altText))
    {
      errors.add('altText', `Describe the photo for people who cannot see it (${LIMITS.altText.min} to ${LIMITS.altText.max} characters).`);
    }
    if (!photo.buffer?.length) errors.add('photo', 'Choose an image file.');
    else if (photo.buffer.length > LIMITS.maxPhotoBytes) errors.add('photo', `The photo must be ${LIMITS.maxPhotoBytes / 1024 / 1024} MB or smaller.`);
    else if (!detectImageType(photo.buffer)) errors.add('photo', 'Use a PNG, JPG, or WebP image.');
  }

  return (
    {
      errors,
      values
    }
  );
}

// Saving
// Saves a validated listing. It waits for review if the organization reviews listings and the publisher isn't an admin.
export function createListing(user, values, photo = null)
{
  let filename = null;
  try
  {
    return withTransaction(() =>
    {
      const org = db.prepare('SELECT review_listings FROM organizations WHERE id = ?').get(user.organizationId);
      const status = org.review_listings === 1 && !user.isAdmin ? 'pending_review' : 'approved';

      const id = Number(db.prepare(
        `INSERT INTO resources (organization_id, unit_id, created_by, name, description, category_id, quantity_total,
           condition, location_id, location_note, pickup_days, pickup_time_start, pickup_time_end,
           replacement_value_cents, available_from, available_until, status)
         VALUES (:org, :unit, :user, :name, :description, :category, :quantity, :condition, :location, :note,
           :days, :start, :end, :value, :from, :until, :status)`).run(
      {
        org: user.organizationId,
        unit: values.unitId,
        user: user.id,
        name: values.name,
        description: values.description,
        category: values.categoryId,
        quantity: values.quantity,
        condition: values.condition,
        location: values.locationId,
        note: values.locationNote,
        days: values.pickupDays.join(','),
        start: values.pickupTimeStart,
        end: values.pickupTimeEnd,
        value: values.replacementValueCents,
        from: values.availableFrom,
        until: values.availableUntil,
        status,
      }).lastInsertRowid);

      const insertTag = db.prepare('INSERT INTO resource_tags (resource_id, tag, kind) VALUES (?, ?, ?)');
      insertTag.run(id, values.identityTag, 'identity');
      for (const tag of values.substitutesFor) insertTag.run(id, tag, 'substitute');

      if (photo)
      {
        filename = saveImage(`resource-${id}`, photo.buffer, detectImageType(photo.buffer));
        db.prepare('INSERT INTO resource_images (resource_id, filename, alt_text, sort_order) VALUES (?, ?, ?, 0)')
          .run(id, filename, photo.altText.trim());
      }
      recordAudit(user, 'resource.create', 'resources', id, `${values.name} x${values.quantity} (${status})`);
      checkDuplicateListing(user.organizationId, id);
      return (
        {
          id,
          name: values.name,
          status
        }
      );
    });
  }
  catch (error)
  {
    removeUpload(filename); // the listing was rolled back, so don't leave its photo behind
    throw error;
  }
}

/** Convenience for callers that have raw input: validate, then save. Throws a 400 with field errors. */
export function publishListing(user, body, photo = null)
{
  const
  {
    errors,
    values
  } = validateListing(body, user, photo);
  if (errors.hasAny) throw new HttpError(400, 'Please fix the highlighted fields.', errors.errors);
  return createListing(user, values, photo);
}

// Admin review of listings
/** Listings waiting for an admin, oldest first. */
export function listPendingListings(admin)
{
  return db.prepare(`
    SELECT r.id, r.name, r.description, r.quantity_total, r.condition, r.replacement_value_cents, r.created_at,
           u.name AS unit_name, c.name AS category_name, p.name AS publisher
    FROM resources r
    JOIN units u ON u.id = r.unit_id
    JOIN categories c ON c.id = r.category_id
    JOIN users p ON p.id = r.created_by
    WHERE r.organization_id = ? AND r.status = 'pending_review'
    ORDER BY r.created_at, r.id`).all(admin.organizationId).map((row) => (
  {
    id: row.id,
    name: row.name,
    description: row.description,
    quantity: row.quantity_total,
    condition: row.condition,
    valueCents: row.replacement_value_cents,
    unitName: row.unit_name,
    categoryName: row.category_name,
    publisher: row.publisher,
  }));
}

function reviewListing(id, admin, status, note)
{
  const exists = db.prepare('SELECT 1 FROM resources WHERE id = ? AND organization_id = ?').get(id, admin.organizationId);
  if (!exists) throw new HttpError(404, 'Listing not found.');
  const result = db.prepare(
      `UPDATE resources SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ? AND status = 'pending_review'`)
    .run(status, admin.id, note || null, id, admin.organizationId);
  if (result.changes === 0) throw new HttpError(409, 'That listing is not waiting for review.');
  recordAudit(admin, `resource.${status === 'approved' ? 'approve' : 'reject'}`, 'resources', id, note || '');
}

export const approveListing = (id, admin, note) => reviewListing(id, admin, 'approved', note?.trim());

export function rejectListing(id, admin, note)
{
  if (typeof note !== 'string' || !note.trim() || note.length > 300)
  {
    throw new HttpError(400, 'Give a short reason so the person who listed it knows what to change.');
  }
  reviewListing(id, admin, 'rejected', note.trim());
}
