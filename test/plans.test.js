// Tests for admin approval of submitted plans. Run with: npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-plan-test-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), RATE_LIMIT_DISABLED: '1' });
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env: process.env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const { loadUserById } = await import('../services/users.js');
const { buildFulfillmentPlan, loadRequestForPlan } = await import('../services/matching.js');
const { submitPlan, listPendingPlans, approvePlan, rejectPlan } = await import('../services/reservations.js');

after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const userByEmail = (email) => loadUserById(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
const admin = userByEmail('admin@mapleridge.example');
const council = userByEmail('council@mapleridge.example');
const riverside = userByEmail('admin@riverside.example');

db.prepare("UPDATE organizations SET plan_approval_mode = 'always' WHERE id = ?").run(admin.organizationId);

const reserved = () => db.prepare('SELECT SUM(quantity_reserved) AS n FROM resources WHERE organization_id = ?').get(admin.organizationId).n;

function submitCouncilPlan() {
  const request = db.prepare("SELECT id FROM requests WHERE requested_by = ? AND status = 'open' AND item_name LIKE '%ontainer%'").get(council.id);
  const row = loadRequestForPlan(request.id, admin.organizationId);
  const substituteIds = buildFulfillmentPlan(row).suggestions.map((s) => s.resourceId); // tick every suggestion
  const plan = buildFulfillmentPlan(row, substituteIds);
  const result = submitPlan(council, request.id, { substituteIds, signature: plan.signature });
  assert.equal(result.status, 'submitted');
  return { requestId: request.id, reservationId: result.reservationId };
}

let approved;

describe('plan approval', () => {
  test('a submitted plan appears in the admin list with its lines', () => {
    const before = reserved();
    approved = submitCouncilPlan();
    const { reservationId } = approved;
    const pending = listPendingPlans(admin);
    const plan = pending.find((p) => p.id === reservationId);
    assert.ok(plan);
    assert.ok(plan.lines.length > 0);
    assert.ok(reserved() > before);
    assert.deepEqual(listPendingPlans(riverside), [], 'another organization sees nothing');
  });

  test('approving schedules a transfer per line and approves the request', () => {
    const { requestId, reservationId } = approved;
    approvePlan(reservationId, admin, 'Looks good');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE id = ?').get(reservationId).status, 'approved');
    assert.equal(db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId).status, 'approved');
    const lines = db.prepare('SELECT COUNT(*) AS n FROM reservation_items WHERE reservation_id = ?').get(reservationId).n;
    const transfers = db.prepare('SELECT COUNT(*) AS n FROM transfers t JOIN reservation_items i ON i.id = t.reservation_item_id WHERE i.reservation_id = ?').get(reservationId).n;
    assert.equal(transfers, lines);
    assert.equal(db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId).status, 'approved');
    assert.throws(() => approvePlan(reservationId, admin), /not waiting/, 'cannot decide twice');
  });

  test('rejecting needs a reason, releases stock exactly, and reopens the request', () => {
    // Put the demo stock back so a second plan can be submitted.
    db.prepare('UPDATE resources SET quantity_reserved = 0 WHERE organization_id = ?').run(admin.organizationId);
    db.prepare("UPDATE requests SET status = 'open' WHERE requested_by = ? AND item_name LIKE '%ontainer%'").run(council.id);
    const before = reserved();
    const { requestId, reservationId } = submitCouncilPlan();
    assert.ok(reserved() > before);
    assert.throws(() => rejectPlan(reservationId, admin, '  '), /reason/);
    assert.throws(() => rejectPlan(reservationId, riverside, 'nope'), /not found/i, 'other organization cannot touch it');
    rejectPlan(reservationId, admin, 'Use the Art stock first');
    assert.equal(reserved(), before);
    const request = db.prepare('SELECT status, review_note FROM requests WHERE id = ?').get(requestId);
    assert.equal(request.status, 'open');
    assert.equal(request.review_note, 'Use the Art stock first');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE id = ?').get(reservationId).status, 'rejected');
  });
});

// --- Listings and conflicts -------------------------------------------------------
const { listPendingListings, approveListing, rejectListing, listMyListings } = await import('../services/resources.js');
const { listOpenConflicts, resolveConflict } = await import('../services/conflicts.js');

describe('listing review', () => {
  test('pending listings are listed for the right organization only', () => {
    const mine = listPendingListings(admin);
    assert.ok(mine.length > 0);
    const otherOrg = listPendingListings(riverside).map((l) => l.id);
    assert.ok(!mine.some((l) => otherOrg.includes(l.id)));
  });

  test('reject needs a reason, shows it to the lister, and cannot be repeated', () => {
    const [listing] = listPendingListings(admin);
    assert.throws(() => rejectListing(listing.id, admin, ''), /reason/);
    assert.throws(() => rejectListing(listing.id, riverside, 'x'), /not found/i);
    rejectListing(listing.id, admin, 'Photo is missing');
    assert.throws(() => approveListing(listing.id, admin), /not waiting/);
    const owner = loadUserById(db.prepare('SELECT created_by AS id FROM resources WHERE id = ?').get(listing.id).id);
    const row = listMyListings(owner).find((l) => l.id === listing.id);
    assert.equal(row.status, 'rejected');
    assert.equal(row.reviewNote, 'Photo is missing');
  });

  test('approving makes the listing live', () => {
    // The demo data has only one pending listing and the last test used it, so make another.
    db.prepare("UPDATE resources SET status = 'pending_review' WHERE id = (SELECT MIN(id) FROM resources WHERE organization_id = ? AND status = 'approved')").run(admin.organizationId);
    const [listing] = listPendingListings(admin);
    approveListing(listing.id, admin);
    assert.equal(db.prepare('SELECT status FROM resources WHERE id = ?').get(listing.id).status, 'approved');
  });
});

describe('conflicts', () => {
  test('a partial plan raises a shortfall conflict that an admin can resolve once', () => {
    db.prepare('UPDATE resources SET quantity_reserved = 0 WHERE organization_id = ?').run(admin.organizationId);
    db.prepare("UPDATE requests SET accepts_partial = 1, status = 'open' WHERE requested_by = ? AND item_name LIKE '%ontainer%'").run(council.id);
    const request = db.prepare("SELECT id FROM requests WHERE requested_by = ? AND item_name LIKE '%ontainer%'").get(council.id);
    const plan = buildFulfillmentPlan(loadRequestForPlan(request.id, admin.organizationId));
    assert.ok(plan.covered < plan.requested);
    submitPlan(council, request.id, { signature: plan.signature });
    const conflict = listOpenConflicts(admin).find((c) => c.kind === 'stock_shortfall');
    assert.ok(conflict);
    assert.deepEqual(listOpenConflicts(riverside), []);
    assert.throws(() => resolveConflict(conflict.id, admin, ' '), /note/);
    assert.throws(() => resolveConflict(conflict.id, riverside, 'x'), /not found/i);
    resolveConflict(conflict.id, admin, 'Asked Art for the rest');
    assert.throws(() => resolveConflict(conflict.id, admin, 'again'), /already resolved/);
  });
});
