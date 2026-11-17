// Transfers API: see the hand-offs for your units, and mark one completed or cancelled.
//
//   GET  /api/transfers
//   POST /api/transfers/:id/complete
//   POST /api/transfers/:id/cancel      { reason }
import
{
  Router
} from 'express';
import
{
  requireLogin
} from '../middleware/auth.js';
import
{
  cancelTransfer,
  completeTransfer,
  listTransfers
} from '../services/transfers.js';

const router = Router();
router.use(requireLogin);

function idParam(req, res)
{
  if (/^\d+$/.test(req.params.id)) return Number(req.params.id);
  res.status(404).json(
  {
    error: 'Transfer not found.'
  });
  return null;
}

router.get('/', (req, res) =>
{
  res.json(
  {
    transfers: listTransfers(req.user)
  });
});

router.post('/:id/complete', (req, res) =>
{
  const id = idParam(req, res);
  if (id === null) return;
  res.json(
  {
    ok: true,
    ...completeTransfer(id, req.user)
  });
});

router.post('/:id/cancel', (req, res) =>
{
  const id = idParam(req, res);
  if (id === null) return;
  res.json(
  {
    ok: true,
    ...cancelTransfer(id, req.user, req.body?.reason)
  });
});

export default router;
