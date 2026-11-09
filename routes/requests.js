// Requests API.
// TODO: POST / (validate and save a request), GET / (list own org's requests).
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.post('/', requireLogin, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet.' });
});

export default router;
