// Demo data. Run with `npm run seed` (skips if data exists) or `npm run reset` (wipes first).
//
// Includes the brief's "40 reusable containers" scenario so the Rescue Engine
// has something real to combine:
//   Science Department   20 containers   (exact match)
//   Environmental Club    12 containers   (exact match)
//   Art Department        15 tubs         (substitute)
//
// Every account uses the demo password below. Change it before any public deploy.
import bcrypt from 'bcryptjs';
import { db, withTransaction } from './db.js';

const DEMO_PASSWORD = 'looplocal123';
const reset = process.argv.includes('--reset');

const TABLES_IN_DELETE_ORDER = [
  'audit_log', 'conflicts', 'impact_ledger', 'transfers', 'reservation_items',
  'reservations', 'requests', 'resource_tags', 'resource_images', 'resources',
  'categories', 'users', 'organizations',
];

/** Returns an ISO date (YYYY-MM-DD) offset from today. */
function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function run() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n;
  if (existing > 0 && !reset) {
    console.log('Database already has data. Use `npm run reset` to wipe and reseed.');
    return;
  }

  withTransaction(() => {
    for (const table of TABLES_IN_DELETE_ORDER) db.exec(`DELETE FROM ${table}`);

    // --- Categories -------------------------------------------------------
    const categoryIds = {};
    const insertCategory = db.prepare('INSERT INTO categories (name) VALUES (?)');
    for (const name of ['Containers & Storage', 'Art Supplies', 'Lab & Science', 'Furniture',
                        'Electronics', 'Sports & Recreation', 'Kitchen & Food Service', 'Books & Media']) {
      categoryIds[name] = Number(insertCategory.run(name).lastInsertRowid);
    }

    // --- Organizations ----------------------------------------------------
    const orgIds = {};
    const insertOrg = db.prepare(
      `INSERT INTO organizations (name, type, address, latitude, longitude, contact_email)
       VALUES (?, ?, ?, ?, ?, ?)`);
    const orgs = [
      ['Science Department', 'school_department', 'Maple Ridge High, Room 214', 40.7128, -74.0060, 'science@mapleridge.example'],
      ['Environmental Club', 'club', 'Maple Ridge High, Room 108', 40.7128, -74.0060, 'green@mapleridge.example'],
      ['Art Department', 'school_department', 'Maple Ridge High, Art Wing', 40.7128, -74.0060, 'art@mapleridge.example'],
      ['Robotics Team', 'club', 'Maple Ridge High, Workshop B', 40.7128, -74.0060, 'robotics@mapleridge.example'],
      ['Culinary Arts', 'school_department', 'Maple Ridge High, Kitchen Lab', 40.7128, -74.0060, 'culinary@mapleridge.example'],
      ['Riverside Community Pantry', 'nonprofit', '45 River St', 40.7306, -73.9866, 'hello@riversidepantry.example'],
      ['Eastside Youth Center', 'nonprofit', '210 East Ave', 40.7411, -73.9897, 'info@eastsideyouth.example'],
    ];
    for (const org of orgs) orgIds[org[0]] = Number(insertOrg.run(...org).lastInsertRowid);

    // --- Users ------------------------------------------------------------
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const userIds = {};
    const insertUser = db.prepare(
      'INSERT INTO users (organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)');
    const users = [
      ['admin', 'Science Department', 'Alex Admin', 'admin@looplocal.example', 'admin'],
      ['science', 'Science Department', 'Sam Science', 'science@looplocal.example', 'org_manager'],
      ['green', 'Environmental Club', 'Gina Green', 'green@looplocal.example', 'org_manager'],
      ['art', 'Art Department', 'Ari Art', 'art@looplocal.example', 'org_manager'],
      ['robotics', 'Robotics Team', 'Robin Robotics', 'robotics@looplocal.example', 'member'],
      ['pantry', 'Riverside Community Pantry', 'Pat Pantry', 'pantry@looplocal.example', 'org_manager'],
      ['youth', 'Eastside Youth Center', 'Yuri Youth', 'youth@looplocal.example', 'member'],
    ];
    for (const [key, org, name, email, role] of users) {
      userIds[key] = Number(insertUser.run(orgIds[org], name, email, hash, role).lastInsertRowid);
    }

    // --- Resources --------------------------------------------------------
    const insertResource = db.prepare(
      `INSERT INTO resources (organization_id, created_by, name, description, category_id,
         quantity_total, condition, location, latitude, longitude, replacement_value_cents,
         available_from, available_until, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertTag = db.prepare('INSERT INTO resource_tags (resource_id, tag, kind) VALUES (?, ?, ?)');

    const addResource = (orgName, userKey, r) => {
      const orgRow = orgs.find((o) => o[0] === orgName);
      const id = Number(insertResource.run(
        orgIds[orgName], userIds[userKey], r.name, r.description, categoryIds[r.category],
        r.qty, r.condition, orgRow[2], orgRow[3], orgRow[4], r.valueCents,
        daysFromNow(-7), daysFromNow(r.untilDays ?? 90), r.status ?? 'approved').lastInsertRowid);
      for (const tag of r.identity ?? []) insertTag.run(id, tag, 'identity');
      for (const tag of r.substitute ?? []) insertTag.run(id, tag, 'substitute');
      return id;
    };

    const rid = {};
    rid.scienceContainers = addResource('Science Department', 'science', {
      name: 'Reusable Lab Storage Containers (lidded)', category: 'Containers & Storage', qty: 20,
      condition: 'good', valueCents: 1200, identity: ['reusable-container'],
      description: 'Clear polypropylene containers with snap lids, about 2 liters each. Cleaned and ready to use.' });
    rid.greenContainers = addResource('Environmental Club', 'green', {
      name: 'Reusable Food-Safe Containers', category: 'Containers & Storage', qty: 12,
      condition: 'good', valueCents: 900, identity: ['reusable-container'],
      description: 'Leftover containers from last spring\'s composting project. Food-safe and washed.' });
    rid.artTubs = addResource('Art Department', 'art', {
      name: 'Plastic Storage Tubs', category: 'Containers & Storage', qty: 15,
      condition: 'fair', valueCents: 700, identity: ['storage-tub'], substitute: ['reusable-container'],
      description: 'Stackable tubs used for clay and paint kits. Not food-safe, but sturdy for dry goods and supplies.' });
    rid.easels = addResource('Art Department', 'art', {
      name: 'Tabletop Easels', category: 'Art Supplies', qty: 10, condition: 'good',
      valueCents: 2500, identity: ['easel'], description: 'Wooden tabletop easels, suitable for student paintings.' });
    rid.beakers = addResource('Science Department', 'science', {
      name: 'Glass Beakers (250 mL)', category: 'Lab & Science', qty: 30, condition: 'good',
      valueCents: 450, identity: ['beaker'], description: 'Borosilicate beakers, no chips.' });
    rid.chairs = addResource('Eastside Youth Center', 'youth', {
      name: 'Folding Chairs', category: 'Furniture', qty: 40, condition: 'fair', valueCents: 1500,
      identity: ['folding-chair'], description: 'Metal folding chairs from a closed event space.' });
    rid.laptops = addResource('Robotics Team', 'robotics', {
      name: 'Refurbished Laptops', category: 'Electronics', qty: 6, condition: 'fair', valueCents: 18000,
      identity: ['laptop'], description: 'Older laptops wiped and reset. Suitable for coding practice.' });
    rid.pans = addResource('Culinary Arts', 'admin', {
      name: 'Sheet Pans (half size)', category: 'Kitchen & Food Service', qty: 24, condition: 'good',
      valueCents: 1400, identity: ['sheet-pan'], description: 'Aluminum half-size sheet pans.' });
    rid.pendingListing = addResource('Riverside Community Pantry', 'pantry', {
      name: 'Donated Picture Books', category: 'Books & Media', qty: 80, condition: 'good',
      valueCents: 600, identity: ['book'], status: 'pending_review',
      description: 'Children\'s picture books waiting for admin review.' });

    // --- Open request (the demo scenario) ---------------------------------
    const insertRequest = db.prepare(
      `INSERT INTO requests (organization_id, requested_by, item_name, category_id, need_tag,
         quantity, intended_use, needed_by, pickup_constraints, accepts_substitutes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertRequest.run(orgIds['Riverside Community Pantry'], userIds.pantry, 'Reusable containers',
      categoryIds['Containers & Storage'], 'reusable-container', 40,
      'Packing pantry meals for weekly distribution.', daysFromNow(14),
      'Can pick up weekdays after 3 PM; one vehicle.', 1, 'open');

    // --- A completed transfer so the Impact Ledger has history ------------
    const reservationId = Number(db.prepare(
      `INSERT INTO reservations (request_id, status, created_by, reviewed_by, created_at, reviewed_at)
       VALUES (?, 'completed', ?, ?, ?, ?)`).run(
      Number(insertRequest.run(orgIds['Eastside Youth Center'], userIds.youth, 'Beakers for club',
        categoryIds['Lab & Science'], 'beaker', 10, 'Science night for students.',
        daysFromNow(-10), '', 0, 'fulfilled').lastInsertRowid),
      userIds.youth, userIds.admin, daysFromNow(-20), daysFromNow(-18)).lastInsertRowid);
    const itemId = Number(db.prepare(
      `INSERT INTO reservation_items (reservation_id, resource_id, quantity, match_type, reason, pickup_note)
       VALUES (?, ?, 10, 'exact', 'Exact match for beaker; 30 in stock.', 'Front office, weekdays.')`)
      .run(reservationId, rid.beakers).lastInsertRowid);
    const transferId = Number(db.prepare(
      `INSERT INTO transfers (reservation_item_id, status, scheduled_for, completed_at, confirmed_by)
       VALUES (?, 'completed', ?, ?, ?)`).run(itemId, daysFromNow(-12), daysFromNow(-12), userIds.admin).lastInsertRowid);
    db.prepare(
      `INSERT INTO impact_ledger (transfer_id, resource_id, resource_name, category_id, quantity,
         supplier_org_id, receiver_org_id, completed_at, unit_value_cents, cost_avoided_cents)
       VALUES (?, ?, 'Glass Beakers (250 mL)', ?, 10, ?, ?, ?, 450, 4500)`)
      .run(transferId, rid.beakers, categoryIds['Lab & Science'],
        orgIds['Science Department'], orgIds['Eastside Youth Center'], daysFromNow(-12));
    // Stock was reduced when the transfer completed.
    db.prepare('UPDATE resources SET quantity_total = quantity_total - 10 WHERE id = ?').run(rid.beakers);
  });

  console.log(`Seeded demo data. Sign in with any seeded email (e.g. admin@looplocal.example) and password "${DEMO_PASSWORD}".`);
}

run();
