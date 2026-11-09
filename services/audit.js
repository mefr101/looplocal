// Append-only record of who did what, shown to admins later.
import { db } from '../database/db.js';

/** `user` is the person acting (an object from services/users.js). */
export function recordAudit(user, action, entity, entityId, detail = '') {
  db.prepare(
    'INSERT INTO audit_log (organization_id, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.organizationId, user.id, action, entity, entityId, detail);
}
