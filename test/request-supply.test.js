// A request cannot ask for more than other units can supply right now. Run with: npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-supply-test-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), RATE_LIMIT_DISABLED: '1' });
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env: process.env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const { loadUserById } = await import('../services/users.js');
const { validateRequest, availableSupply } = await import('../services/requests.js');
const { isoDateFromToday } = await import('../services/validation.js');

after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const council = loadUserById(db.prepare("SELECT id FROM users WHERE email = 'council@mapleridge.example'").get().id);
const category = db.prepare("SELECT id FROM categories WHERE organization_id = ? AND name = 'Containers & Storage'").get(council.organizationId).id;

function check(itemName, quantity, extra = {}) {
  const { errors } = validateRequest({
    unitId: council.units[0].id, itemName, categoryId: category, quantity, intendedUse: 'Event supplies',
    neededBy: isoDateFromToday(10), fulfillmentMethod: 'pickup', ...extra,
  }, council);
  return errors.errors.quantity;
}

describe('supply check on new requests', () => {
  test('asking for no more than is available is allowed', () => {
    assert.equal(check('Plastic storage tubs', 15, { needTag: 'storage-tub' }), undefined);
  });

  test('asking for more than is available is refused with the real number', () => {
    assert.match(check('Plastic storage tubs', 16, { needTag: 'storage-tub' }), /Only 15 available/);
  });

  test('reserved stock does not count as available', () => {
    db.prepare("UPDATE resources SET quantity_reserved = 8 WHERE name = 'Plastic Storage Tubs'").run();
    assert.match(check('Plastic storage tubs', 10, { needTag: 'storage-tub' }), /Only 7 available/);
    assert.equal(check('Plastic storage tubs', 7, { needTag: 'storage-tub' }), undefined);
  });

  test('"a partial amount is OK" allows more than is available, but not when nothing is', () => {
    assert.equal(check('Plastic storage tubs', 20, { needTag: 'storage-tub',  acceptsPartial: true  }), undefined);
    assert.match(check('Soldering irons', 5, { acceptsPartial: true }), /No other unit/);
    assert.match(check('Soldering irons', 5), /No other unit/);
  });

  test('substitutes only count when the request accepts them', () => {
    const unit = council.units[0].id;
    const without = availableSupply(council.organizationId, unit, 'reusable-container', false);
    const withSubs = availableSupply(council.organizationId, unit, 'reusable-container', true);
    assert.ok(withSubs > without);
  });

  test("the asking unit's own stock does not count", () => {
    const own = db.prepare("SELECT id FROM units WHERE name = 'Art Department'").get().id;
    assert.equal(availableSupply(council.organizationId, own, 'storage-tub', false), 0);
  });
});
