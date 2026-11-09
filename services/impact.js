// Impact Ledger and dashboard statistics.
//
// Rules
//   * Only COMPLETED transfers appear in the ledger, so only they count as impact.
//   * Savings are an ESTIMATE: quantity x the replacement value recorded on the listing.
//     The UI must label every savings figure as an estimate.
import { db } from '../database/db.js';

export function getDashboardStats() {
  const count = (sql) => db.prepare(sql).get().n;

  return {
    availableResources: count(
      `SELECT COUNT(*) AS n FROM resources
       WHERE status = 'approved' AND quantity_total - quantity_reserved > 0`),
    outstandingRequests: count("SELECT COUNT(*) AS n FROM requests WHERE status = 'open'"),
    pendingApprovals:
      count("SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending_approval'") +
      count("SELECT COUNT(*) AS n FROM resources WHERE status = 'pending_review'"),
    completedTransfers: count('SELECT COUNT(*) AS n FROM impact_ledger'),
    estimatedSavingsCents: count('SELECT COALESCE(SUM(cost_avoided_cents), 0) AS n FROM impact_ledger'),
  };
}

/**
 * Numbers safe to show on the public home page. Only totals from COMPLETED
 * transfers (the impact ledger), never anything about individual requests or people.
 */
export function getPublicStats() {
  const row = db.prepare(
    `SELECT COUNT(*) AS transfers,
            COALESCE(SUM(quantity), 0) AS items,
            COALESCE(SUM(cost_avoided_cents), 0) AS savings
     FROM impact_ledger`).get();
  return {
    completedTransfers: row.transfers,
    itemsReused: row.items,
    estimatedSavingsCents: row.savings,
    organizations: db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n,
  };
}

// TODO: recordCompletedTransfer(transferId) - called inside the transfer-completion
//       transaction; snapshots names/values into impact_ledger.
