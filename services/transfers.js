// Hand-offs: one transfer per line of an approved plan. The supplying unit, the receiving unit or an
// admin can complete or cancel one, and completing always means the full planned quantity.
//
// Completing lowers the listing's stock, writes the Impact Ledger row (a snapshot, so later edits
// don't change history) and, once nothing is left scheduled, fulfils the request. Cancelling needs a
// reason and releases that line's stock. If no line was ever completed, the plan is cancelled and the
// request reopens so it can be matched again.
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

const SELECT_TRANSFER = `
  SELECT t.id, t.status, t.scheduled_for, t.completed_at,
         i.id AS item_id, i.quantity, i.pickup_note, i.reservation_id,
         p.request_id, p.organization_id,
         res.id AS resource_id, res.name AS resource_name, res.category_id, res.unit_id AS supplier_unit_id,
         res.replacement_value_cents,
         su.name AS supplier_unit, ru.name AS receiver_unit, rq.unit_id AS receiver_unit_id, rq.item_name AS request_item
  FROM transfers t
  JOIN reservation_items i ON i.id = t.reservation_item_id
  JOIN reservations p ON p.id = i.reservation_id
  JOIN resources res ON res.id = i.resource_id
  JOIN units su ON su.id = res.unit_id
  JOIN requests rq ON rq.id = p.request_id
  JOIN units ru ON ru.id = rq.unit_id`;


/** May this person act on the transfer? Admins always; others only for their own units. */
function mayAct(user, row)
{
  if (row.organization_id !== user.organizationId) return false;
  return user.isAdmin || user.units.some((unit) => unit.id === row.supplier_unit_id || unit.id === row.receiver_unit_id);
}

function toApi(row, user)
{
  const myUnits = new Set(user.units.map((unit) => unit.id));
  const isSupplier = myUnits.has(row.supplier_unit_id);
  const isReceiver = myUnits.has(row.receiver_unit_id);
  return (
    {
      id: row.id,
      status: row.status,
      quantity: row.quantity,
      resourceName: row.resource_name,
      requestItem: row.request_item,
      supplierUnit: row.supplier_unit,
      receiverUnit: row.receiver_unit,
      scheduledFor: row.scheduled_for,
      completedAt: row.completed_at,
      pickupNote: row.pickup_note,
      // 'give' = your unit supplies it, 'receive' = your unit asked for it. Admins who are neither see 'oversee'.
      role: isSupplier && !isReceiver ? 'give' : isReceiver && !isSupplier ? 'receive' : isSupplier ? 'both' : 'oversee',
      canAct: row.status === 'scheduled' && mayAct(user, row),
    }
  );
}

/**
 * Transfers the person can see: those for their own units (as supplier or receiver), or all of them
 * for an admin. Scheduled ones first by date, then recently completed or cancelled ones.
 */
export function listTransfers(user)
{
  const rows = db.prepare(
      `${SELECT_TRANSFER}
     WHERE p.organization_id = ? AND p.status IN ('approved', 'completed', 'cancelled')
     ORDER BY CASE t.status WHEN 'scheduled' THEN 0 ELSE 1 END, t.scheduled_for, t.id DESC`)
    .all(user.organizationId)
    .filter((row) => user.isAdmin || mayAct(user, row));
  return rows.map((row) => toApi(row, user));
}

function loadTransfer(id, user)
{
  const row = db.prepare(`${SELECT_TRANSFER} WHERE t.id = ?`).get(id);
  // Same rule as everywhere: something you may not see is "not found".
  if (!row || !mayAct(user, row)) throw new HttpError(404, 'Transfer not found.');
  if (row.status !== 'scheduled')
  {
    throw new HttpError(409, `This transfer is already ${row.status}.`);
  }
  return row;
}

/** After a line is completed or cancelled: close the plan and request if nothing is left scheduled. */
function settlePlan(row, user, cancelReason)
{
  const counts = db.prepare(
    `SELECT SUM(t.status = 'scheduled') AS scheduled, SUM(t.status = 'completed') AS completed
     FROM transfers t JOIN reservation_items i ON i.id = t.reservation_item_id
     WHERE i.reservation_id = ?`).get(row.reservation_id);
  if (counts.scheduled > 0) return 'in_progress';

  if (counts.completed > 0)
  {
    db.prepare("UPDATE reservations SET status = 'completed' WHERE id = ?").run(row.reservation_id);
    db.prepare("UPDATE requests SET status = 'fulfilled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.request_id);
    return 'fulfilled';
  }
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(row.reservation_id);
  db.prepare("UPDATE requests SET status = 'open', review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(cancelReason, row.request_id);
  return 'reopened';
}

/** Mark a hand-off done. Returns { requestStatus } so the page can say what happened. */
export function completeTransfer(id, user)
{
  return withTransaction(() =>
  {
    const row = loadTransfer(id, user);
    const stock = db.prepare(
      `UPDATE resources SET quantity_total = quantity_total - :qty, quantity_reserved = quantity_reserved - :qty
       WHERE id = :id AND quantity_reserved >= :qty`).run(
    {
      qty: row.quantity,
      id: row.resource_id
    });
    if (stock.changes === 0) throw new HttpError(409, 'The reserved stock for this transfer is missing. Ask an admin to check it.');

    const when = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare("UPDATE transfers SET status = 'completed', completed_at = ?, confirmed_by = ? WHERE id = ?")
      .run(when, user.id, id);
    db.prepare(
        `INSERT INTO impact_ledger (organization_id, transfer_id, resource_id, resource_name, category_id, quantity,
         supplier_unit_id, receiver_unit_id, completed_at, unit_value_cents, cost_avoided_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.organization_id, id, row.resource_id, row.resource_name, row.category_id, row.quantity,
        row.supplier_unit_id, row.receiver_unit_id, when, row.replacement_value_cents,
        row.quantity * row.replacement_value_cents);

    const outcome = settlePlan(row, user, null);
    recordAudit(user, 'transfer.complete', 'transfers', id, `${row.quantity} x ${row.resource_name}`);
    return (
      {
        requestStatus: outcome === 'fulfilled' ? 'fulfilled' : 'approved'
      }
    );
  });
}

/** Call off a scheduled hand-off. A reason is required. Returns { requestStatus }. */
export function cancelTransfer(id, user, reason)
{
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (!note || note.length > 300)
  {
    throw new HttpError(400, 'Give a short reason (up to 300 characters) so everyone knows why it was called off.');
  }
  return withTransaction(() =>
  {
    const row = loadTransfer(id, user);
    db.prepare('UPDATE resources SET quantity_reserved = quantity_reserved - ? WHERE id = ?')
      .run(row.quantity, row.resource_id);
    db.prepare("UPDATE transfers SET status = 'cancelled' WHERE id = ?").run(id);

    const outcome = settlePlan(row, user, `A hand-off was cancelled: ${note}`);
    recordAudit(user, 'transfer.cancel', 'transfers', id, note);
    return (
      {
        requestStatus: outcome === 'fulfilled' ? 'fulfilled' : outcome === 'reopened' ? 'open' : 'approved'
      }
    );
  });
}
