// Statistics. Every figure is calculated from database records.
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import { getDashboardStats, getPublicStats } from '../services/impact.js';

const router = Router();

// Public: platform-wide totals from completed transfers only, shown on the home page.
// No organization is named and nothing about individual items or people is included.
router.get('/public', (_req, res) => {
  res.json(getPublicStats());
});

// Signed-in users: their own organization's numbers.
router.get('/dashboard', requireLogin, (req, res) => {
  res.json(getDashboardStats(req.user.organizationId));
});

export default router;
