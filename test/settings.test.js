// Tests for organization settings. Run with: npm test
//
// Part 1 calls the service functions directly against a throwaway database.
// Part 2 starts the real server and checks who is allowed in over HTTP.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-test-'));
const env = {
  ...process.env,
  DB_PATH: path.join(tmp, 'test.db'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  RATE_LIMIT_DISABLED: '1',
  PORT: '3917',
};
Object.assign(process.env, { DB_PATH: env.DB_PATH, UPLOAD_DIR: env.UPLOAD_DIR, RATE_LIMIT_DISABLED: '1' });

// Build the demo database in the throwaway folder (the same one the server will use).
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const settings = await import('../services/settings.js');
const { loadUserById } = await import('../services/users.js');

const userByEmail = (email) => loadUserById(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
const maple = userByEmail('admin@mapleridge.example');
const riverside = userByEmail('admin@riverside.example');
const throws = (fn, status) => assert.throws(fn, (error) => error.status === status, `expected HTTP ${status}`);

describe('categories and locations', () => {
  test('add, rename, and reject duplicates (case-insensitive)', () => {
    const id = settings.addCategory(maple, { name: 'Test Category' });
    throws(() => settings.addCategory(maple, { name: 'test category' }), 409);
    settings.renameCategory(maple, id, { name: 'TEST CATEGORY' }); // only the case changes: allowed
    settings.renameCategory(maple, id, { name: 'Renamed Category' });
    assert.ok(settings.listCategories(maple.organizationId).some((c) => c.name === 'Renamed Category'));
    settings.deleteCategory(maple, id);
  });

  test('rejects names that are too short or empty', () => {
    throws(() => settings.addCategory(maple, { name: ' a ' }), 400);
    throws(() => settings.addLocation(maple, {}), 400);
  });

  test('a category in use cannot be deleted, but an unused one can', () => {
    const used = settings.listCategories(maple.organizationId).find((c) => c.inUse > 0);
    assert.ok(used, 'the demo data should have a category in use');
    throws(() => settings.deleteCategory(maple, used.id), 409);
    assert.ok(settings.listCategories(maple.organizationId).some((c) => c.id === used.id));

    const free = settings.addCategory(maple, { name: 'Unused Category' });
    settings.deleteCategory(maple, free);
    assert.ok(!settings.listCategories(maple.organizationId).some((c) => c.id === free));
  });

  test('a location in use cannot be deleted', () => {
    const used = settings.listLocations(maple.organizationId).find((l) => l.inUse > 0);
    assert.ok(used);
    throws(() => settings.deleteLocation(maple, used.id), 409);
  });

  test("one organization cannot touch another organization's lists", () => {
    const theirs = settings.listCategories(riverside.organizationId)[0];
    throws(() => settings.renameCategory(maple, theirs.id, { name: 'Hijacked' }), 404);
    throws(() => settings.deleteCategory(maple, theirs.id), 404);
    assert.equal(settings.listCategories(riverside.organizationId).find((c) => c.id === theirs.id).name, theirs.name);
  });
});

describe('unit pickup defaults', () => {
  const unitId = () => settings.getSettings(maple.organizationId).units[0].id;

  test('saves days, times, and a location', () => {
    const locationId = settings.listLocations(maple.organizationId)[0].id;
    settings.updateUnitDefaults(maple, unitId(), { pickupDays: ['wed', 'mon'], pickupStart: '14:00', pickupEnd: '16:30', locationId });
    const unit = settings.getSettings(maple.organizationId).units.find((u) => u.id === unitId());
    assert.deepEqual(unit.pickupDays, ['mon', 'wed']);
    assert.equal(unit.pickupStart, '14:00');
    assert.equal(unit.locationId, locationId);
  });

  test('rejects bad days, half-filled or reversed times, and foreign locations', () => {
    throws(() => settings.updateUnitDefaults(maple, unitId(), { pickupDays: ['funday'] }), 400);
    throws(() => settings.updateUnitDefaults(maple, unitId(), { pickupStart: '14:00' }), 400);
    throws(() => settings.updateUnitDefaults(maple, unitId(), { pickupStart: '16:00', pickupEnd: '14:00' }), 400);
    const foreign = settings.listLocations(riverside.organizationId)[0].id;
    throws(() => settings.updateUnitDefaults(maple, unitId(), { locationId: foreign }), 400);
  });

  test('cannot edit a unit from another organization', () => {
    const foreignUnit = settings.getSettings(riverside.organizationId).units[0].id;
    throws(() => settings.updateUnitDefaults(maple, foreignUnit, { pickupDays: ['mon'] }), 404);
  });
});

describe('approval rules', () => {
  test('saves each mode; the old threshold is remembered when it is not in use', () => {
    settings.updateApprovalRules(maple, { reviewRequests: true, planApprovalMode: 'threshold', planApprovalThresholdCents: 50000 });
    let org = settings.getSettings(maple.organizationId).organization;
    assert.equal(org.reviewRequests, true);
    assert.equal(org.planApprovalThresholdCents, 50000);

    settings.updateApprovalRules(maple, { reviewRequests: false, planApprovalMode: 'never' });
    org = settings.getSettings(maple.organizationId).organization;
    assert.equal(org.planApprovalMode, 'never');
    assert.equal(org.planApprovalThresholdCents, 50000);
  });

  test('listing review defaults on, saves per organization, and is kept when left out', () => {
    const read = (user) => settings.getSettings(user.organizationId).organization.reviewListings;
    assert.equal(read(maple), true);
    settings.updateApprovalRules(maple, { reviewRequests: false, reviewListings: false, planApprovalMode: 'always' });
    assert.equal(read(maple), false);
    assert.equal(read(riverside), true, 'another organization is unaffected');
    settings.updateApprovalRules(maple, { reviewRequests: false, planApprovalMode: 'always' });
    assert.equal(read(maple), false, 'left out = unchanged');
    throws(() => settings.updateApprovalRules(maple, { reviewRequests: false, reviewListings: 'no', planApprovalMode: 'always' }), 400);
    settings.updateApprovalRules(maple, { reviewRequests: false, reviewListings: true, planApprovalMode: 'always' });
  });

  test('rejects invalid input', () => {
    throws(() => settings.updateApprovalRules(maple, { reviewRequests: 'yes', planApprovalMode: 'always' }), 400);
    throws(() => settings.updateApprovalRules(maple, { reviewRequests: true, planApprovalMode: 'sometimes' }), 400);
    throws(() => settings.updateApprovalRules(maple, { reviewRequests: true, planApprovalMode: 'threshold', planApprovalThresholdCents: -5 }), 400);
    throws(() => settings.updateApprovalRules(maple, { reviewRequests: true, planApprovalMode: 'threshold', planApprovalThresholdCents: 12.5 }), 400);
  });

  test('turning review off leaves requests already waiting where they are', () => {
    const waiting = () => db.prepare("SELECT COUNT(*) AS n FROM requests WHERE organization_id = ? AND status = 'pending_review'")
      .get(riverside.organizationId).n;
    settings.updateApprovalRules(riverside, { reviewRequests: true, planApprovalMode: 'always' });
    const before = waiting();
    settings.updateApprovalRules(riverside, { reviewRequests: false, planApprovalMode: 'always' });
    assert.equal(waiting(), before);
  });
});

describe('branding', () => {
  test('saves the name and color, and the color can be cleared', () => {
    settings.updateBranding(maple, { name: 'Maple Ridge High', brandColor: '#1A64A8' });
    let org = settings.getSettings(maple.organizationId).organization;
    assert.equal(org.name, 'Maple Ridge High');
    assert.equal(org.brandColor, '#1a64a8');
    settings.updateBranding(maple, { name: 'Maple Ridge High School', brandColor: null });
    org = settings.getSettings(maple.organizationId).organization;
    assert.equal(org.brandColor, null);
  });

  test('rejects a bad color, a short name, and a name another organization uses', () => {
    throws(() => settings.updateBranding(maple, { name: 'Maple Ridge High School', brandColor: 'blue' }), 400);
    throws(() => settings.updateBranding(maple, { name: 'x', brandColor: null }), 400);
    const theirName = settings.getSettings(riverside.organizationId).organization.name;
    throws(() => settings.updateBranding(maple, { name: theirName.toUpperCase(), brandColor: null }), 409);
  });

  test('accepts real PNG/JPG bytes, replaces the old file, and removes it on delete', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    const first = settings.setLogo(maple, png);
    assert.match(first, /^logo-\d+-[0-9a-f]{16}\.png$/);
    assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, first)));

    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    const second = settings.setLogo(maple, jpg);
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, first)), 'the old logo file is deleted');
    settings.removeLogo(maple);
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, second)));
    assert.equal(settings.getSettings(maple.organizationId).organization.logoFilename, null);
  });

  test('rejects files that are not images, however they are named, and files over 1 MB', () => {
    throws(() => settings.setLogo(maple, Buffer.from('<svg onload="alert(1)"></svg>')), 400);
    throws(() => settings.setLogo(maple, Buffer.from('MZ not an image')), 400);
    throws(() => settings.setLogo(maple, Buffer.alloc(0)), 400);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024 * 1024)]);
    throws(() => settings.setLogo(maple, big), 400);
  });
});

describe('settings over HTTP', () => {
  let server;
  const base = `http://127.0.0.1:${env.PORT}`;

  /** Sign in and return the session cookie. */
  async function signIn(email) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'looplocal123' }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
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

  test('signed-out visitors get 401, ordinary members get 403', async () => {
    assert.equal((await fetch(`${base}/api/admin/settings`)).status, 401);
    const member = await signIn('robotics@mapleridge.example');
    const asMember = (url, init = {}) => fetch(`${base}${url}`, { ...init, headers: { Cookie: member, 'Content-Type': 'application/json' } });
    assert.equal((await asMember('/api/admin/settings')).status, 403);
    assert.equal((await asMember('/api/admin/settings/categories', { method: 'POST', body: '{"name":"Nope"}' })).status, 403);
    assert.equal((await asMember('/api/admin/settings/branding', { method: 'PUT', body: '{"name":"Hacked"}' })).status, 403);
  });

  test("an admin sees only their own organization's settings", async () => {
    const cookie = await signIn('admin@riverside.example');
    const response = await fetch(`${base}/api/admin/settings`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.organization.name, 'Riverside Community Pantry');
    assert.ok(body.categories.every((c) => c.name !== 'Art Supplies'), 'Maple Ridge categories must not leak');
    assert.ok(body.units.every((u) => u.name !== 'Science Department'));
  });

  test('uploading a non-image through the API is refused', async () => {
    const cookie = await signIn('admin@mapleridge.example');
    const form = new FormData();
    form.append('logo', new Blob(['<svg></svg>'], { type: 'image/png' }), 'logo.png');
    const response = await fetch(`${base}/api/admin/settings/logo`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.equal(response.status, 400);
  });
});

// Best-effort cleanup: Windows will not delete a database file that is still open.
after(() => {
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS cleans its temp folder */ }
});
