// Statistics. Every figure is calculated from database records.
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import { getDashboardStats, getPublicStats } from '../services/impact.js';

const router = Router();

// Public: totals from completed transfers only, shown on the home page.
router.get('/public', (_req, res) => {
  res.json(getPublicStats());
});

// Signed-in users only: operational numbers (requests, approvals) for the dashboard.
router.get('/dashboard', requireLogin, (_req, res) => {
  res.json(getDashboardStats());
});

export default router;
