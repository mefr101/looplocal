// Match results API.
// TODO: GET /:requestId (run services/matching.js and return the proposed plan)
//       POST /:requestId/submit (services/reservations.js -> create pending reservation)
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/:requestId', requireLogin, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet.' });
});

export default router;
