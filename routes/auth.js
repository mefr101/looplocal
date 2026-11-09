// Sign-in, sign-out, sign-up (join with a code, or create an organization), and "who am I".
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { FailureLimiter, rateLimit } from '../middleware/rateLimit.js';
import { findLoginRow, loadUserById } from '../services/users.js';
import { registerMember, registerOrganization } from '../services/accounts.js';
import { findOrganizationByCode, listUnitsForJoining } from '../services/organizations.js';
import { isEmail } from '../services/validation.js';

const router = Router();

// Guessing is slowed to a crawl, but only WRONG guesses count, so a whole class of students
// sharing one school IP address can all sign in without using up the allowance.
const WINDOW = 15 * 60 * 1000;
const passwordGuesses = new FailureLimiter({ windowMs: WINDOW, max: 8 });      // per IP + email
const passwordGuessesByIp = new FailureLimiter({ windowMs: WINDOW, max: 60 }); // per IP, across emails
const codeGuesses = new FailureLimiter({ windowMs: WINDOW, max: 15 });         // wrong join codes per IP
const limitOrganizationCreation = rateLimit({ windowMs: 60 * 60 * 1000, max: 100 });

/** Start a fresh session for this person. (A new session id prevents session fixation.) */
function startSession(req, res, userId, status = 200) {
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not sign in.' });
    req.session.userId = userId;
    res.status(status).json({ user: loadUserById(userId) });
  });
}

router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const emailKey = `${req.ip}|${String(email).toLowerCase()}`;
  if (passwordGuesses.isBlocked(emailKey) || passwordGuessesByIp.isBlocked(req.ip)) return passwordGuesses.reject(res);

  const row = isEmail(email) ? findLoginRow(email) : null;
  // Same message for unknown email and wrong password, so accounts can't be probed.
  if (!row || typeof password !== 'string' || !bcrypt.compareSync(password, row.password_hash)) {
    passwordGuesses.fail(emailKey);
    passwordGuessesByIp.fail(req.ip);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  passwordGuesses.succeed(emailKey);
  startSession(req, res, row.id);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Step 1 of joining: check a join code and show the organization's name and units.
router.get('/join-code', (req, res) => {
  if (codeGuesses.isBlocked(req.ip)) return codeGuesses.reject(res);
  const organization = findOrganizationByCode(req.query.code);
  if (!organization) {
    codeGuesses.fail(req.ip);
    return res.status(404).json({ error: 'That code was not recognized. Ask your organization admin for the current code.' });
  }
  res.json({
    organization: { name: organization.name, type: organization.type },
    units: listUnitsForJoining(organization.id),
  });
});

// Step 2 of joining: create the account as an ordinary member of the chosen units.
// A wrong code here counts as a guess too, so this can't be used to get around the limit above.
router.post('/register', (req, res) => {
  if (codeGuesses.isBlocked(req.ip)) return codeGuesses.reject(res);
  let userId;
  try {
    userId = registerMember(req.body);
  } catch (error) {
    if (error.fields?.joinCode) codeGuesses.fail(req.ip);
    throw error;
  }
  startSession(req, res, userId, 201);
});

// Start a brand-new organization; the creator becomes its first admin.
router.post('/register-organization', limitOrganizationCreation, (req, res) => {
  startSession(req, res, registerOrganization(req.body), 201);
});

export default router;
