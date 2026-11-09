// Admin API: review listings, approve requests/transfers, manage inventory,
// resolve conflicts, view completed transactions.
// Every route here requires the admin role.
// TODO: implement the endpoints listed in the README roadmap.
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('admin'));

router.get('/queue', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet.' });
});

export default router;
