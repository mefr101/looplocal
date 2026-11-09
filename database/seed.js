// Demo data. Run with `npm run seed` (skips if data exists) or `npm run reset` (wipes first).
//
// Two separate organizations are created so you can see that they never mix:
//
//   Maple Ridge High School   (school)     join code MAPLE826
//     Units: Science Dept, Environmental Club, Art Dept, Robotics Team, Culinary Arts, Student Council
//     Requests go live immediately; plans above $200 need admin approval.
//     The "40 reusable containers" scenario lives here:
//       Science 20 + Environmental Club 12 (exact), Art Dept 15 tubs (substitute) -> Student Council asks for 40.
//
//   Riverside Community Pantry (nonprofit)  join code PANTRY26
//     Units: Food Distribution, Volunteer Programs, Youth Outreach
//     Its own category list. Requests from members wait for admin review; every plan needs approval.
//
// Every account uses the demo password below. Change it before any public deploy.
import bcrypt from 'bcryptjs';
import { db, withTransaction, ensureSchema, resetSchema } from './db.js';

const DEMO_PASSWORD = 'looplocal123';
const reset = process.argv.includes('--reset');

/** Returns an ISO date (YYYY-MM-DD) offset from today. */
function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

const WEEKDAYS = 'mon,tue,wed,thu,fri';

/**
 * Create an organization with its categories, locations, units and people.
 * Returns lookup tables of ids so the rest of the seed can refer to things by name.
 */
function buildOrganization(spec, passwordHash) {
  const orgId = Number(db.prepare(
    `INSERT INTO organizations (name, type, join_code, review_requests, plan_approval_mode, plan_approval_threshold_cents)
     VALUES (?, ?, ?, ?, ?, ?)`).run(spec.name, spec.type, spec.joinCode, spec.reviewRequests ? 1 : 0,
    spec.planApproval, spec.thresholdCents ?? 20000).lastInsertRowid);

  const cat = {};
  for (const name of spec.categories) {
    cat[name] = Number(db.prepare('INSERT INTO categories (organization_id, name) VALUES (?, ?)').run(orgId, name).lastInsertRowid);
  }
  const loc = {};
  for (const name of spec.locations) {
    loc[name] = Number(db.prepare('INSERT INTO locations (organization_id, name) VALUES (?, ?)').run(orgId, name).lastInsertRowid);
  }
  const unit = {};
  const unitSpec = {};
  for (const u of spec.units) {
    unit[u.name] = Number(db.prepare(
      `INSERT INTO units (organization_id, name, kind, default_pickup_days, default_pickup_start,
         default_pickup_end, default_location_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(orgId, u.name, u.kind, u.days, u.start, u.end, loc[u.location]).lastInsertRowid);
    unitSpec[u.name] = u;
  }
  const user = {};
  for (const p of spec.users) {
    user[p.key] = Number(db.prepare(
      'INSERT INTO users (organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, p.name, p.email, passwordHash, p.admin ? 'org_admin' : 'member').lastInsertRowid);
    for (const [unitName, role] of p.units ?? []) {
      db.prepare('INSERT INTO user_units (user_id, unit_id, role) VALUES (?, ?, ?)').run(user[p.key], unit[unitName], role);
    }
  }
  return { orgId, cat, loc, unit, unitSpec, user };
}

/** Add a listing for a unit, using the unit's default location and pickup hours. */
function addResource(ctx, unitName, userKey, r) {
  const u = ctx.unitSpec[unitName];
  const id = Number(db.prepare(
    `INSERT INTO resources (organization_id, unit_id, created_by, name, description, category_id,
       quantity_total, condition, location_id, location_note, pickup_days, pickup_time_start, pickup_time_end,
       replacement_value_cents, available_from, available_until, status)
     VALUES (:org, :unit, :user, :name, :description, :category, :qty, :condition, :location, :note,
       :days, :start, :end, :value, :from, :until, :status)`).run({
    org: ctx.orgId, unit: ctx.unit[unitName], user: ctx.user[userKey], name: r.name, description: r.description,
    category: ctx.cat[r.category], qty: r.qty, condition: r.condition, location: ctx.loc[u.location],
    note: r.note ?? '', days: u.days, start: u.start, end: u.end, value: r.valueCents,
    from: daysFromNow(-7), until: daysFromNow(90), status: r.status ?? 'approved',
  }).lastInsertRowid);
  const insertTag = db.prepare('INSERT INTO resource_tags (resource_id, tag, kind) VALUES (?, ?, ?)');
  for (const tag of r.identity ?? []) insertTag.run(id, tag, 'identity');
  for (const tag of r.substitute ?? []) insertTag.run(id, tag, 'substitute');
  return id;
}

/** Add a request from a unit. `reviewed: true` records that an admin approved it. */
function addRequest(ctx, unitName, userKey, adminKey, r) {
  return Number(db.prepare(
    `INSERT INTO requests (organization_id, unit_id, requested_by, item_name, category_id, need_tag, quantity,
       intended_use, needed_by, pickup_days, pickup_time_start, pickup_time_end, fulfillment_method,
       deliver_to_location_id, notes, accepts_substitutes, accepts_partial, status, reviewed_by, reviewed_at)
     VALUES (:org, :unit, :user, :item, :category, :tag, :qty, :use, :by, :days, :start, :end, :method,
       :place, :notes, :subs, :partial, :status, :reviewer, :reviewedAt)`).run({
    org: ctx.orgId, unit: ctx.unit[unitName], user: ctx.user[userKey], item: r.item, category: ctx.cat[r.category],
    tag: r.tag, qty: r.qty, use: r.use, by: r.by, days: r.days ?? '', start: r.start ?? null, end: r.end ?? null,
    method: r.method ?? 'pickup', place: r.deliverTo ? ctx.loc[r.deliverTo] : null, notes: r.notes ?? '',
    subs: r.subs ? 1 : 0, partial: r.partial ? 1 : 0, status: r.status,
    reviewer: r.reviewed ? ctx.user[adminKey] : null, reviewedAt: r.reviewed ? daysFromNow(-25) : null,
  }).lastInsertRowid);
}

function seedMapleRidge(hash) {
  const ctx = buildOrganization({
    name: 'Maple Ridge High School', type: 'school', joinCode: 'MAPLE826', reviewRequests: false,
    planApproval: 'threshold', thresholdCents: 20000,
    categories: ['Containers & Storage', 'Art Supplies', 'Lab & Science', 'Furniture', 'Electronics',
      'Sports & Recreation', 'Kitchen & Food Service', 'Books & Media'],
    locations: ['Science Wing, Room 214', 'Room 108', 'Art Wing Storage', 'Workshop B', 'Kitchen Lab', 'Main Office', 'Gym Storage'],
    units: [
      { name: 'Science Department', kind: 'department', location: 'Science Wing, Room 214', days: WEEKDAYS, start: '07:30', end: '15:30' },
      { name: 'Environmental Club', kind: 'club', location: 'Room 108', days: 'tue,thu', start: '15:00', end: '16:30' },
      { name: 'Art Department', kind: 'department', location: 'Art Wing Storage', days: WEEKDAYS, start: '08:00', end: '16:00' },
      { name: 'Robotics Team', kind: 'team', location: 'Workshop B', days: 'mon,wed,fri', start: '15:30', end: '18:00' },
      { name: 'Culinary Arts', kind: 'department', location: 'Kitchen Lab', days: WEEKDAYS, start: '10:00', end: '14:00' },
      { name: 'Student Council', kind: 'club', location: 'Main Office', days: WEEKDAYS, start: '12:00', end: '13:00' },
    ],
    users: [
      { key: 'admin', name: 'Alex Admin', email: 'admin@mapleridge.example', admin: true },
      { key: 'science', name: 'Sam Science', email: 'science@mapleridge.example', units: [['Science Department', 'manager']] },
      // Belongs to two units: manages one, is an ordinary member of the other.
      { key: 'green', name: 'Gina Green', email: 'green@mapleridge.example', units: [['Environmental Club', 'manager'], ['Science Department', 'member']] },
      { key: 'art', name: 'Ari Art', email: 'art@mapleridge.example', units: [['Art Department', 'manager']] },
      { key: 'robotics', name: 'Robin Robotics', email: 'robotics@mapleridge.example', units: [['Robotics Team', 'member']] },
      { key: 'culinary', name: 'Cam Culinary', email: 'culinary@mapleridge.example', units: [['Culinary Arts', 'manager']] },
      { key: 'council', name: 'Casey Council', email: 'council@mapleridge.example', units: [['Student Council', 'member']] },
    ],
  }, hash);

  const rid = {};
  rid.scienceContainers = addResource(ctx, 'Science Department', 'science', {
    name: 'Reusable Lab Storage Containers (lidded)', category: 'Containers & Storage', qty: 20, condition: 'good',
    valueCents: 1200, identity: ['reusable-container'], note: 'Cabinet under the fume hood',
    description: 'Clear polypropylene containers with snap lids, about 2 liters each. Cleaned and ready to use.' });
  rid.beakers = addResource(ctx, 'Science Department', 'science', {
    name: 'Glass Beakers (250 mL)', category: 'Lab & Science', qty: 30, condition: 'good', valueCents: 450,
    identity: ['beaker'], description: 'Borosilicate beakers, no chips.' });
  addResource(ctx, 'Environmental Club', 'green', {
    name: 'Reusable Food-Safe Containers', category: 'Containers & Storage', qty: 12, condition: 'good',
    valueCents: 900, identity: ['reusable-container'],
    description: 'Leftover containers from last spring\'s composting project. Food-safe and washed.' });
  addResource(ctx, 'Environmental Club', 'green', {
    name: 'Seed Starter Trays', category: 'Lab & Science', qty: 30, condition: 'good', valueCents: 300,
    identity: ['seed-tray'], status: 'pending_review', description: 'Waiting for an admin to review this listing.' });
  addResource(ctx, 'Art Department', 'art', {
    name: 'Plastic Storage Tubs', category: 'Containers & Storage', qty: 15, condition: 'fair', valueCents: 700,
    identity: ['storage-tub'], substitute: ['reusable-container'],
    description: 'Stackable tubs used for clay and paint kits. Not food-safe, but sturdy for dry goods and supplies.' });
  addResource(ctx, 'Art Department', 'art', {
    name: 'Tabletop Easels', category: 'Art Supplies', qty: 10, condition: 'good', valueCents: 2500,
    identity: ['easel'], description: 'Wooden tabletop easels, suitable for student paintings.' });
  addResource(ctx, 'Robotics Team', 'admin', {
    name: 'Refurbished Laptops', category: 'Electronics', qty: 6, condition: 'fair', valueCents: 18000,
    identity: ['laptop'], description: 'Older laptops wiped and reset. Suitable for coding practice.' });
  addResource(ctx, 'Culinary Arts', 'culinary', {
    name: 'Sheet Pans (half size)', category: 'Kitchen & Food Service', qty: 24, condition: 'good', valueCents: 1400,
    identity: ['sheet-pan'], description: 'Aluminum half-size sheet pans.' });

  // The demo scenario: Student Council asks for 40 containers to be delivered for a food drive.
  addRequest(ctx, 'Student Council', 'council', 'admin', {
    item: 'Reusable containers', category: 'Containers & Storage', tag: 'reusable-container', qty: 40,
    use: 'Packing meals for the winter food drive.', by: daysFromNow(14), days: WEEKDAYS, start: '12:00', end: '13:00',
    method: 'delivery', deliverTo: 'Main Office', notes: 'Deliver to the front desk, ask for Casey.', subs: true, status: 'open' });
  addRequest(ctx, 'Robotics Team', 'robotics', 'admin', {
    item: 'Soldering irons', category: 'Electronics', tag: 'soldering-iron', qty: 6,
    use: 'Building sensor kits for the spring competition.', by: daysFromNow(30), days: 'tue,thu', start: '15:30', end: '17:30',
    status: 'open' });

  // A finished transfer, so the Impact Ledger has history.
  const requestId = addRequest(ctx, 'Environmental Club', 'green', 'admin', {
    item: 'Beakers', category: 'Lab & Science', tag: 'beaker', qty: 10, use: 'Water-quality testing for Earth Week.',
    by: daysFromNow(-10), status: 'fulfilled', reviewed: true });
  const reservationId = Number(db.prepare(
    `INSERT INTO reservations (organization_id, request_id, status, created_by, reviewed_by, created_at, reviewed_at)
     VALUES (?, ?, 'completed', ?, ?, ?, ?)`)
    .run(ctx.orgId, requestId, ctx.user.green, ctx.user.admin, daysFromNow(-20), daysFromNow(-18)).lastInsertRowid);
  const itemId = Number(db.prepare(
    `INSERT INTO reservation_items (reservation_id, resource_id, quantity, match_type, reason, pickup_note)
     VALUES (?, ?, 10, 'exact', 'Exact match for beaker; 30 in stock.', 'Science Wing, Room 214, weekdays.')`)
    .run(reservationId, rid.beakers).lastInsertRowid);
  const transferId = Number(db.prepare(
    `INSERT INTO transfers (reservation_item_id, status, scheduled_for, completed_at, confirmed_by)
     VALUES (?, 'completed', ?, ?, ?)`).run(itemId, daysFromNow(-12), daysFromNow(-12), ctx.user.admin).lastInsertRowid);
  db.prepare(
    `INSERT INTO impact_ledger (organization_id, transfer_id, resource_id, resource_name, category_id, quantity,
       supplier_unit_id, receiver_unit_id, completed_at, unit_value_cents, cost_avoided_cents)
     VALUES (?, ?, ?, 'Glass Beakers (250 mL)', ?, 10, ?, ?, ?, 450, 4500)`)
    .run(ctx.orgId, transferId, rid.beakers, ctx.cat['Lab & Science'], ctx.unit['Science Department'],
      ctx.unit['Environmental Club'], daysFromNow(-12));
  // Stock went down when the transfer completed.
  db.prepare('UPDATE resources SET quantity_total = quantity_total - 10 WHERE id = ?').run(rid.beakers);
}

function seedRiverside(hash) {
  const ctx = buildOrganization({
    name: 'Riverside Community Pantry', type: 'nonprofit', joinCode: 'PANTRY26', reviewRequests: true,
    planApproval: 'always',
    // A different category list than the school's: each organization keeps its own.
    categories: ['Containers & Storage', 'Kitchen & Food Service', 'Furniture', 'Electronics', 'Books & Media', 'Outreach Supplies'],
    locations: ['Warehouse', 'Front Desk', 'Community Room'],
    units: [
      { name: 'Food Distribution', kind: 'program', location: 'Warehouse', days: 'mon,wed,fri', start: '09:00', end: '15:00' },
      { name: 'Volunteer Programs', kind: 'program', location: 'Front Desk', days: WEEKDAYS, start: '10:00', end: '16:00' },
      { name: 'Youth Outreach', kind: 'program', location: 'Community Room', days: 'tue,thu', start: '14:00', end: '18:00' },
    ],
    users: [
      { key: 'admin', name: 'Pat Pantry', email: 'admin@riverside.example', admin: true },
      { key: 'food', name: 'Fran Food', email: 'food@riverside.example', units: [['Food Distribution', 'manager']] },
      { key: 'youth', name: 'Yuri Youth', email: 'youth@riverside.example', units: [['Youth Outreach', 'member'], ['Volunteer Programs', 'member']] },
    ],
  }, hash);

  addResource(ctx, 'Youth Outreach', 'admin', {
    name: 'Folding Chairs', category: 'Furniture', qty: 40, condition: 'fair', valueCents: 1500,
    identity: ['folding-chair'], description: 'Metal folding chairs from a closed event space.' });
  addResource(ctx, 'Food Distribution', 'food', {
    name: 'Insulated Food Carriers', category: 'Containers & Storage', qty: 10, condition: 'good', valueCents: 4500,
    identity: ['insulated-carrier'], description: 'Hot/cold carriers for transporting meals.' });
  addResource(ctx, 'Volunteer Programs', 'admin', {
    name: 'Donated Picture Books', category: 'Books & Media', qty: 80, condition: 'good', valueCents: 600,
    identity: ['book'], status: 'pending_review', description: 'Children\'s picture books waiting for admin review.' });

  // Needs 25 reusable containers: none exist HERE (the school's are invisible), so a plan would be a shortfall.
  addRequest(ctx, 'Food Distribution', 'admin', 'admin', {
    item: 'Reusable containers', category: 'Containers & Storage', tag: 'reusable-container', qty: 25,
    use: 'Packing weekly meal kits.', by: daysFromNow(21), days: 'mon,wed,fri', start: '09:00', end: '15:00', status: 'open' });
  // A member's request: this organization reviews requests, so it waits for an admin.
  addRequest(ctx, 'Youth Outreach', 'youth', 'admin', {
    item: 'Folding tables', category: 'Furniture', tag: 'folding-table', qty: 4,
    use: 'Setting up a homework help room.', by: daysFromNow(28), days: 'tue,thu', start: '14:00', end: '18:00',
    status: 'pending_review' });
}

function run() {
  // --reset rebuilds every table from schema.sql, so schema changes always take effect.
  if (reset) resetSchema(); else ensureSchema();

  if (db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n > 0) {
    console.log('Database already has data. Use `npm run reset` to wipe and reseed.');
    return;
  }

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  withTransaction(() => {
    seedMapleRidge(hash);
    seedRiverside(hash);
  });

  console.log('Seeded demo data for two separate organizations.');
  console.log(`  Maple Ridge High School      join code MAPLE826   admin@mapleridge.example`);
  console.log(`  Riverside Community Pantry   join code PANTRY26   admin@riverside.example`);
  console.log(`All demo accounts use the password "${DEMO_PASSWORD}". See database/seed.js for the full list.`);
}

run();
