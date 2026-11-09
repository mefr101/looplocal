// Lookup lists used by forms and filters. Everything is limited to the signed-in
// person's own organization.
import { Router } from 'express';
import { db } from '../database/db.js';
import { requireLogin } from '../middleware/auth.js';
import { publishableUnits, requestableUnits } from '../services/permissions.js';

const router = Router();
router.use(requireLogin);

router.get('/categories', (req, res) => {
  res.json({
    categories: db.prepare('SELECT id, name FROM categories WHERE organization_id = ? ORDER BY name')
      .all(req.user.organizationId),
  });
});

router.get('/locations', (req, res) => {
  res.json({
    locations: db.prepare('SELECT id, name FROM locations WHERE organization_id = ? ORDER BY name')
      .all(req.user.organizationId),
  });
});

// Units this person can act for, split by what they may do.
router.get('/units', (req, res) => {
  res.json({ requestable: requestableUnits(req.user), publishable: publishableUnits(req.user) });
});

export default router;
