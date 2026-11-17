// Match results API: the Rescue Engine's proposed plan for a request, and submitting it.
//
//   GET  /api/matches                                a short plan summary for each open request the person can see
//   GET  /api/matches/:requestId?substitutes=12,15   the proposed plan (substitutes ticked by id)
//   POST /api/matches/:requestId/submit              { substituteIds: [12, 15], signature }
//        200 { status: 'submitted', ... }            stock reserved, request moves on
//        409 { status: 'changed', plan }             the plan changed since it was shown: nothing was reserved
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
  HttpError
} from '../services/errors.js';
import
{
  buildFulfillmentPlan,
  loadRequestForPlan
} from '../services/matching.js';
import
{
  getRequest,
  listRequestsForUser
} from '../services/requests.js';
import
{
  submitPlan
} from '../services/reservations.js';

const router = Router();
router.use(requireLogin);

function parseId(req, res)
{
  if (!/^\d+$/.test(req.params.requestId))
  {
    res.status(404).json(
    {
      error: 'Request not found.'
    });
    return null;
  }
  return Number(req.params.requestId);
}

/** "12,15" -> [12, 15]; anything that is not a plain positive integer is dropped. */
function parseIds(value)
{
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(parts.map((part) => (typeof part === 'string' && /^\d+$/.test(part.trim()) ? Number(part) : part)).filter(Number.isInteger))];
}

const SUMMARY_LIMIT = 6;

router.get('/', (req, res) =>
{
  const open = listRequestsForUser(req.user).filter((request) => request.status === 'open');
  const matches = open.slice(0, SUMMARY_LIMIT).map((request) =>
  {
    const plan = buildFulfillmentPlan(loadRequestForPlan(request.id, req.user.organizationId));
    return (
      {
        requestId: request.id,
        itemName: request.itemName,
        unitName: request.unitName,
        requested: plan.requested,
        covered: plan.covered,
        shortfall: plan.shortfall,
        complete: plan.complete,
        canSubmit: plan.canSubmit,
        sources: [...new Set(plan.lines.map((line) => line.unitName))],
        substitutesAvailable: plan.suggestions.length,
      }
    );
  });
  res.json(
  {
    matches,
    totalOpen: open.length
  });
});

router.get('/:requestId', (req, res) =>
{
  const id = parseId(req, res);
  if (id === null) return;
  const visible = getRequest(id, req.user); // 404 unless this person may see the request
  if (visible.status !== 'open')
  {
    // Plans exist only while a request is open. Say why instead of showing an old plan.
    return res.json(
    {
      request: visible,
      plan: null
    });
  }
  const plan = buildFulfillmentPlan(loadRequestForPlan(id, req.user.organizationId), parseIds(req.query.substitutes));
  res.json(
  {
    request: visible,
    plan
  });
});

router.post('/:requestId/submit', (req, res) =>
{
  const id = parseId(req, res);
  if (id === null) return;
  if (req.body?.substituteIds !== undefined && !Array.isArray(req.body.substituteIds))
  {
    throw new HttpError(400, 'Send the chosen substitutes as a list.');
  }
  const result = submitPlan(req.user, id,
  {
    substituteIds: parseIds(req.body?.substituteIds ?? []),
    signature: req.body?.signature
  });
  if (result.status === 'changed')
  {
    return res.status(409).json(
    {
      status: 'changed',
      error: 'The available stock changed while you were looking at this plan. Nothing was reserved. Review the updated plan below.',
      plan: result.plan,
    });
  }
  res.json(result);
});

export default router;
