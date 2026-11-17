// Tests for publishing a resource. Run with: npm test
//
// Part 1 calls the service functions directly against a throwaway database.
// Part 2 starts the real server and publishes through the HTTP API.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-res-test-'));
const env = {
  ...process.env,
  DB_PATH: path.join(tmp, 'test.db'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  RATE_LIMIT_DISABLED: '1',
  PORT: '3918', // different from settings.test.js: test files run at the same time
};
Object.assign(process.env, { DB_PATH: env.DB_PATH, UPLOAD_DIR: env.UPLOAD_DIR, RATE_LIMIT_DISABLED: '1' });

execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const resources = await import('../services/resources.js');
const settings = await import('../services/settings.js');
const { loadUserById } = await import('../services/users.js');
const { isoDateFromToday } = await import('../services/validation.js');

const userByEmail = (email) => loadUserById(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
const admin = userByEmail('admin@mapleridge.example');
const robin = userByEmail('robotics@mapleridge.example'); // an ordinary MEMBER of Robotics Team only
const riversideAdmin = userByEmail('admin@riverside.example');

const idOf = (table, orgId, name) => db.prepare(`SELECT id FROM ${table} WHERE organization_id = ? AND name = ?`).get(orgId, name).id;
const robotics = idOf('units', admin.organizationId, 'Robotics Team');
const science = idOf('units', admin.organizationId, 'Science Department');
const category = db.prepare('SELECT id FROM categories WHERE organization_id = ? LIMIT 1').get(admin.organizationId).id;
const location = db.prepare('SELECT id FROM locations WHERE organization_id = ? LIMIT 1').get(admin.organizationId).id;

/** A valid listing; each test changes only what it is about. */
const listing = (changes = {}) => ({
  unitId: robotics, name: 'Soldering Irons', description: 'Six working soldering irons with stands.',
  categoryId: category, quantity: 6, condition: 'good', replacementValueCents: 2500, locationId: location,
  availableUntil: isoDateFromToday(30), ...changes,
});
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const count = () => db.prepare('SELECT COUNT(*) AS n FROM resources').get().n;
const throws = (fn, status) => assert.throws(fn, (error) => error.status === status, `expected HTTP ${status}`);
const fieldsOf = (fn) => { try { fn(); } catch (error) { return error.fields ?? {}; } return {}; };

describe('who may list, and where', () => {
  test('an ordinary member can list under a unit they belong to', () => {
    assert.equal(robin.canPublish, true);
    const saved = resources.publishListing(robin, listing());
    assert.equal(saved.name, 'Soldering Irons');
  });

  test('...but not under a unit they do not belong to, or another organization\'s unit', () => {
    const before = count();
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ unitId: science }))).unitId);
    const foreignUnit = db.prepare('SELECT id FROM units WHERE organization_id = ? LIMIT 1').get(riversideAdmin.organizationId).id;
    assert.ok(fieldsOf(() => resources.publishListing(admin, listing({ unitId: foreignUnit }))).unitId);
    assert.equal(count(), before);
  });

  test("another organization's category and location are refused", () => {
    const foreignCategory = db.prepare('SELECT id FROM categories WHERE organization_id = ? LIMIT 1').get(riversideAdmin.organizationId).id;
    const foreignLocation = db.prepare('SELECT id FROM locations WHERE organization_id = ? LIMIT 1').get(riversideAdmin.organizationId).id;
    const fields = fieldsOf(() => resources.publishListing(robin, listing({ categoryId: foreignCategory, locationId: foreignLocation })));
    assert.ok(fields.categoryId && fields.locationId);
  });

  test('the publish form offers only the units the person can list under', () => {
    const context = resources.getPublishContext(robin);
    assert.deepEqual(context.units.map((unit) => unit.id), [robotics]);
    assert.ok(resources.getPublishContext(admin).units.length > 1);
  });
});

describe('review rule', () => {
  const statusOf = (id) => db.prepare('SELECT status FROM resources WHERE id = ?').get(id).status;
  const setReview = (on) => settings.updateApprovalRules(admin, { reviewRequests: false, reviewListings: on, planApprovalMode: 'always' });

  test('with review on, a member waits for approval and an admin does not', () => {
    setReview(true);
    assert.equal(resources.getPublishContext(robin).reviewRequired, true);
    assert.equal(resources.getPublishContext(admin).reviewRequired, false);
    assert.equal(statusOf(resources.publishListing(robin, listing()).id), 'pending_review');
    assert.equal(statusOf(resources.publishListing(admin, listing()).id), 'approved');
  });

  test('with review off, a member listing is approved right away', () => {
    setReview(false);
    assert.equal(resources.getPublishContext(robin).reviewRequired, false);
    assert.equal(statusOf(resources.publishListing(robin, listing()).id), 'approved');
    setReview(true);
  });
});

describe('saving', () => {
  test('stores the fields, an identity tag, and de-duplicated substitute tags', () => {
    const saved = resources.publishListing(robin, listing({
      name: 'Reusable Containers', substitutesFor: ['Storage Tubs', 'storage tub', 'Reusable Containers', 'Bins'],
    }));
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(saved.id);
    assert.equal(row.organization_id, robin.organizationId);
    assert.equal(row.created_by, robin.id);
    assert.equal(row.quantity_total, 6);
    assert.equal(row.quantity_reserved, 0);
    const tags = db.prepare('SELECT tag, kind FROM resource_tags WHERE resource_id = ? ORDER BY kind, tag').all(saved.id).map((row) => ({ ...row }));
    assert.deepEqual(tags, [
      { tag: 'reusable-container', kind: 'identity' },
      { tag: 'bin', kind: 'substitute' },
      { tag: 'storage-tub', kind: 'substitute' },
    ]);
  });

  test("pickup days, hours, and location start from the unit's defaults when not sent", () => {
    settings.updateUnitDefaults(admin, robotics, { pickupDays: ['tue', 'thu'], pickupStart: '15:00', pickupEnd: '16:30', locationId: location });
    const { locationId, ...withoutLocation } = listing();
    const saved = resources.publishListing(robin, withoutLocation);
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(saved.id);
    assert.equal(row.pickup_days, 'tue,thu');
    assert.equal(row.pickup_time_start, '15:00');
    assert.equal(row.pickup_time_end, '16:30');
    assert.equal(row.location_id, location);
  });

  test('values sent by the form override the unit defaults, including "any day"', () => {
    const saved = resources.publishListing(robin, listing({ pickupDays: [], pickupTimeStart: null, pickupTimeEnd: null }));
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(saved.id);
    assert.equal(row.pickup_days, '');
    assert.equal(row.pickup_time_start, null);
  });
});

describe('validation', () => {
  test('reports every problem at once and saves nothing', () => {
    const before = count();
    const fields = fieldsOf(() => resources.publishListing(robin, {
      unitId: robotics, name: ' ', description: 'short', categoryId: 'x', quantity: 0, condition: 'broken',
      replacementValueCents: -1, locationId: location, availableUntil: 'soon',
    }));
    for (const field of ['name', 'description', 'categoryId', 'quantity', 'condition', 'replacementValueCents', 'availableUntil']) {
      assert.ok(fields[field], `expected an error for ${field}`);
    }
    assert.equal(count(), before);
  });

  test('quantities must be whole numbers within the limit, values in whole cents', () => {
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ quantity: 2.5 }))).quantity);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ quantity: 10001 }))).quantity);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ replacementValueCents: 12.5 }))).replacementValueCents);
  });

  test('dates: not in the past, and the end is not before the start', () => {
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ availableFrom: isoDateFromToday(-1) }))).availableFrom);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ availableFrom: isoDateFromToday(10), availableUntil: isoDateFromToday(5) }))).availableUntil);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ availableUntil: isoDateFromToday(5000) }))).availableUntil);
  });

  test('pickup times need both ends, in order', () => {
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ pickupTimeStart: '09:00', pickupTimeEnd: null }))).pickupTimeStart);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ pickupTimeStart: '16:00', pickupTimeEnd: '09:00' }))).pickupTimeEnd);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ pickupDays: ['funday'] }))).pickupDays);
  });

  test('too many substitutes are refused', () => {
    const many = ['a one', 'b two', 'c three', 'd four', 'e five', 'f six'];
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing({ substitutesFor: many }))).substitutesFor);
  });
});

describe('photo', () => {
  test('a real image is saved with its alt text and a random file name', () => {
    const saved = resources.publishListing(robin, listing(), { buffer: PNG, altText: 'Six soldering irons on a bench' });
    const image = db.prepare('SELECT * FROM resource_images WHERE resource_id = ?').get(saved.id);
    assert.match(image.filename, new RegExp(`^resource-${saved.id}-[0-9a-f]{16}\\.png$`));
    assert.equal(image.alt_text, 'Six soldering irons on a bench');
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, image.filename)));
  });

  test('non-images, empty files, oversized files, and a missing description are refused, and nothing is saved', () => {
    const before = count();
    const files = fs.existsSync(env.UPLOAD_DIR) ? fs.readdirSync(env.UPLOAD_DIR).length : 0;
    const alt = 'A photo of the item';
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing(), { buffer: Buffer.from('<svg onload="alert(1)"></svg>'), altText: alt })).photo);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing(), { buffer: Buffer.alloc(0), altText: alt })).photo);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing(), { buffer: Buffer.concat([PNG, Buffer.alloc(resources.LIMITS.maxPhotoBytes)]), altText: alt })).photo);
    assert.ok(fieldsOf(() => resources.publishListing(robin, listing(), { buffer: PNG, altText: ' ' })).altText);
    assert.equal(count(), before);
    assert.equal(fs.existsSync(env.UPLOAD_DIR) ? fs.readdirSync(env.UPLOAD_DIR).length : 0, files);
  });
});

describe('publishing over HTTP', () => {
  let server;
  const base = `http://127.0.0.1:${env.PORT}`;

  async function signIn(email) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'looplocal123' }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  /** Multipart body like the browser sends: a JSON "data" field and an optional "photo" file. */
  function form(data, photo) {
    const body = new FormData();
    body.append('data', JSON.stringify(data));
    if (photo) body.append('photo', new Blob([photo.bytes], { type: 'image/png' }), photo.name ?? 'photo.png');
    return body;
  }

  before(async () => {
    server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The test server did not start.');
  });
  after(() => server?.kill());

  test('signed-out visitors get 401', async () => {
    assert.equal((await fetch(`${base}/api/resources/context`)).status, 401);
    assert.equal((await fetch(`${base}/api/resources`, { method: 'POST', body: form(listing()) })).status, 401);
  });

  test('a member publishes with a photo; it waits for review and is hidden from Browse until approved', async () => {
    const cookie = await signIn('robotics@mapleridge.example');
    const context = await (await fetch(`${base}/api/resources/context`, { headers: { Cookie: cookie } })).json();
    assert.equal(context.reviewRequired, true);
    assert.deepEqual(context.units.map((unit) => unit.id), [robotics]);

    const response = await fetch(`${base}/api/resources`, {
      method: 'POST', headers: { Cookie: cookie },
      body: form({ ...listing({ name: 'HTTP Test Drill' }), altText: 'A cordless drill on a table' }, { bytes: PNG }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.needsReview, true);
    assert.equal(body.resource.status, 'pending_review');

    const browse = await (await fetch(`${base}/api/resources?q=HTTP+Test+Drill`, { headers: { Cookie: cookie } })).json();
    assert.equal(browse.resources.length, 0, 'pending listings are not in Browse');
  });

  test('an admin publishes straight to Browse, and the photo is served', async () => {
    const cookie = await signIn('admin@mapleridge.example');
    const response = await fetch(`${base}/api/resources`, {
      method: 'POST', headers: { Cookie: cookie },
      body: form({ ...listing({ name: 'HTTP Admin Label Maker', unitId: science }), altText: 'A label maker with tape' }, { bytes: PNG }),
    });
    assert.equal(response.status, 201);
    const { resource } = await response.json();
    assert.equal(resource.status, 'approved');

    const detail = await (await fetch(`${base}/api/resources/${resource.id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(detail.resource.images[0].alt_text, 'A label maker with tape');
    const photo = await fetch(`${base}/uploads/${detail.resource.images[0].filename}`);
    assert.equal(photo.status, 200);

    // Another organization cannot see it.
    const other = await signIn('admin@riverside.example');
    assert.equal((await fetch(`${base}/api/resources/${resource.id}`, { headers: { Cookie: other } })).status, 404);
  });

  test('bad input gets a 400 with field errors; a fake image is refused; broken form data is refused', async () => {
    const cookie = await signIn('robotics@mapleridge.example');
    const post = (body) => fetch(`${base}/api/resources`, { method: 'POST', headers: { Cookie: cookie }, body });

    const invalid = await post(form(listing({ name: '', quantity: -3 })));
    assert.equal(invalid.status, 400);
    const { fields } = await invalid.json();
    assert.ok(fields.name && fields.quantity);

    const fake = await post(form({ ...listing(), altText: 'A picture of something' }, { bytes: Buffer.from('<svg></svg>'), name: 'photo.png' }));
    assert.equal(fake.status, 400);
    assert.ok((await fake.json()).fields.photo);

    const broken = new FormData();
    broken.append('data', '{not json');
    assert.equal((await post(broken)).status, 400);
  });
});

// Best-effort cleanup: Windows will not delete a database file that is still open.
after(() => {
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS cleans its temp folder */ }
});
