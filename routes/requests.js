// Requests API. Thin HTTP layer: all the rules live in services/requests.js.
//
//   GET    /api/requests/context          what the form needs: units, locations, whether review applies
//   GET    /api/requests/suggestions?q=   type-ahead item suggestions
//   GET    /api/requests/mine             requests the signed-in person can see
//   GET    /api/requests/:id              one request (to fill the edit form)
//   POST   /api/requests                  submit a new request
//   PUT    /api/requests/:id              edit (only while pending_review or open)
//   POST   /api/requests/:id/cancel       cancel (releases stock if a plan was submitted)
import { Router } from 'express';
import { db } from '../database/db.js';
import { requireLogin } from '../middleware/auth.js';
import { requestableUnits } from '../services/permissions.js';
import {
  cancelRequest, createRequest, getRequest, listRequestsForUser,
  suggestItems, updateRequest, validateRequest,
} from '../services/requests.js';

const router = Router();
router.use(requireLogin);

/** Ids in URLs must be plain positive integers. */
function parseId(req, res) {
  if (!/^\d+$/.test(req.params.id)) {
    res.status(404).json({ error: 'Request not found.' });
    return null;
  }
  return Number(req.params.id);
}

function rejectInvalid(errors, res) {
  res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors.errors });
}

router.get('/context', (req, res) => {
  const user = req.user;
  const org = db.prepare('SELECT review_requests FROM organizations WHERE id = ?').get(user.organizationId);
  res.json({
    organizationName: user.organizationName,
    units: requestableUnits(user),
    locations: db.prepare('SELECT id, name FROM locations WHERE organization_id = ? ORDER BY name').all(user.organizationId),
    // Admins review requests, so their own requests are never held for review.
    reviewRequired: org.review_requests === 1 && !user.isAdmin,
  });
});

router.get('/suggestions', (req, res) => {
  const unitId = /^\d+$/.test(req.query.unitId ?? '') ? Number(req.query.unitId) : null;
  res.json({ suggestions: suggestItems(req.query.q, req.user, unitId) });
});

router.get('/mine', (req, res) => {
  res.json({ requests: listRequestsForUser(req.user) });
});

router.get('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id !== null) res.json({ request: getRequest(id, req.user) });
});

router.post('/', (req, res) => {
  const { errors, values } = validateRequest(req.body, req.user);
  if (errors.hasAny) return rejectInvalid(errors, res);
  const request = createRequest(req.user, values);
  res.status(201).json({ request, needsReview: request.status === 'pending_review' });
});

router.put('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const { errors, values } = validateRequest(req.body, req.user);
  if (errors.hasAny) return rejectInvalid(errors, res);
  res.json({ request: updateRequest(id, req.user, values) });
});

router.post('/:id/cancel', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  cancelRequest(id, req.user);
  res.json({ ok: true });
});

export default router;
