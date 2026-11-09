// Reservations - the code that prevents two requests from claiming the same stock.
//
// Planned flow for submitPlan(requestId, userId):
//   1. withTransaction(...)             -> BEGIN IMMEDIATE (takes the write lock)
//   2. Re-run buildFulfillmentPlan()    -> never trust a plan the browser sends back
//   3. For each line:
//        UPDATE resources
//           SET quantity_reserved = quantity_reserved + :qty
//         WHERE id = :id AND status = 'approved'
//           AND quantity_total - quantity_reserved >= :qty
//        If zero rows changed, stock was taken -> throw, which rolls back the
//        whole plan (all-or-nothing).
//   4. Insert reservation + reservation_items, set request.status = 'pending_approval'.
//   5. COMMIT.
//
// Also planned: approveReservation, rejectReservation (release stock),
// completeTransfer (reduce quantity_total and quantity_reserved, write the
// impact ledger row, all in one transaction).
import { withTransaction } from '../database/db.js';

export function submitPlan(_requestId, _userId) {
  return withTransaction(() => {
    throw new Error('submitPlan is not implemented yet.');
  });
}
