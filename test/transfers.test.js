// Tests for completing and cancelling hand-offs and the Impact Ledger. Run with: npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-transfer-test-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), RATE_LIMIT_DISABLED: '1' });
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env: process.env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const { loadUserById } = await import('../services/users.js');
const { buildFulfillmentPlan, loadRequestForPlan } = await import('../services/matching.js');
const { submitPlan } = await import('../services/reservations.js');
const { listTransfers, completeTransfer, cancelTransfer } = await import('../services/transfers.js');
const { getDashboardStats, getPublicStats, getSavingsOverTime } = await import('../services/impact.js');

after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const userByEmail = (email) => loadUserById(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
const admin = userByEmail('admin@mapleridge.example');
const council = userByEmail('council@mapleridge.example'); // receiver: Student Council
const science = userByEmail('science@mapleridge.example'); // supplier of the containers
const art = userByEmail('art@mapleridge.example'); // unrelated unit
const riverside = userByEmail('admin@riverside.example');

// Each test starts from the demo stock, so remember it.
const originalTotals = db.prepare('SELECT id, quantity_total FROM resources').all();

/** Council's container request, submitted with every suggested substitute ticked, and auto-approved. */
function approvedPlan() {
  db.prepare("UPDATE organizations SET plan_approval_mode = 'never' WHERE id = ?").run(admin.organizationId);
  const restore = db.prepare('UPDATE resources SET quantity_total = ?, quantity_reserved = 0 WHERE id = ?');
  for (const r of originalTotals) restore.run(r.quantity_total, r.id);
  db.prepare("UPDATE requests SET status = 'open' WHERE requested_by = ? AND item_name LIKE '%ontainer%'").run(council.id);
  const request = db.prepare("SELECT id FROM requests WHERE requested_by = ? AND item_name LIKE '%ontainer%'").get(council.id);
  const row = loadRequestForPlan(request.id, admin.organizationId);
  const substituteIds = buildFulfillmentPlan(row).suggestions.map((s) => s.resourceId);
  const plan = buildFulfillmentPlan(row, substituteIds);
  const { reservationId } = submitPlan(council, request.id, { substituteIds, signature: plan.signature });
  const transferIds = db.prepare(
    'SELECT t.id FROM transfers t JOIN reservation_items i ON i.id = t.reservation_item_id WHERE i.reservation_id = ? ORDER BY t.id')
    .all(reservationId).map((r) => r.id);
  return { requestId: request.id, reservationId, transferIds };
}

const stock = () => db.prepare(
  'SELECT SUM(quantity_total) AS total, SUM(quantity_reserved) AS reserved FROM resources WHERE organization_id = ?').get(admin.organizationId);
const requestStatus = (id) => db.prepare('SELECT status FROM requests WHERE id = ?').get(id).status;

describe('completing transfers', () => {
  test('it lowers stock exactly, writes a ledger snapshot, and fulfils the request after the last line', () => {
    const { requestId, transferIds } = approvedPlan();
    assert.ok(transferIds.length >= 2, 'the demo plan has several lines');
    const before = stock();
    const ledgerBefore = db.prepare('SELECT COUNT(*) AS n FROM impact_ledger').get().n;
    const statsBefore = getDashboardStats(admin.organizationId);

    const line = db.prepare(
      `SELECT i.quantity, res.replacement_value_cents AS value FROM transfers t
       JOIN reservation_items i ON i.id = t.reservation_item_id
       JOIN resources res ON res.id = i.resource_id WHERE t.id = ?`).get(transferIds[0]);
    assert.equal(completeTransfer(transferIds[0], science).requestStatus, 'approved', 'other lines are still waiting');
    const mid = stock();
    assert.equal(before.total - mid.total, line.quantity);
    assert.equal(before.reserved - mid.reserved, line.quantity);
    const entry = db.prepare('SELECT * FROM impact_ledger WHERE transfer_id = ?').get(transferIds[0]);
    assert.equal(entry.quantity, line.quantity);
    assert.equal(entry.cost_avoided_cents, line.quantity * line.value);

    assert.throws(() => completeTransfer(transferIds[0], admin), /already completed/);
    for (const id of transferIds.slice(1, -1)) completeTransfer(id, council);
    assert.equal(requestStatus(requestId), 'approved');
    assert.equal(completeTransfer(transferIds.at(-1), admin).requestStatus, 'fulfilled');
    assert.equal(requestStatus(requestId), 'fulfilled');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM impact_ledger').get().n, ledgerBefore + transferIds.length);

    const statsAfter = getDashboardStats(admin.organizationId);
    assert.equal(statsAfter.completedTransfers, statsBefore.completedTransfers + transferIds.length);
    assert.ok(statsAfter.estimatedSavingsCents > statsBefore.estimatedSavingsCents);
    assert.ok(getPublicStats().completedTransfers >= statsAfter.completedTransfers);
  });

  test('a later edit to the listing does not change the ledger', () => {
    const entry = db.prepare('SELECT id, resource_id, unit_value_cents, resource_name FROM impact_ledger ORDER BY id DESC LIMIT 1').get();
    db.prepare("UPDATE resources SET name = 'Renamed', replacement_value_cents = 999999 WHERE id = ?").run(entry.resource_id);
    const after = db.prepare('SELECT unit_value_cents, resource_name FROM impact_ledger WHERE id = ?').get(entry.id);
    assert.equal(after.unit_value_cents, entry.unit_value_cents);
    assert.equal(after.resource_name, entry.resource_name);
  });

  test('only the two units and admins may act; other organizations get not found', () => {
    const { transferIds } = approvedPlan();
    assert.throws(() => completeTransfer(transferIds[0], art), /not found/i);
    assert.throws(() => completeTransfer(transferIds[0], riverside), /not found/i);
    assert.throws(() => cancelTransfer(transferIds[0], riverside, 'x'), /not found/i);
    assert.equal(listTransfers(riverside).filter((t) => transferIds.includes(t.id)).length, 0);
    // Art supplies one line of this plan, so it sees that line only, never the rest.
    const artSees = listTransfers(art).filter((t) => transferIds.includes(t.id));
    assert.ok(artSees.length < transferIds.length);
    assert.ok(artSees.every((t) => t.supplierUnit === 'Art Department' || t.receiverUnit === 'Art Department'));
    const mine = listTransfers(council).filter((t) => transferIds.includes(t.id));
    assert.ok(mine.length > 0 && mine.every((t) => t.role === 'receive' && t.canAct));
  });
});

describe('analytics follows completed hand-offs', () => {
  test('completing a transfer raises the chart data by exactly its value; cancelling or scheduling does not', () => {
    const { transferIds } = approvedPlan();
    const today = new Date().toISOString().slice(0, 10);
    const before = getSavingsOverTime(admin.organizationId, '30', today).totals;

    // Scheduled and cancelled transfers are not impact.
    cancelTransfer(transferIds[0], admin, 'Test');
    assert.deepEqual(getSavingsOverTime(admin.organizationId, '30', today).totals, before);

    const line = db.prepare(
      `SELECT i.quantity * res.replacement_value_cents AS cents, i.quantity FROM transfers t
       JOIN reservation_items i ON i.id = t.reservation_item_id JOIN resources res ON res.id = i.resource_id WHERE t.id = ?`).get(transferIds[1]);
    completeTransfer(transferIds[1], admin);
    const after = getSavingsOverTime(admin.organizationId, '30', today);
    assert.equal(after.totals.savingsCents - before.savingsCents, line.cents);
    assert.equal(after.totals.items - before.items, line.quantity);
    assert.equal(after.totals.transfers - before.transfers, 1);
    assert.equal(after.buckets.at(-1).transfers >= 1, true, 'it lands in the current week');
    assert.equal(getSavingsOverTime(admin.organizationId, 'all', today).totals.savingsCents >= after.totals.savingsCents, true);
  });
});

describe('cancelling transfers', () => {
  test('a reason is required, stock is released exactly, and a plan with nothing done reopens the request', () => {
    const { requestId, reservationId, transferIds } = approvedPlan();
    const before = stock();
    assert.throws(() => cancelTransfer(transferIds[0], council, '  '), /reason/);
    for (const id of transferIds.slice(0, -1)) assert.equal(cancelTransfer(id, council, 'Not needed').requestStatus, 'approved');
    assert.equal(cancelTransfer(transferIds.at(-1), council, 'Room is locked').requestStatus, 'open');
    assert.equal(requestStatus(requestId), 'open');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE id = ?').get(reservationId).status, 'cancelled');
    assert.equal(stock().reserved, 0);
    assert.equal(stock().total, before.total, 'total stock is untouched by a cancel');
    assert.match(db.prepare('SELECT review_note FROM requests WHERE id = ?').get(requestId).review_note, /Room is locked/);
    assert.throws(() => completeTransfer(transferIds[0], admin), /already cancelled/);
  });

  test('cancelling the last open line after others were completed still fulfils the request', () => {
    const { requestId, transferIds } = approvedPlan();
    for (const id of transferIds.slice(1)) completeTransfer(id, admin);
    assert.equal(cancelTransfer(transferIds[0], admin, 'Damaged in storage').requestStatus, 'fulfilled');
    assert.equal(requestStatus(requestId), 'fulfilled');
  });
});
