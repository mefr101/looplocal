// Dashboard numbers and the Impact Ledger. Only completed transfers count, and savings are an
// estimate (quantity x the listing's replacement value), so the UI always labels them that way.
import
{
  db
} from '../database/db.js';

/** Numbers for one organization's dashboard. Every query is limited to that organization. */
export function getDashboardStats(organizationId)
{
  const count = (sql) => db.prepare(sql).get(organizationId).n;

  return (
    {
      availableResources: count(
        `SELECT COUNT(*) AS n FROM resources
       WHERE organization_id = ? AND status = 'approved' AND quantity_total - quantity_reserved > 0`),
      outstandingRequests: count("SELECT COUNT(*) AS n FROM requests WHERE organization_id = ? AND status = 'open'"),
      // Everything waiting on an admin: plans, new listings, and requests that need review.
      pendingApprovals: count("SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND status = 'pending_approval'") +
        count("SELECT COUNT(*) AS n FROM resources WHERE organization_id = ? AND status = 'pending_review'") +
        count("SELECT COUNT(*) AS n FROM requests WHERE organization_id = ? AND status = 'pending_review'"),
      completedTransfers: count('SELECT COUNT(*) AS n FROM impact_ledger WHERE organization_id = ?'),
      estimatedSavingsCents: count(
        'SELECT COALESCE(SUM(cost_avoided_cents), 0) AS n FROM impact_ledger WHERE organization_id = ?'),
    }
  );
}

/** The most recent completed transfers for one organization's dashboard (newest first). */
export function getRecentReuse(organizationId, limit = 5)
{
  return db.prepare(
    `SELECT l.resource_name, l.quantity, l.completed_at, l.cost_avoided_cents,
            su.name AS supplier_unit, ru.name AS receiver_unit
     FROM impact_ledger l
     JOIN units su ON su.id = l.supplier_unit_id
     JOIN units ru ON ru.id = l.receiver_unit_id
     WHERE l.organization_id = ?
     ORDER BY l.completed_at DESC, l.id DESC LIMIT ?`).all(organizationId, limit).map((row) => (
  {
    resourceName: row.resource_name,
    quantity: row.quantity,
    completedAt: row.completed_at,
    supplierUnit: row.supplier_unit,
    receiverUnit: row.receiver_unit,
    savingsCents: row.cost_avoided_cents,
  }));
}

/**
 * Totals safe to show on the public home page: platform-wide, completed transfers only,
 * with no organization named and nothing about individual items or people.
 */
export function getPublicStats()
{
  const row = db.prepare(
    `SELECT COUNT(*) AS transfers,
            COALESCE(SUM(quantity), 0) AS items,
            COALESCE(SUM(cost_avoided_cents), 0) AS savings
     FROM impact_ledger`).get();
  return (
    {
      completedTransfers: row.transfers,
      itemsReused: row.items,
      estimatedSavingsCents: row.savings,
      organizations: db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n,
    }
  );
}

// Ledger rows are written by services/transfers.js (completeTransfer).

// Analytics
export const ANALYTICS_RANGES = ['30', '90', 'all'];

const DAY_MS = 86_400_000;
const toIso = (date) => date.toISOString().slice(0, 10);
const fromIso = (iso) => new Date(`${iso}T00:00:00Z`);
/** The Monday of the week containing this date, as YYYY-MM-DD. */
function weekStart(iso)
{
  const date = fromIso(iso);
  return toIso(new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

function addMonth(iso)
{
  const date = fromIso(iso);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)));
}

/**
 * Estimated savings over time for one organization, from COMPLETED transfers only (the Impact Ledger).
 * range '30' or '90' = the last N days in weekly buckets; 'all' = every month since the first transfer.
 * Periods with no transfers are included as zeros so a chart does not skip them.
 * `today` (YYYY-MM-DD) exists so tests can fix the date.
 */
export function getSavingsOverTime(organizationId, range, today = toIso(new Date()))
{
  if (!ANALYTICS_RANGES.includes(range)) throw new RangeError('range must be 30, 90 or all');
  const monthly = range === 'all';

  const earliest = db.prepare('SELECT MIN(substr(completed_at, 1, 10)) AS d FROM impact_ledger WHERE organization_id = ?')
    .get(organizationId).d;
  const from = monthly ? (earliest ?? today) : toIso(new Date(fromIso(today).getTime() - (Number(range) - 1) * DAY_MS));
  const bucketOf = monthly ? monthStart : weekStart;

  const buckets = new Map();
  for (let key = bucketOf(from); key <= today; key = monthly ? addMonth(key) : toIso(new Date(fromIso(key).getTime() + 7 * DAY_MS)))
  {
    buckets.set(key,
    {
      start: key,
      transfers: 0,
      items: 0,
      savingsCents: 0
    });
  }

  const rows = db.prepare(
    `SELECT substr(completed_at, 1, 10) AS day, quantity, cost_avoided_cents FROM impact_ledger
     WHERE organization_id = ? AND substr(completed_at, 1, 10) BETWEEN ? AND ?`).all(organizationId, from, today);
  for (const row of rows)
  {
    const bucket = buckets.get(bucketOf(row.day));
    bucket.transfers += 1;
    bucket.items += row.quantity;
    bucket.savingsCents += row.cost_avoided_cents;
  }

  const list = [...buckets.values()];
  return (
    {
      range,
      granularity: monthly ? 'month' : 'week',
      from,
      to: today,
      buckets: list,
      totals:
      {
        transfers: list.reduce((sum, b) => sum + b.transfers, 0),
        items: list.reduce((sum, b) => sum + b.items, 0),
        savingsCents: list.reduce((sum, b) => sum + b.savingsCents, 0),
      },
    }
  );
}
