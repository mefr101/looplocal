// Admin API for the signed-in organization admin. Every route requires the org_admin
// role, and every action is limited to the admin's OWN organization.
//
//   Organization   GET /organization, POST /organization/join-code
//   Units          GET /units, POST /units, PUT /units/:id
//   People         GET /members, PUT /members/:id/role, PUT /members/:id/units
//   Requests       GET /requests/pending, POST /requests/:id/approve|reject
//   Listings       GET /listings/pending, POST /listings/:id/approve|reject
//   Analytics      GET /analytics/savings?range=30|90|all
//   Conflicts      GET /conflicts, POST /conflicts/:id/resolve
//   Plans          GET /plans/pending, POST /plans/:id/approve|reject
//
import
{
  Router
} from 'express';
import
{
  requireAdmin
} from '../middleware/auth.js';
import
{
  createUnit,
  getOrganization,
  listMembers,
  listUnits,
  regenerateJoinCode,
  setMemberRole,
  setMemberUnits,
  updateUnit,
} from '../services/organizations.js';
import
{
  ANALYTICS_RANGES,
  getSavingsOverTime
} from '../services/impact.js';
import
{
  listOpenConflicts,
  resolveConflict
} from '../services/conflicts.js';
import
{
  approveListing,
  listPendingListings,
  rejectListing
} from '../services/resources.js';
import
{
  approvePlan,
  listPendingPlans,
  rejectPlan
} from '../services/reservations.js';
import
{
  approveRequest,
  listPendingReview,
  rejectRequest
} from '../services/requests.js';

const router = Router();
router.use(requireAdmin);

/** Ids in URLs must be plain positive integers. */
function idParam(req, res, notFound)
{
  if (/^\d+$/.test(req.params.id)) return Number(req.params.id);
  res.status(404).json(
  {
    error: notFound
  });
  return null;
}

// Organization
router.get('/organization', (req, res) =>
{
  res.json(
  {
    organization: getOrganization(req.user.organizationId)
  });
});

router.post('/organization/join-code', (req, res) =>
{
  res.json(
  {
    joinCode: regenerateJoinCode(req.user)
  });
});

// Units
router.get('/units', (req, res) =>
{
  res.json(
  {
    units: listUnits(req.user.organizationId)
  });
});

router.post('/units', (req, res) =>
{
  res.status(201).json(
  {
    id: createUnit(req.user, req.body)
  });
});

router.put('/units/:id', (req, res) =>
{
  const id = idParam(req, res, 'Unit not found.');
  if (id === null) return;
  updateUnit(req.user, id, req.body);
  res.json(
  {
    ok: true
  });
});

// People
router.get('/members', (req, res) =>
{
  res.json(
  {
    members: listMembers(req.user.organizationId)
  });
});

router.put('/members/:id/role', (req, res) =>
{
  const id = idParam(req, res, 'Person not found.');
  if (id === null) return;
  setMemberRole(req.user, id, req.body?.role);
  res.json(
  {
    ok: true
  });
});

router.put('/members/:id/units', (req, res) =>
{
  const id = idParam(req, res, 'Person not found.');
  if (id === null) return;
  setMemberUnits(req.user, id, req.body?.units);
  res.json(
  {
    ok: true
  });
});

// Requests that need review
router.get('/requests/pending', (req, res) =>
{
  res.json(
  {
    requests: listPendingReview(req.user)
  });
});

router.post('/requests/:id/approve', (req, res) =>
{
  const id = idParam(req, res, 'Request not found.');
  if (id === null) return;
  approveRequest(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

router.post('/requests/:id/reject', (req, res) =>
{
  const id = idParam(req, res, 'Request not found.');
  if (id === null) return;
  rejectRequest(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

// Plans waiting for approval
router.get('/plans/pending', (req, res) =>
{
  res.json(
  {
    plans: listPendingPlans(req.user)
  });
});

router.post('/plans/:id/approve', (req, res) =>
{
  const id = idParam(req, res, 'Plan not found.');
  if (id === null) return;
  approvePlan(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

router.post('/plans/:id/reject', (req, res) =>
{
  const id = idParam(req, res, 'Plan not found.');
  if (id === null) return;
  rejectPlan(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

// Listings waiting for review
router.get('/listings/pending', (req, res) =>
{
  res.json(
  {
    listings: listPendingListings(req.user)
  });
});

router.post('/listings/:id/approve', (req, res) =>
{
  const id = idParam(req, res, 'Listing not found.');
  if (id === null) return;
  approveListing(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

router.post('/listings/:id/reject', (req, res) =>
{
  const id = idParam(req, res, 'Listing not found.');
  if (id === null) return;
  rejectListing(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

// Analytics
router.get('/analytics/savings', (req, res) =>
{
  const range = String(req.query.range ?? '90');
  if (!ANALYTICS_RANGES.includes(range)) return res.status(400).json(
  {
    error: 'Choose 30, 90 or all.'
  });
  res.json(getSavingsOverTime(req.user.organizationId, range));
});

// Conflicts
router.get('/conflicts', (req, res) =>
{
  res.json(
  {
    conflicts: listOpenConflicts(req.user)
  });
});

router.post('/conflicts/:id/resolve', (req, res) =>
{
  const id = idParam(req, res, 'Conflict not found.');
  if (id === null) return;
  resolveConflict(id, req.user, req.body?.note);
  res.json(
  {
    ok: true
  });
});

export default router;
