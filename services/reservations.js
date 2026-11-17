// Reserving stock for a plan, and admin review of submitted plans.
//
// submitPlan rebuilds the plan on the server and compares its signature with the one the requester
// saw. If stock changed, nothing is reserved and the new plan comes back. Otherwise every line is
// reserved inside one transaction, so a plan gets all of its stock or none of it. The organization's
// plan rule decides whether an admin has to approve it first.
//
// Completing hand-offs and writing the Impact Ledger happens in transfers.js.
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
  buildFulfillmentPlan,
  loadRequestForPlan
} from './matching.js';
import
{
  raiseConflict
} from './conflicts.js';
import
{
  canManage,
  getRequest
} from './requests.js';

/** Does the organization's rule send this plan to an admin? */
export function planNeedsApproval(organizationId, totalValueCents)
{
  const org = db.prepare(
    'SELECT plan_approval_mode, plan_approval_threshold_cents FROM organizations WHERE id = ?').get(organizationId);
  if (org.plan_approval_mode === 'always') return true;
  if (org.plan_approval_mode === 'never') return false;
  return totalValueCents >= org.plan_approval_threshold_cents;
}

/** One scheduled transfer per reservation line. Called when a plan becomes approved. */
export function createTransfers(reservationId)
{
  const items = db.prepare('SELECT id, handoff_date FROM reservation_items WHERE reservation_id = ? ORDER BY id').all(reservationId);
  const insert = db.prepare("INSERT INTO transfers (reservation_item_id, status, scheduled_for) VALUES (?, 'scheduled', ?)");
  for (const item of items) insert.run(item.id, item.handoff_date);
}

// Submits the plan the requester is looking at. Returns the new plan instead if it changed in the meantime.
export function submitPlan(user, requestId,
{
  substituteIds = [],
  signature
} =
{})
{
  // Same visibility rule as everywhere else: a request you may not see is "not found".
  getRequest(requestId, user);
  if (!canManage(user, loadRequestForPlan(requestId, user.organizationId)))
  {
    throw new HttpError(403, 'Only the person who made this request, a manager of its unit, or an admin can submit its plan.');
  }

  return withTransaction(() =>
  {
    const request = loadRequestForPlan(requestId, user.organizationId);
    if (!request) throw new HttpError(404, 'Request not found.');
    if (request.status !== 'open')
    {
      throw new HttpError(409, request.status === 'pending_review' ?
        'This request is still waiting for an admin to review it.' :
        'A plan has already been submitted for this request, or the request is closed.');
    }

    const plan = buildFulfillmentPlan(request, substituteIds);
    if (typeof signature !== 'string' || signature !== plan.signature) return (
      {
        status: 'changed',
        plan
      }
    );
    if (!plan.canSubmit) throw new HttpError(409, plan.blockedReason);

    // All-or-nothing: if any line cannot be reserved, the whole transaction is rolled back.
    const reserve = db.prepare(
      `UPDATE resources SET quantity_reserved = quantity_reserved + :qty
       WHERE id = :id AND organization_id = :org AND status = 'approved'
         AND quantity_total - quantity_reserved >= :qty`);
    for (const line of plan.lines)
    {
      const result = reserve.run(
      {
        qty: line.quantity,
        id: line.resourceId,
        org: user.organizationId
      });
      if (result.changes === 0) throw new HttpError(409, 'Some of that stock was just taken. Please review the updated plan.');
    }

    const needsApproval = planNeedsApproval(user.organizationId, plan.totalValueCents);
    const reservationId = Number(db.prepare(
        `INSERT INTO reservations (organization_id, request_id, status, created_by, review_note, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?)`)
      .run(user.organizationId, requestId, needsApproval ? 'pending_approval' : 'approved', user.id,
        needsApproval ? null : "Approved automatically by your organization's plan rule.",
        needsApproval ? null : new Date().toISOString().slice(0, 19).replace('T', ' ')).lastInsertRowid);

    const insertLine = db.prepare(
      `INSERT INTO reservation_items (reservation_id, resource_id, quantity, match_type, reason, pickup_note, handoff_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const line of plan.lines)
    {
      insertLine.run(reservationId, line.resourceId, line.quantity, line.matchType, line.reason,
        line.handoff.summary, line.handoff.date);
    }
    if (!needsApproval) createTransfers(reservationId);
    if (plan.covered < plan.requested)
    {
      raiseConflict(user.organizationId,
      {
        kind: 'stock_shortfall',
        reservationId,
        description: `Plan for "${request.item_name}" covers ${plan.covered} of ${plan.requested}.`,
      });
    }

    const requestStatus = needsApproval ? 'pending_approval' : 'approved';
    db.prepare("UPDATE requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(requestStatus, requestId);
    recordAudit(user, 'plan.submit', 'reservations', reservationId,
      `${plan.covered}/${plan.requested} ${needsApproval ? 'awaiting approval' : 'auto-approved'}`);
    return (
      {
        status: 'submitted',
        reservationId,
        requestStatus,
        needsApproval,
        plan
      }
    );
  });
}

// Admin review of submitted plans
/** Plans waiting for an admin, oldest first, with each line and the plan's estimated value. */
export function listPendingPlans(admin)
{
  const plans = db.prepare(
    `SELECT p.id, p.request_id, p.created_at, r.item_name, r.quantity AS requested, r.needed_by,
            u.name AS unit_name, s.name AS submitter_name
     FROM reservations p
     JOIN requests r ON r.id = p.request_id
     JOIN units u ON u.id = r.unit_id
     JOIN users s ON s.id = p.created_by
     WHERE p.organization_id = ? AND p.status = 'pending_approval'
     ORDER BY p.created_at, p.id`).all(admin.organizationId);
  const lines = db.prepare(
    `SELECT i.quantity, i.match_type, i.reason, i.handoff_date, i.pickup_note,
            res.name AS resource_name, su.name AS supplier_unit,
            i.quantity * res.replacement_value_cents AS value_cents
     FROM reservation_items i
     JOIN resources res ON res.id = i.resource_id
     JOIN units su ON su.id = res.unit_id
     WHERE i.reservation_id = ? ORDER BY i.id`);
  return plans.map((plan) =>
  {
    const items = lines.all(plan.id).map((l) => (
    {
      resourceName: l.resource_name,
      supplierUnit: l.supplier_unit,
      quantity: l.quantity,
      matchType: l.match_type,
      reason: l.reason,
      handoffDate: l.handoff_date,
      pickupNote: l.pickup_note,
      valueCents: l.value_cents,
    }));
    return (
      {
        id: plan.id,
        requestId: plan.request_id,
        itemName: plan.item_name,
        requested: plan.requested,
        neededBy: plan.needed_by,
        unitName: plan.unit_name,
        submittedBy: plan.submitter_name,
        covered: items.reduce((sum, l) => sum + l.quantity, 0),
        totalValueCents: items.reduce((sum, l) => sum + l.valueCents, 0),
        lines: items,
      }
    );
  });
}

function loadPendingPlan(id, admin)
{
  const plan = db.prepare('SELECT * FROM reservations WHERE id = ? AND organization_id = ?').get(id, admin.organizationId);
  if (!plan) throw new HttpError(404, 'Plan not found.');
  if (plan.status !== 'pending_approval') throw new HttpError(409, 'That plan is not waiting for approval.');
  return plan;
}

const NOW = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Approve: stock stays reserved, transfers are scheduled, the request becomes approved. */
export function approvePlan(id, admin, note)
{
  withTransaction(() =>
  {
    const plan = loadPendingPlan(id, admin);
    db.prepare("UPDATE reservations SET status = 'approved', reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?")
      .run(admin.id, note?.trim() || null, NOW(), id);
    createTransfers(id);
    db.prepare("UPDATE requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(plan.request_id);
    recordAudit(admin, 'plan.approve', 'reservations', id, note?.trim() || '');
  });
}

/** Reject: give the stock back and reopen the request so it can be matched again. A reason is required. */
export function rejectPlan(id, admin, note)
{
  if (typeof note !== 'string' || !note.trim() || note.length > 300)
  {
    throw new HttpError(400, 'Give a short reason so the requester knows what happened.');
  }
  withTransaction(() =>
  {
    const plan = loadPendingPlan(id, admin);
    const release = db.prepare('UPDATE resources SET quantity_reserved = quantity_reserved - ? WHERE id = ?');
    for (const line of db.prepare('SELECT resource_id, quantity FROM reservation_items WHERE reservation_id = ?').all(id))
    {
      release.run(line.quantity, line.resource_id);
    }
    db.prepare("UPDATE reservations SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?")
      .run(admin.id, note.trim(), NOW(), id);
    db.prepare("UPDATE requests SET status = 'open', review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(note.trim(), plan.request_id);
    recordAudit(admin, 'plan.reject', 'reservations', id, note.trim());
  });
}
