// Route guards. Use these in routes/ to protect endpoints.
import { loadUserById } from '../services/users.js';

/**
 * Runs on every /api request: loads the signed-in person fresh from the database
 * into req.user (or null). The session only remembers their id.
 */
export function attachUser(req, _res, next) {
  const id = req.session?.userId;
  req.user = id ? loadUserById(id) : null;
  if (id && !req.user) delete req.session.userId; // the account no longer exists
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

/** Organization administrators only. */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Only organization admins can do that.' });
  next();
}

/** Admins and unit managers (people who can publish listings). */
export function requirePublisher(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  if (!req.user.canPublish) return res.status(403).json({ error: 'Only unit managers and admins can do that.' });
  next();
}
