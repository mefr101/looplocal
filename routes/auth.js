// Sign-in, sign-out, registration, and "who am I".
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../database/db.js';
import { FieldErrors, isEmail, isNonEmptyString, isPositiveInt } from '../services/validation.js';

const router = Router();

function publicUser(row) {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    organizationId: row.organization_id, organizationName: row.organization_name,
  };
}

const findUserByEmail = () => db.prepare(
  `SELECT u.*, o.name AS organization_name FROM users u
   JOIN organizations o ON o.id = u.organization_id WHERE u.email = ?`);

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const row = isEmail(email) ? findUserByEmail().get(email) : null;
  // Same message for unknown email and wrong password, so accounts can't be probed.
  if (!row || typeof password !== 'string' || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not sign in.' });
    req.session.user = publicUser(row);
    res.json({ user: req.session.user });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// New accounts are always plain members; managers and admins are promoted by an admin.
router.post('/register', (req, res) => {
  const { name, email, password, organizationId } = req.body ?? {};
  const problems = new FieldErrors();
  if (!isNonEmptyString(name, { max: 100 })) problems.add('name', 'Enter your name.');
  if (!isEmail(email)) problems.add('email', 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8) problems.add('password', 'Use at least 8 characters.');
  if (!isPositiveInt(organizationId) || !db.prepare('SELECT 1 FROM organizations WHERE id = ?').get(organizationId)) {
    problems.add('organizationId', 'Choose your organization.');
  }
  if (!problems.hasAny && findUserByEmail().get(email)) problems.add('email', 'That email is already registered.');
  if (problems.hasAny) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: problems.errors });

  const id = Number(db.prepare(
    'INSERT INTO users (organization_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(organizationId, name.trim(), email, bcrypt.hashSync(password, 10), 'member').lastInsertRowid);
  const row = db.prepare(
    `SELECT u.*, o.name AS organization_name FROM users u
     JOIN organizations o ON o.id = u.organization_id WHERE u.id = ?`).get(id);
  req.session.regenerate(() => {
    req.session.user = publicUser(row);
    res.status(201).json({ user: req.session.user });
  });
});

export default router;
