// Analytics: savings over time from the Impact Ledger. Run with: npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-analytics-test-'));
const env = { ...process.env, DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), RATE_LIMIT_DISABLED: '1', PORT: '3927' };
Object.assign(process.env, { DB_PATH: env.DB_PATH, UPLOAD_DIR: env.UPLOAD_DIR, RATE_LIMIT_DISABLED: '1' });
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const { getSavingsOverTime } = await import('../services/impact.js');

const mapleId = db.prepare("SELECT id FROM organizations WHERE name LIKE 'Maple%'").get().id;
const riversideId = db.prepare("SELECT id FROM organizations WHERE name LIKE 'Riverside%'").get().id;
const TODAY = '2026-11-18'; // a Wednesday; the week starts Monday 2026-11-16

let server;
after(() => {
  server?.kill();
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the server may still hold the folder; the OS cleans temp */ }
});

// Copy the seed's rows as templates before the tests delete anything.
const bases = {
  [mapleId]: db.prepare('SELECT * FROM impact_ledger WHERE organization_id = ? LIMIT 1').get(mapleId),
};

{
  // Riverside's seed has no completed transfers, so borrow Maple's chain but record the ledger row under Riverside's own ids.
  const res = db.prepare('SELECT id, name, category_id, unit_id FROM resources WHERE organization_id = ? LIMIT 1').get(riversideId);
  const units = db.prepare('SELECT id FROM units WHERE organization_id = ? ORDER BY id').all(riversideId);
  bases[riversideId] = { ...bases[mapleId], resource_id: res.id, resource_name: res.name, category_id: res.category_id,
    supplier_unit_id: units[0].id, receiver_unit_id: units[1].id };
}

/** Put one ledger row on a given day, using the seed's existing transfer chain as a base. */
function ledgerRow(orgId, day, qty, cents) {
  const base = bases[orgId];
  const item = Number(db.prepare('INSERT INTO reservation_items (reservation_id, resource_id, quantity, match_type, reason) SELECT reservation_id, resource_id, 1, match_type, reason FROM reservation_items WHERE id = (SELECT reservation_item_id FROM transfers WHERE id = ?)').run(base.transfer_id).lastInsertRowid);
  const t = Number(db.prepare("INSERT INTO transfers (reservation_item_id, status, completed_at) VALUES (?, 'completed', ?)").run(item, day).lastInsertRowid);
  db.prepare(`INSERT INTO impact_ledger (organization_id, transfer_id, resource_id, resource_name, category_id, quantity,
      supplier_unit_id, receiver_unit_id, completed_at, unit_value_cents, cost_avoided_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orgId, t, base.resource_id, base.resource_name, base.category_id, qty,
    base.supplier_unit_id, base.receiver_unit_id, day, cents, qty * cents);
}

describe('savings over time', () => {
  test('weekly buckets are zero-filled and start on Mondays', () => {
    db.prepare('DELETE FROM impact_ledger WHERE organization_id = ?').run(mapleId);
    const result = getSavingsOverTime(mapleId, '30', TODAY);
    assert.equal(result.granularity, 'week');
    assert.ok(result.buckets.length >= 5);
    assert.equal(result.buckets.at(-1).start, '2026-11-16');
    assert.ok(result.buckets.every((b) => new Date(`${b.start}T00:00:00Z`).getUTCDay() === 1));
    assert.ok(result.buckets.every((b) => b.savingsCents === 0));
    assert.equal(result.totals.transfers, 0);
  });

  test('rows land in the right week and totals add up', () => {
    ledgerRow(mapleId, '2026-11-17', 2, 1000); // this week (Tue)
    ledgerRow(mapleId, '2026-11-16', 1, 500); // this week (Mon)
    ledgerRow(mapleId, '2026-11-09', 3, 100); // last week (Mon)
    const result = getSavingsOverTime(mapleId, '30', TODAY);
    const byStart = Object.fromEntries(result.buckets.map((b) => [b.start, b]));
    assert.equal(byStart['2026-11-16'].savingsCents, 2500);
    assert.equal(byStart['2026-11-16'].transfers, 2);
    assert.equal(byStart['2026-11-09'].items, 3);
    assert.equal(result.totals.savingsCents, 2800);
    assert.equal(result.totals.items, 6);
  });

  test('the range cuts off older transfers', () => {
    ledgerRow(mapleId, '2026-09-01', 10, 100); // 78 days before TODAY
    assert.equal(getSavingsOverTime(mapleId, '30', TODAY).totals.items, 6);
    assert.equal(getSavingsOverTime(mapleId, '90', TODAY).totals.items, 16);
    const all = getSavingsOverTime(mapleId, 'all', TODAY);
    assert.equal(all.granularity, 'month');
    assert.equal(all.buckets[0].start, '2026-09-01');
    assert.equal(all.buckets.length, 3); // Sep, Oct (empty), Nov
    assert.equal(all.buckets[1].savingsCents, 0);
    assert.equal(all.totals.items, 16);
  });

  test("another organization's transfers are never counted", () => {
    ledgerRow(riversideId, '2026-11-17', 99, 100);
    assert.equal(getSavingsOverTime(mapleId, '90', TODAY).totals.items, 16);
    assert.equal(getSavingsOverTime(riversideId, '90', TODAY).totals.items, 99);
  });

  test('an unknown range is rejected', () => {
    assert.throws(() => getSavingsOverTime(mapleId, '7', TODAY), RangeError);
  });
});

describe('analytics over HTTP', () => {
  async function login(email) {
    const res = await fetch('http://localhost:3927/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'looplocal123' }) });
    return res.headers.get('set-cookie').split(';')[0];
  }

  test('only admins can read it, and bad ranges give 400', async () => {
    server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 40; i += 1) {
      try { if ((await fetch('http://localhost:3927/health')).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    const url = 'http://localhost:3927/api/admin/analytics/savings?range=90';
    assert.equal((await fetch(url)).status, 401);
    const member = await login('council@mapleridge.example');
    assert.equal((await fetch(url, { headers: { cookie: member } })).status, 403);
    const admin = await login('admin@mapleridge.example');
    const ok = await fetch(url, { headers: { cookie: admin } });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).buckets.length > 0);
    assert.equal((await fetch(`${url.replace('90', '7')}`, { headers: { cookie: admin } })).status, 400);
  });
});
