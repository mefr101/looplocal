// Who may act for which unit. Keep these rules in one place so every route agrees.
//
//   Org admin     any unit in their organization
//   Unit manager  publishes for, and manages, the units they manage; requests for any unit they belong to
//   Member        requests for the units they belong to
import { db } from '../database/db.js';

const allUnits = (organizationId) =>
  db.prepare('SELECT id, name FROM units WHERE organization_id = ? ORDER BY name').all(organizationId);

/** Units this person may submit requests for. */
export function requestableUnits(user) {
  if (user.isAdmin) return allUnits(user.organizationId);
  return user.units.map(({ id, name }) => ({ id, name }));
}

/** Units this person may publish listings for. */
export function publishableUnits(user) {
  if (user.isAdmin) return allUnits(user.organizationId);
  return user.units.filter((unit) => unit.role === 'manager').map(({ id, name }) => ({ id, name }));
}

/** May this person edit or cancel things that belong to the given unit? */
export function canManageUnit(user, unitId) {
  if (user.isAdmin) return true;
  return user.units.some((unit) => unit.id === unitId && unit.role === 'manager');
}
