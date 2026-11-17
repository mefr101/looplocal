// Conflicts: things an admin may want to look at, raised automatically.
//
//   stock_shortfall    a submitted plan covers less than the request asked for (partial plan)
//   duplicate_listing  a unit published a listing with the same item tag as one of its own live listings
//
// date_clash and other exist in the schema but nothing raises them yet.
import
{
  db
} from '../database/db.js';
import
{
  HttpError
} from './errors.js';
import
{
  recordAudit
} from './audit.js';

export function raiseConflict(organizationId,
{
  kind,
  resourceId = null,
  reservationId = null,
  description
})
{
  return Number(db.prepare(
      'INSERT INTO conflicts (organization_id, kind, resource_id, reservation_id, description) VALUES (?, ?, ?, ?, ?)')
    .run(organizationId, kind, resourceId, reservationId, description).lastInsertRowid);
}

/** After a listing is saved: flag it if its unit already has another live listing with the same identity tag. */
export function checkDuplicateListing(organizationId, resourceId)
{
  const twin = db.prepare(
    `SELECT o.id, o.name FROM resources o
     JOIN resources me ON me.id = ? AND o.unit_id = me.unit_id AND o.id != me.id
     JOIN resource_tags ot ON ot.resource_id = o.id AND ot.kind = 'identity'
     JOIN resource_tags mt ON mt.resource_id = me.id AND mt.kind = 'identity' AND mt.tag = ot.tag
     WHERE o.organization_id = ? AND o.status IN ('pending_review', 'approved')
     ORDER BY o.id LIMIT 1`).get(resourceId, organizationId);
  if (!twin) return null;
  const me = db.prepare('SELECT name FROM resources WHERE id = ?').get(resourceId);
  return raiseConflict(organizationId,
  {
    kind: 'duplicate_listing',
    resourceId,
    description: `"${me.name}" looks like a duplicate of "${twin.name}" (listing #${twin.id}) from the same unit.`,
  });
}

const KIND_LABELS =
{
  stock_shortfall: 'Short on stock',
  date_clash: 'Date clash',
  duplicate_listing: 'Possible duplicate',
  other: 'Other',
};

export function listOpenConflicts(admin)
{
  return db.prepare(
      "SELECT * FROM conflicts WHERE organization_id = ? AND status = 'open' ORDER BY created_at, id")
    .all(admin.organizationId).map((row) => (
    {
      id: row.id,
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind],
      description: row.description,
      resourceId: row.resource_id,
      reservationId: row.reservation_id,
      createdAt: row.created_at,
    }));
}

export function resolveConflict(id, admin, note)
{
  if (typeof note !== 'string' || !note.trim() || note.length > 300)
  {
    throw new HttpError(400, 'Add a short note saying how this was resolved.');
  }
  const result = db.prepare(
    `UPDATE conflicts SET status = 'resolved', resolution_note = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
     WHERE id = ? AND organization_id = ? AND status = 'open'`).run(note.trim(), admin.id, id, admin.organizationId);
  if (result.changes === 0)
  {
    const exists = db.prepare('SELECT 1 FROM conflicts WHERE id = ? AND organization_id = ?').get(id, admin.organizationId);
    throw new HttpError(exists ? 409 : 404, exists ? 'That conflict is already resolved.' : 'Conflict not found.');
  }
  recordAudit(admin, 'conflict.resolve', 'conflicts', id, note.trim());
}
