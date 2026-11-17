// Tests for the Rescue Engine (services/matching.js) and plan submission (services/reservations.js).
// Run with: npm test
//
// Part 1-2 call the services directly against a throwaway demo database; part 3 uses the real server.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looplocal-match-test-'));
const env = {
  ...process.env,
  DB_PATH: path.join(tmp, 'test.db'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  RATE_LIMIT_DISABLED: '1',
  PORT: '3919', // each test file uses its own port: files run at the same time
};
Object.assign(process.env, { DB_PATH: env.DB_PATH, UPLOAD_DIR: env.UPLOAD_DIR, RATE_LIMIT_DISABLED: '1' });
execFileSync(process.execPath, ['database/seed.js', '--reset'], { cwd: root, env, stdio: 'ignore' });

const { db } = await import('../database/db.js');
const { buildFulfillmentPlan, loadRequestForPlan } = await import('../services/matching.js');
const { submitPlan } = await import('../services/reservations.js');
const { cancelRequest, WEEKDAYS } = await import('../services/requests.js');
const resources = await import('../services/resources.js');
const settings = await import('../services/settings.js');
const { loadUserById } = await import('../services/users.js');
const { isoDateFromToday } = await import('../services/validation.js');

const userByEmail = (email) => loadUserById(db.prepare('SELECT id FROM users WHERE email = ?').get(email).id);
const admin = userByEmail('admin@mapleridge.example');
const casey = userByEmail('council@mapleridge.example'); // Student Council member, made the demo request
const robin = userByEmail('robotics@mapleridge.example'); // Robotics Team member
const art = userByEmail('art@mapleridge.example');
const org = admin.organizationId;
const unitId = (name) => db.prepare('SELECT id FROM units WHERE organization_id = ? AND name = ?').get(org, name).id;
const category = db.prepare('SELECT id FROM categories WHERE organization_id = ? LIMIT 1').get(org).id;
const location = db.prepare('SELECT id FROM locations WHERE organization_id = ? LIMIT 1').get(org).id;
const mainOffice = db.prepare("SELECT id FROM locations WHERE organization_id = ? AND name = 'Main Office'").get(org).id;
const today = isoDateFromToday(0);
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Publish an approved listing (as admin) with "any day, any time" hand-off unless changed. */
function list(unit, name, quantity, extra = {}) {
  return resources.publishListing(admin, {
    unitId: unitId(unit), name, description: 'A test listing for the engine.', categoryId: category, quantity,
    condition: 'good', replacementValueCents: 1000, locationId: location, pickupDays: [], pickupTimeStart: null,
    pickupTimeEnd: null, availableUntil: isoDateFromToday(60), ...extra,
  }).id;
}

/** Insert an open request straight into the database and return its row for the engine. */
function request(unit, tag, quantity, extra = {}) {
  const o = {
    needed_by: isoDateFromToday(14), days: '', start: null, end: null, method: 'pickup', place: null,
    subs: 0, partial: 0, status: 'open', by: admin.id, ...extra,
  };
  const id = Number(db.prepare(
    `INSERT INTO requests (organization_id, unit_id, requested_by, item_name, category_id, need_tag, quantity,
       intended_use, needed_by, pickup_days, pickup_time_start, pickup_time_end, fulfillment_method,
       deliver_to_location_id, accepts_substitutes, accepts_partial, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'testing', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(org, unitId(unit), o.by, tag, category, tag, quantity, o.needed_by, o.days, o.start, o.end, o.method, o.place,
      o.subs, o.partial, o.status).lastInsertRowid);
  return id;
}
const rowOf = (id) => loadRequestForPlan(id, org);
const planFor = (id, selected = []) => buildFulfillmentPlan(rowOf(id), selected);
const throws = (fn, status) => assert.throws(fn, (error) => error.status === status, `expected HTTP ${status}`);
const reservedOf = (id) => db.prepare('SELECT quantity_reserved AS n FROM resources WHERE id = ?').get(id).n;
const statusOf = (id) => db.prepare('SELECT status FROM requests WHERE id = ?').get(id).status;
const setPlanRule = (mode, cents) => settings.updateApprovalRules(admin, {
  reviewRequests: false, planApprovalMode: mode, planApprovalThresholdCents: cents });

describe('the demo scenario (Student Council asks for 40 reusable containers)', () => {
  const demo = () => db.prepare("SELECT id FROM requests WHERE organization_id = ? AND item_name = 'Reusable containers'").get(org).id;

  test('exact matches fill first; the shortfall is covered only by substitutes the requester ticks', () => {
    const noTicks = planFor(demo());
    assert.deepEqual(noTicks.lines.map((l) => [l.unitName, l.quantity, l.matchType]),
      [['Science Department', 20, 'exact'], ['Environmental Club', 12, 'exact']]);
    assert.equal(noTicks.covered, 32);
    assert.equal(noTicks.shortfall, 8);
    assert.equal(noTicks.complete, false);
    assert.equal(noTicks.canSubmit, false, 'a partial plan is not allowed on this request');
    assert.match(noTicks.blockedReason, /does not allow a partial plan/);
    assert.equal(noTicks.suggestions.length, 1);
    assert.equal(noTicks.suggestions[0].unitName, 'Art Department');
    assert.equal(noTicks.suggestions[0].selected, false);

    const ticked = planFor(demo(), [noTicks.suggestions[0].resourceId]);
    assert.deepEqual(ticked.lines.map((l) => [l.unitName, l.quantity, l.matchType]),
      [['Science Department', 20, 'exact'], ['Environmental Club', 12, 'exact'], ['Art Department', 8, 'substitute']]);
    assert.equal(ticked.covered, 40);
    assert.equal(ticked.complete, true);
    assert.equal(ticked.canSubmit, true);
  });

  test('every line explains itself and names a hand-off that works for both sides', () => {
    const ticked = planFor(demo(), planFor(demo()).suggestions.map((s) => s.resourceId));
    for (const line of ticked.lines) {
      assert.ok(line.reason.length > 20);
      assert.match(line.handoff.summary, /Delivered to Main Office/);
    }
    assert.match(ticked.lines[0].reason, /^Exact match for reusable container\./);
    assert.match(ticked.lines[2].reason, /^Substitute for reusable container/);
    // Environmental Club only does hand-offs Tue/Thu, so the first date must be one of those.
    const club = ticked.lines.find((l) => l.unitName === 'Environmental Club');
    assert.ok(['tue', 'thu'].includes(WEEKDAYS[(new Date(`${club.handoff.date}T00:00:00`).getDay() + 6) % 7]));
    assert.equal(club.handoff.timeStart, '15:00');
    assert.equal(club.handoff.timeEnd, '16:30');
  });

  test('"Why not these?" lists look-alike listings with a reason, and never an unapproved one', () => {
    const plan = planFor(demo());
    const why = Object.fromEntries(plan.excluded.map((e) => [e.name, e.why]));
    assert.match(why['Spare Meal-Prep Containers'], /own unit/);
    assert.match(why['Takeout Containers (last term)'], /does not overlap/);
    // A listing still waiting for review must not appear anywhere in the plan.
    const pending = list('Science Department', 'Reusable Container Pending', 5, { identityTag: 'reusable-container' });
    db.prepare("UPDATE resources SET status = 'pending_review' WHERE id = ?").run(pending);
    const after = planFor(demo());
    assert.ok(![...after.lines, ...after.excluded, ...after.suggestions].some((x) => x.resourceId === pending));
    db.prepare("UPDATE resources SET status = 'approved' WHERE id = ?").run(pending);
    db.prepare("UPDATE resources SET status = 'archived' WHERE id = ?").run(pending);
  });

  test('the same request and stock always give the same plan', () => {
    const ids = planFor(demo()).suggestions.map((s) => s.resourceId);
    assert.deepEqual(plain(planFor(demo(), ids)), plain(planFor(demo(), ids)));
  });

  test('without "similar item is fine", substitutes are excluded with a reason and nothing is suggested', () => {
    const id = request('Student Council', 'reusable-container', 40, { subs: 0 });
    const plan = planFor(id);
    assert.equal(plan.suggestions.length, 0);
    assert.ok(plan.excluded.some((e) => e.unitName === 'Art Department' && /needs the exact item/.test(e.why)));
  });

  test('a ticked substitute is ignored when nothing is short, and unknown ids are ignored', () => {
    const exactOnly = request('Art Department', 'reusable-container', 5, { subs: 1 }); // 5 fit in exact stock
    const art = db.prepare("SELECT id FROM resources WHERE name = 'Plastic Storage Tubs'").get().id;
    const plan = planFor(exactOnly, [art, 999999, 'x']);
    assert.ok(plan.lines.every((l) => l.matchType === 'exact'));
    assert.equal(plan.suggestions.length, 0);
    assert.equal(plan.complete, true);
  });
});

describe('ranking', () => {
  test('exact before substitute, then better condition, then larger stock, then lowest id', () => {
    const a = list('Science Department', 'Rank Widget', 5);
    const b = list('Art Department', 'Rank Widget', 3, { condition: 'new' });
    const c = list('Environmental Club', 'Rank Widget', 9);
    const d = list('Robotics Team', 'Rank Widget', 9);
    const worn = list('Culinary Arts', 'Rank Widget', 50, { condition: 'worn' });
    const id = request('Student Council', 'rank-widget', 100, { partial: 1 });
    const plan = planFor(id);
    assert.deepEqual(plan.lines.map((l) => l.resourceId), [b, c, d, a, worn]);
    assert.match(plan.lines[0].reason, /Ranked 1 of 5 exact matches/);
    assert.equal(plan.covered, 3 + 9 + 9 + 5 + 50);
  });

  test('takes only what is still needed from the last listing used', () => {
    const id = request('Student Council', 'rank-widget', 10);
    const plan = planFor(id);
    assert.deepEqual(plan.lines.map((l) => l.quantity), [3, 7]);
    assert.equal(plan.complete, true);
  });
});

describe('hand-off rules', () => {
  const excludedWhy = (id, name) => planFor(id).excluded.find((e) => e.name === name)?.why;

  test('no shared weekday', () => {
    list('Science Department', 'Day Widget', 4, { pickupDays: ['sat'] });
    const id = request('Student Council', 'day-widget', 2, { days: 'mon,tue' });
    assert.match(excludedWhy(id, 'Day Widget'), /No shared day/);
  });

  test('times that only touch do not overlap; real overlaps give the shared window', () => {
    list('Science Department', 'Time Widget', 4, { pickupTimeStart: '09:00', pickupTimeEnd: '10:00' });
    const touching = request('Student Council', 'time-widget', 2, { start: '10:00', end: '11:00' });
    assert.match(excludedWhy(touching, 'Time Widget'), /times do not overlap/);
    const overlapping = request('Student Council', 'time-widget', 2, { start: '09:30', end: '11:00' });
    const [line] = planFor(overlapping).lines;
    assert.equal(line.handoff.timeStart, '09:30');
    assert.equal(line.handoff.timeEnd, '10:00');
  });

  test('an open-ended side (no times, no days) matches anything', () => {
    list('Science Department', 'Open Widget', 4, { pickupDays: ['wed'] });
    const id = request('Student Council', 'open-widget', 2);
    assert.equal(planFor(id).lines.length, 1);
  });

  test('availability window must overlap today through the needed-by date', () => {
    list('Science Department', 'Late Widget', 4, { availableFrom: isoDateFromToday(20), availableUntil: isoDateFromToday(40) });
    const id = request('Student Council', 'late-widget', 2, { needed_by: isoDateFromToday(10) });
    assert.match(excludedWhy(id, 'Late Widget'), /does not overlap/);
  });

  test('the listing\'s pickup day must actually occur before the needed-by date', () => {
    const todayKey = WEEKDAYS[(new Date().getDay() + 6) % 7];
    const otherDay = WEEKDAYS.find((day) => day !== todayKey);
    list('Science Department', 'Window Widget', 4, { pickupDays: [otherDay] });
    const id = request('Student Council', 'window-widget', 2, { needed_by: today }); // only today is possible
    assert.match(excludedWhy(id, 'Window Widget'), /None of the days/);
  });

  test('the first hand-off date is today or later and no later than the needed-by date', () => {
    const id = request('Student Council', 'rank-widget', 1, { needed_by: isoDateFromToday(7) });
    const [line] = planFor(id).lines;
    assert.ok(line.handoff.date >= today && line.handoff.date <= isoDateFromToday(7));
  });

  test('delivery requests say where it will be delivered', () => {
    const id = request('Student Council', 'rank-widget', 1, { method: 'delivery', place: mainOffice });
    assert.match(planFor(id).lines[0].handoff.summary, /^Delivered to Main Office/);
  });

  test('sold-out listings are excluded with a reason', () => {
    const id = list('Science Department', 'Gone Widget', 3);
    db.prepare('UPDATE resources SET quantity_reserved = 3 WHERE id = ?').run(id);
    assert.match(excludedWhy(request('Student Council', 'gone-widget', 1), 'Gone Widget'), /None left/);
  });

  test("another organization's listings are never considered", () => {
    const riverside = userByEmail('admin@riverside.example');
    const foreignUnit = db.prepare('SELECT id FROM units WHERE organization_id = ? LIMIT 1').get(riverside.organizationId).id;
    const foreignCategory = db.prepare('SELECT id FROM categories WHERE organization_id = ? LIMIT 1').get(riverside.organizationId).id;
    const foreignLocation = db.prepare('SELECT id FROM locations WHERE organization_id = ? LIMIT 1').get(riverside.organizationId).id;
    resources.publishListing(riverside, {
      unitId: foreignUnit, name: 'Foreign Widget', description: 'Belongs to a different organization.', categoryId: foreignCategory,
      quantity: 50, condition: 'good', replacementValueCents: 100, locationId: foreignLocation, availableUntil: isoDateFromToday(30) });
    const plan = planFor(request('Student Council', 'foreign-widget', 1));
    assert.deepEqual([plan.lines.length, plan.excluded.length, plan.suggestions.length], [0, 0, 0]);
    assert.equal(plan.canSubmit, false);
    assert.match(plan.blockedReason, /Nothing available/);
  });
});

describe('submitting a plan', () => {
  /** A fresh item with 5 in stock, and a request for it. Returns ids and the plan the requester sees. */
  function scenario(tag, { stock = 5, want = 5, partial = 0, by = admin.id, unit = 'Student Council' } = {}) {
    const listing = list('Science Department', tag, stock, { replacementValueCents: 1000 });
    const id = request(unit, tag.toLowerCase().replace(/ /g, '-'), want, { partial, by });
    return { listing, id, plan: planFor(id) };
  }

  test('reserves the stock, records the plan, and sends it to an admin when the rule says so', () => {
    setPlanRule('always');
    const { listing, id, plan } = scenario('Submit Widget A');
    const result = submitPlan(admin, id, { signature: plan.signature });
    assert.equal(result.status, 'submitted');
    assert.equal(result.needsApproval, true);
    assert.equal(reservedOf(listing), 5);
    assert.equal(statusOf(id), 'pending_approval');
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.reservationId);
    assert.equal(reservation.status, 'pending_approval');
    const lines = db.prepare('SELECT * FROM reservation_items WHERE reservation_id = ?').all(result.reservationId);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 5);
    assert.ok(lines[0].reason.length > 20 && lines[0].handoff_date >= today);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE reservation_item_id = ?').get(lines[0].id).n, 0,
      'transfers are scheduled only once a plan is approved');
  });

  test('"never" approves right away and schedules a transfer for each line', () => {
    setPlanRule('never');
    const { id, plan } = scenario('Submit Widget B');
    const result = submitPlan(admin, id, { signature: plan.signature });
    assert.equal(result.needsApproval, false);
    assert.equal(statusOf(id), 'approved');
    const transfers = db.prepare(
      `SELECT t.status, t.scheduled_for FROM transfers t JOIN reservation_items i ON i.id = t.reservation_item_id
       WHERE i.reservation_id = ?`).all(result.reservationId);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].status, 'scheduled');
    assert.ok(transfers[0].scheduled_for >= today);
  });

  test('"threshold" compares the plan\'s total value with the amount', () => {
    setPlanRule('threshold', 5000); // 5 items x $10.00 = $50.00 -> needs approval at exactly the threshold
    const small = scenario('Submit Widget C');
    assert.equal(submitPlan(admin, small.id, { signature: small.plan.signature }).needsApproval, true);
    setPlanRule('threshold', 5001);
    const below = scenario('Submit Widget D');
    assert.equal(submitPlan(admin, below.id, { signature: below.plan.signature }).needsApproval, false);
    setPlanRule('always');
  });

  test('if the plan changed since it was shown, nothing is reserved and the new plan comes back', () => {
    const { listing, id, plan } = scenario('Submit Widget E');
    db.prepare('UPDATE resources SET quantity_reserved = 2 WHERE id = ?').run(listing); // someone else took 2
    const result = submitPlan(admin, id, { signature: plan.signature });
    assert.equal(result.status, 'changed');
    assert.equal(result.plan.covered, 3);
    assert.equal(reservedOf(listing), 2, 'stock untouched');
    assert.equal(statusOf(id), 'open');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE request_id = ?').get(id).n, 0);
    // Confirming the updated plan (partial is not allowed here) is refused, not silently reduced.
    throws(() => submitPlan(admin, id, { signature: result.plan.signature }), 409);
  });

  test('two requests can never reserve the same stock', () => {
    setPlanRule('always');
    const listing = list('Science Department', 'Race Widget', 5);
    const first = request('Student Council', 'race-widget', 5);
    const second = request('Art Department', 'race-widget', 5);
    const firstSees = planFor(first);
    const secondSees = planFor(second); // both were shown the same 5 widgets
    assert.equal(submitPlan(admin, first, { signature: firstSees.signature }).status, 'submitted');
    const result = submitPlan(admin, second, { signature: secondSees.signature });
    assert.equal(result.status, 'changed');
    assert.equal(result.plan.covered, 0);
    assert.equal(reservedOf(listing), 5);
    assert.equal(statusOf(second), 'open');
  });

  test('a missing or wrong signature is treated as a changed plan', () => {
    const { listing, id } = scenario('Submit Widget F');
    assert.equal(submitPlan(admin, id, {}).status, 'changed');
    assert.equal(submitPlan(admin, id, { signature: 'forged' }).status, 'changed');
    assert.equal(reservedOf(listing), 0);
  });

  test('a partial plan is accepted only when the request allows it', () => {
    setPlanRule('always');
    const refused = scenario('Submit Widget G', { stock: 3, want: 5 });
    throws(() => submitPlan(admin, refused.id, { signature: refused.plan.signature }), 409);
    const allowed = scenario('Submit Widget H', { stock: 3, want: 5, partial: 1 });
    const result = submitPlan(admin, allowed.id, { signature: allowed.plan.signature });
    assert.equal(result.plan.covered, 3);
    assert.equal(reservedOf(allowed.listing), 3);
  });

  test('substitutes are reserved only when ticked', () => {
    setPlanRule('always');
    const tub = list('Art Department', 'Sub Tub', 4, { substitutesFor: ['Sub Widget'] });
    const exact = list('Science Department', 'Sub Widget', 2);
    const id = request('Student Council', 'sub-widget', 5, { subs: 1 });
    const seen = planFor(id, [tub]);
    assert.deepEqual(seen.lines.map((l) => [l.quantity, l.matchType]), [[2, 'exact'], [3, 'substitute']]);
    submitPlan(admin, id, { substituteIds: [tub], signature: seen.signature });
    assert.equal(reservedOf(exact), 2);
    assert.equal(reservedOf(tub), 3);
  });

  test('only the requester, a unit manager, or an admin can submit; other organizations see "not found"', () => {
    setPlanRule('always');
    list('Science Department', 'Perm Widget', 5);
    const byAdmin = request('Robotics Team', 'perm-widget', 1, { by: admin.id });
    const sig = planFor(byAdmin).signature;
    throws(() => submitPlan(robin, byAdmin, { signature: sig }), 403); // a member of the unit, but not the requester
    const riverside = userByEmail('admin@riverside.example');
    throws(() => submitPlan(riverside, byAdmin, { signature: sig }), 404);
    const mine = request('Robotics Team', 'perm-widget', 1, { by: robin.id });
    assert.equal(submitPlan(robin, mine, { signature: planFor(mine).signature }).status, 'submitted');
  });

  test('requests that are not open cannot be submitted', () => {
    list('Science Department', 'Closed Widget', 5);
    const waiting = request('Student Council', 'closed-widget', 1, { status: 'pending_review', by: casey.id });
    throws(() => submitPlan(casey, waiting, { signature: 'x' }), 409);
    const open = request('Student Council', 'closed-widget', 1, { by: casey.id });
    submitPlan(casey, open, { signature: planFor(open).signature });
    throws(() => submitPlan(casey, open, { signature: 'x' }), 409); // already submitted
  });

  test('cancelling a submitted request gives the stock back', () => {
    setPlanRule('always');
    const { listing, id, plan } = scenario('Submit Widget I', { by: casey.id });
    submitPlan(casey, id, { signature: plan.signature });
    assert.equal(reservedOf(listing), 5);
    cancelRequest(id, casey);
    assert.equal(reservedOf(listing), 0);
    assert.equal(statusOf(id), 'cancelled');
  });

  test('the demo plan can be submitted end to end', () => {
    setPlanRule('threshold', 20000);
    const id = db.prepare("SELECT id FROM requests WHERE organization_id = ? AND item_name = 'Reusable containers'").get(org).id;
    const tubs = planFor(id).suggestions.map((s) => s.resourceId);
    const seen = planFor(id, tubs);
    const result = submitPlan(casey, id, { substituteIds: tubs, signature: seen.signature });
    assert.equal(result.needsApproval, true); // $404.00 is above the $200.00 threshold
    assert.equal(seen.totalValueCents, 20 * 1200 + 12 * 900 + 8 * 700);
    assert.equal(statusOf(id), 'pending_approval');
  });

  test('the laptop demo covers 6 of 10 because partial is OK', () => {
    const id = db.prepare("SELECT id FROM requests WHERE organization_id = ? AND item_name = 'Laptops'").get(org).id;
    const plan = planFor(id);
    assert.equal(plan.covered, 6);
    assert.equal(plan.shortfall, 4);
    assert.equal(plan.canSubmit, true);
  });
});

describe('matches over HTTP', () => {
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
  const call = (cookie, url, init = {}) => fetch(`${base}${url}`, {
    ...init, headers: { Cookie: cookie, 'Content-Type': 'application/json' } });

  before(async () => {
    server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The test server did not start.');
  });
  after(() => server?.kill());

  // Use a request no earlier test touched: the Robotics soldering-iron request has nothing listed for it.
  const irons = () => db.prepare("SELECT id FROM requests WHERE organization_id = ? AND item_name = 'Soldering irons'").get(org).id;

  test('signed-out visitors get 401', async () => {
    assert.equal((await fetch(`${base}/api/matches/${irons()}`)).status, 401);
    assert.equal((await fetch(`${base}/api/matches/${irons()}/submit`, { method: 'POST' })).status, 401);
  });

  test('a requester sees the plan; other organizations and unrelated people get 404', async () => {
    const cookie = await signIn('robotics@mapleridge.example');
    const response = await call(cookie, `/api/matches/${irons()}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.plan.canSubmit, false);
    assert.equal(body.plan.lines.length, 0);

    const other = await signIn('admin@riverside.example');
    assert.equal((await call(other, `/api/matches/${irons()}`)).status, 404);
    const unrelated = await signIn('culinary@mapleridge.example');
    assert.equal((await call(unrelated, `/api/matches/${irons()}`)).status, 404);
    assert.equal((await call(cookie, '/api/matches/abc')).status, 404);
  });

  test('the dashboard summary lists only open requests the person can see, with what the engine found', async () => {
    const cookie = await signIn('council@mapleridge.example');
    list('Science Department', 'Dash Widget', 4);
    request('Student Council', 'dash-widget', 6, { by: casey.id });
    const { matches, totalOpen } = await (await call(cookie, '/api/matches')).json();
    const mine = matches.find((m) => m.itemName === 'dash-widget');
    assert.ok(mine, 'the new open request is listed');
    assert.equal(mine.requested, 6);
    assert.equal(mine.covered, 4);
    assert.equal(mine.shortfall, 2);
    assert.deepEqual(mine.sources, ['Science Department']);
    assert.equal(mine.substitutesAvailable, 0);
    assert.ok(matches.length <= 6 && totalOpen >= matches.length);
    assert.ok(matches.every((m) => m.unitName === 'Student Council'), 'only requests from their own unit');
    assert.equal((await fetch(`${base}/api/matches`)).status, 401);
  });

  test('a request that is not open returns no plan', async () => {
    const cookie = await signIn('admin@mapleridge.example');
    const cancelled = request('Student Council', 'http-widget', 1, { status: 'cancelled' });
    const body = await (await call(cookie, `/api/matches/${cancelled}`)).json();
    assert.equal(body.plan, null);
    assert.equal(body.request.status, 'cancelled');
  });

  test('submitting with a stale signature answers 409 with the updated plan and reserves nothing', async () => {
    const cookie = await signIn('admin@mapleridge.example');
    const widget = list('Science Department', 'Http Widget', 4);
    const id = request('Student Council', 'http-widget', 4);
    const seen = await (await call(cookie, `/api/matches/${id}`)).json();
    db.prepare('UPDATE resources SET quantity_reserved = 1 WHERE id = ?').run(widget);
    const stale = await call(cookie, `/api/matches/${id}/submit`, { method: 'POST', body: JSON.stringify({ signature: seen.plan.signature }) });
    assert.equal(stale.status, 409);
    const body = await stale.json();
    assert.equal(body.status, 'changed');
    assert.equal(body.plan.covered, 3);
    assert.equal(reservedOf(widget), 1);
  });

  test('a good submit through the API reserves the stock', async () => {
    setPlanRule('always');
    const cookie = await signIn('admin@mapleridge.example');
    const widget = list('Science Department', 'Http Widget Two', 2);
    const id = request('Student Council', 'http-widget-two', 2);
    const seen = await (await call(cookie, `/api/matches/${id}`)).json();
    const response = await call(cookie, `/api/matches/${id}/submit`, { method: 'POST', body: JSON.stringify({ substituteIds: [], signature: seen.plan.signature }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).requestStatus, 'pending_approval');
    assert.equal(reservedOf(widget), 2);
    const bad = await call(cookie, `/api/matches/${id}/submit`, { method: 'POST', body: JSON.stringify({ substituteIds: 'nope' }) });
    assert.equal(bad.status, 400);
  });

  test('"my listings" shows the person\'s units, including listings still in review', async () => {
    const cookie = await signIn('green@mapleridge.example'); // Environmental Club manager, Science member
    const { resources: mine } = await (await call(cookie, '/api/resources/mine')).json();
    assert.ok(mine.some((r) => r.name === 'Seed Starter Trays' && r.status === 'pending_review'));
    assert.ok(mine.every((r) => ['Environmental Club', 'Science Department'].includes(r.unitName)));
    assert.ok(mine.every((r) => r.quantityAvailable === r.quantityTotal - r.quantityReserved));
  });
});

// Best-effort cleanup: Windows will not delete a database file that is still open.
after(() => {
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS cleans its temp folder */ }
});
