// Requests: validation, saving, editing, cancelling, and the admin review step.
//
// Rules in one place
//   * A request belongs to a UNIT (the department, club or team that needs the item) in the
//     signed-in person's organization. People can only request for units they belong to;
//     org admins can request for any unit.
//   * If the organization turned on "review requests", a new request waits in
//     'pending_review' until an admin approves it. Admins' own requests skip review.
//   * Visibility: people see requests from their own units; admins see the whole organization.
//   * Edit: only while 'pending_review' or 'open' (no stock reserved yet).
//   * Cancel: while 'pending_review', 'open', or 'pending_approval'. Cancelling a request
//     with a submitted plan releases the stock that plan had reserved.
//   * Every query is limited to the person's organization.
import { db, withTransaction } from '../database/db.js';
import { HttpError } from './errors.js';
import { recordAudit } from './audit.js';
import { requestableUnits } from './permissions.js';
import { normalizeTag, humanizeTag } from './tags.js';
import { FieldErrors, isIsoDate, isNonEmptyString, isTime, isoDateFromToday } from './validation.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const FULFILLMENT_METHODS = ['pickup', 'delivery'];
export const LIMITS = { itemName: 100, intendedUse: 500, notes: 300, maxQuantity: 10000, maxDaysAhead: 365 };

const EDITABLE = ['pending_review', 'open'];
const CANCELLABLE = ['pending_review', 'open', 'pending_approval'];

// --- Validation ---------------------------------------------------------------

/**
 * Check a request submitted from the form. Returns the cleaned values plus any
 * field errors; nothing is saved here. Used for both creating and editing.
 */
export function validateRequest(body, user) {
  const input = body ?? {};
  const errors = new FieldErrors();
  const values = {};

  // Which unit is asking? Must be one this person may act for.
  const allowed = requestableUnits(user);
  const unitId = input.unitId ?? (allowed.length === 1 ? allowed[0].id : null);
  if (allowed.length === 0) {
    errors.add('unitId', 'You are not part of any unit yet. Ask an organization admin to add you to one.');
  } else if (!allowed.some((unit) => unit.id === unitId)) {
    errors.add('unitId', 'Choose the unit this request is for.');
  } else {
    values.unitId = unitId;
  }

  if (!isNonEmptyString(input.itemName, { max: LIMITS.itemName })) {
    errors.add('itemName', `Enter the item you need (up to ${LIMITS.itemName} characters).`);
  } else {
    values.itemName = input.itemName.trim();
    // Prefer the tag chosen from the suggestions; otherwise derive one from the name.
    values.needTag = normalizeTag(typeof input.needTag === 'string' && input.needTag ? input.needTag : values.itemName);
    if (!values.needTag) errors.add('itemName', 'Use letters or numbers in the item name.');
  }

  const category = Number.isInteger(input.categoryId)
    ? db.prepare('SELECT id FROM categories WHERE id = ? AND organization_id = ?').get(input.categoryId, user.organizationId)
    : null;
  if (!category) errors.add('categoryId', 'Choose a category.');
  else values.categoryId = category.id;

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > LIMITS.maxQuantity) {
    errors.add('quantity', `Enter a whole number from 1 to ${LIMITS.maxQuantity.toLocaleString('en-US')}.`);
  } else {
    values.quantity = input.quantity;
  }

  if (!isNonEmptyString(input.intendedUse, { min: 5, max: LIMITS.intendedUse })) {
    errors.add('intendedUse', `Describe how you will use it (5 to ${LIMITS.intendedUse} characters).`);
  } else {
    values.intendedUse = input.intendedUse.trim();
  }

  const earliest = isoDateFromToday(0);
  const latest = isoDateFromToday(LIMITS.maxDaysAhead);
  if (!isIsoDate(input.neededBy)) errors.add('neededBy', 'Choose the date you need it by.');
  else if (input.neededBy < earliest) errors.add('neededBy', 'The date cannot be in the past.');
  else if (input.neededBy > latest) errors.add('neededBy', 'Choose a date within the next year.');
  else values.neededBy = input.neededBy;

  // Hand-off: pickup (you collect) or delivery (brought to a location you choose).
  if (!FULFILLMENT_METHODS.includes(input.fulfillmentMethod)) {
    errors.add('fulfillmentMethod', 'Choose pickup or delivery.');
  } else {
    values.fulfillmentMethod = input.fulfillmentMethod;
    values.deliverToLocationId = null;
    if (input.fulfillmentMethod === 'delivery') {
      const place = Number.isInteger(input.deliverToLocationId)
        ? db.prepare('SELECT id FROM locations WHERE id = ? AND organization_id = ?')
          .get(input.deliverToLocationId, user.organizationId) : null;
      if (!place) errors.add('deliverToLocationId', 'Choose where it should be delivered.');
      else values.deliverToLocationId = place.id;
    }
  }

  // Availability days: any subset of the week. Empty means "any day".
  const days = input.pickupDays ?? [];
  if (!Array.isArray(days) || days.some((day) => !WEEKDAYS.includes(day))) {
    errors.add('pickupDays', 'Choose days from the list.');
  } else {
    values.pickupDays = WEEKDAYS.filter((day) => days.includes(day)); // dedupe and order Mon..Sun
  }

  // Availability window: both times or neither.
  const start = input.pickupTimeStart || null;
  const end = input.pickupTimeEnd || null;
  if ((start && !isTime(start)) || (end && !isTime(end))) {
    errors.add('pickupTimeStart', 'Enter times like 15:30.');
  } else if (Boolean(start) !== Boolean(end)) {
    errors.add('pickupTimeStart', 'Enter both an earliest and a latest time, or leave both empty.');
  } else if (start && end && start >= end) {
    errors.add('pickupTimeEnd', 'The latest time must be after the earliest time.');
  } else {
    values.pickupTimeStart = start;
    values.pickupTimeEnd = end;
  }

  const notes = input.notes ?? '';
  if (typeof notes !== 'string' || notes.trim().length > LIMITS.notes) {
    errors.add('notes', `Keep notes under ${LIMITS.notes} characters.`);
  } else {
    values.notes = notes.trim();
  }

  for (const [field, message] of [['acceptsSubstitutes', 'Choose yes or no.'], ['acceptsPartial', 'Choose yes or no.']]) {
    const value = input[field] ?? false;
    if (typeof value !== 'boolean') errors.add(field, message);
    else values[field] = value;
  }

  return { errors, values };
}

// --- Shaping rows for the API ---------------------------------------------------

const SELECT_REQUEST = `
  SELECT r.*, c.name AS category_name, un.name AS unit_name, u.name AS requester_name,
         dl.name AS deliver_to_location_name
  FROM requests r
  JOIN categories c ON c.id = r.category_id
  JOIN units un ON un.id = r.unit_id
  JOIN users u ON u.id = r.requested_by
  LEFT JOIN locations dl ON dl.id = r.deliver_to_location_id`;

/** Admins see every request in their organization; others see their units' requests and their own. */
function canSee(user, row) {
  if (row.organization_id !== user.organizationId) return false;
  return user.isAdmin || row.requested_by === user.id || user.units.some((unit) => unit.id === row.unit_id);
}

/** Who may change a request: an admin, the person who made it, or a manager of its unit. */
function canManage(user, row) {
  if (row.organization_id !== user.organizationId) return false;
  return user.isAdmin || row.requested_by === user.id ||
    user.units.some((unit) => unit.id === row.unit_id && unit.role === 'manager');
}

function toApi(row, user) {
  const manage = user ? canManage(user, row) : false;
  return {
    id: row.id,
    unitId: row.unit_id,
    unitName: row.unit_name,
    itemName: row.item_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    needTag: row.need_tag,
    quantity: row.quantity,
    intendedUse: row.intended_use,
    neededBy: row.needed_by,
    pickupDays: row.pickup_days ? row.pickup_days.split(',') : [],
    pickupTimeStart: row.pickup_time_start,
    pickupTimeEnd: row.pickup_time_end,
    fulfillmentMethod: row.fulfillment_method,
    deliverToLocationId: row.deliver_to_location_id,
    deliverToLocationName: row.deliver_to_location_name,
    notes: row.notes,
    acceptsSubstitutes: row.accepts_substitutes === 1,
    acceptsPartial: row.accepts_partial === 1,
    status: row.status,
    reviewNote: row.review_note,
    requesterName: row.requester_name,
    createdAt: row.created_at,
    canEdit: manage && EDITABLE.includes(row.status),
    canCancel: manage && CANCELLABLE.includes(row.status),
  };
}

function toColumns(values) {
  return {
    unit: values.unitId, item: values.itemName, category: values.categoryId, tag: values.needTag,
    qty: values.quantity, use: values.intendedUse, by: values.neededBy, days: values.pickupDays.join(','),
    start: values.pickupTimeStart, end: values.pickupTimeEnd, method: values.fulfillmentMethod,
    place: values.deliverToLocationId, notes: values.notes,
    subs: values.acceptsSubstitutes ? 1 : 0, partial: values.acceptsPartial ? 1 : 0,
  };
}

// --- Create, read, edit, cancel -------------------------------------------------

export function createRequest(user, values) {
  const needsReview = !user.isAdmin &&
    db.prepare('SELECT review_requests FROM organizations WHERE id = ?').get(user.organizationId).review_requests === 1;
  const status = needsReview ? 'pending_review' : 'open';
  const id = Number(db.prepare(
    `INSERT INTO requests (organization_id, unit_id, requested_by, item_name, category_id, need_tag, quantity,
       intended_use, needed_by, pickup_days, pickup_time_start, pickup_time_end, fulfillment_method,
       deliver_to_location_id, notes, accepts_substitutes, accepts_partial, status)
     VALUES (:org, :unit, :user, :item, :category, :tag, :qty, :use, :by, :days, :start, :end, :method,
       :place, :notes, :subs, :partial, :status)`)
    .run({ org: user.organizationId, user: user.id, status, ...toColumns(values) }).lastInsertRowid);
  recordAudit(user, 'request.create', 'requests', id, status);
  return getRequest(id, user);
}

/** One request, only if this person may see it. Anything else is "not found". */
export function getRequest(id, user) {
  const row = db.prepare(`${SELECT_REQUEST} WHERE r.id = ?`).get(id);
  if (!row || !canSee(user, row)) throw new HttpError(404, 'Request not found.');
  return toApi(row, user);
}

export function listRequestsForUser(user) {
  const order = 'ORDER BY r.created_at DESC, r.id DESC';
  const rows = user.isAdmin
    ? db.prepare(`${SELECT_REQUEST} WHERE r.organization_id = ? ${order}`).all(user.organizationId)
    : db.prepare(
      `${SELECT_REQUEST} WHERE r.organization_id = ?
         AND (r.requested_by = ? OR r.unit_id IN (SELECT unit_id FROM user_units WHERE user_id = ?)) ${order}`)
      .all(user.organizationId, user.id, user.id);
  return rows.map((row) => toApi(row, user));
}

export function updateRequest(id, user, values) {
  const current = getRequest(id, user);
  if (!current.canEdit) {
    throw new HttpError(409, EDITABLE.includes(current.status)
      ? 'You do not have permission to edit this request.'
      : 'This request can no longer be edited because a plan has been submitted. You can cancel it instead.');
  }
  db.prepare(
    `UPDATE requests SET unit_id = :unit, item_name = :item, category_id = :category, need_tag = :tag,
       quantity = :qty, intended_use = :use, needed_by = :by, pickup_days = :days,
       pickup_time_start = :start, pickup_time_end = :end, fulfillment_method = :method,
       deliver_to_location_id = :place, notes = :notes, accepts_substitutes = :subs,
       accepts_partial = :partial, updated_at = CURRENT_TIMESTAMP
     WHERE id = :id AND organization_id = :org AND status IN ('pending_review', 'open')`)
    .run({ id, org: user.organizationId, ...toColumns(values) });
  recordAudit(user, 'request.update', 'requests', id);
  return getRequest(id, user);
}

export function cancelRequest(id, user) {
  withTransaction(() => {
    const current = getRequest(id, user);
    if (!current.canCancel) {
      throw new HttpError(409, CANCELLABLE.includes(current.status)
        ? 'You do not have permission to cancel this request.'
        : 'This request can no longer be cancelled here. Ask an administrator for help.');
    }

    // A submitted plan has reserved stock. Give it back so other requests can use it.
    if (current.status === 'pending_approval') {
      const plans = db.prepare(
        "SELECT id FROM reservations WHERE request_id = ? AND status = 'pending_approval'").all(id);
      for (const plan of plans) {
        const lines = db.prepare('SELECT resource_id, quantity FROM reservation_items WHERE reservation_id = ?').all(plan.id);
        for (const line of lines) {
          db.prepare('UPDATE resources SET quantity_reserved = quantity_reserved - ? WHERE id = ?')
            .run(line.quantity, line.resource_id);
        }
        db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(plan.id);
      }
    }
    db.prepare("UPDATE requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    recordAudit(user, 'request.cancel', 'requests', id, current.status);
  });
}

// --- Admin review ---------------------------------------------------------------

export function listPendingReview(admin) {
  return db.prepare(`${SELECT_REQUEST} WHERE r.organization_id = ? AND r.status = 'pending_review' ORDER BY r.created_at`)
    .all(admin.organizationId).map((row) => toApi(row, null));
}

function review(id, admin, decision, note) {
  const exists = db.prepare('SELECT 1 FROM requests WHERE id = ? AND organization_id = ?').get(id, admin.organizationId);
  if (!exists) throw new HttpError(404, 'Request not found.');
  const result = db.prepare(
    `UPDATE requests SET status = :status, reviewed_by = :admin, reviewed_at = CURRENT_TIMESTAMP,
       review_note = :note, updated_at = CURRENT_TIMESTAMP
     WHERE id = :id AND organization_id = :org AND status = 'pending_review'`)
    .run({ status: decision === 'approve' ? 'open' : 'rejected', admin: admin.id, note: note || null, id, org: admin.organizationId });
  if (result.changes === 0) throw new HttpError(409, 'That request is not waiting for review.');
  recordAudit(admin, `request.${decision}`, 'requests', id, note || '');
}

export const approveRequest = (id, admin, note) => review(id, admin, 'approve', note);

export function rejectRequest(id, admin, note) {
  if (!isNonEmptyString(note, { max: 300 })) {
    throw new HttpError(400, 'Give a short reason so the requester knows what to change.');
  }
  review(id, admin, 'reject', note.trim());
}

// --- Item suggestions for the type-ahead ---------------------------------------

/**
 * Suggest item types people could ask for, based on what OTHER units in the same
 * organization have listed. Each suggestion shows how many are available now, so a
 * requester can see supply while typing. Empty `query` returns the most plentiful items.
 * `unitId` (optional) is the requesting unit; its own listings are left out.
 */
export function suggestItems(query, user, unitId) {
  const cleaned = String(query ?? '').toLowerCase().replace(/[%_\\]/g, '').trim().slice(0, 60);
  const rows = db.prepare(
    `SELECT t.tag, r.category_id, c.name AS category_name,
            SUM(r.quantity_total - r.quantity_reserved) AS available
     FROM resource_tags t
     JOIN resources r ON r.id = t.resource_id
     JOIN categories c ON c.id = r.category_id
     WHERE r.organization_id = :org
       AND t.kind = 'identity' AND r.status = 'approved'
       AND r.quantity_total - r.quantity_reserved > 0
       AND r.unit_id IS NOT :unit
       AND (:q = '' OR t.tag LIKE :tagLike OR lower(r.name) LIKE :nameLike)
     GROUP BY t.tag, r.category_id
     ORDER BY available DESC, t.tag
     LIMIT 40`).all({
    org: user.organizationId, unit: Number.isInteger(unitId) ? unitId : null, q: cleaned,
    tagLike: `%${normalizeTag(cleaned) || cleaned}%`, nameLike: `%${cleaned}%`,
  });

  // One suggestion per tag (largest category first), up to 8.
  const seen = new Map();
  for (const row of rows) {
    const existing = seen.get(row.tag);
    if (existing) { existing.available += row.available; continue; }
    seen.set(row.tag, {
      tag: row.tag, label: humanizeTag(row.tag), categoryId: row.category_id,
      categoryName: row.category_name, available: row.available,
    });
  }
  return [...seen.values()].slice(0, 8);
}
