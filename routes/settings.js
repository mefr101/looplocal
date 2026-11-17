// Organization settings API. Admins only; every action stays inside the admin's own organization.
//
//   GET    /                      everything the settings page shows
//   PUT    /branding              { name, brandColor }
//   POST   /logo                  multipart field "logo" (PNG/JPG/WebP, up to 1 MB)
//   DELETE /logo
//   PUT    /approvals             { reviewRequests, planApprovalMode, planApprovalThresholdCents }
//   POST   /categories            { name }       PUT/DELETE /categories/:id
//   POST   /locations             { name }       PUT/DELETE /locations/:id
//   PUT    /units/:id/defaults    { pickupDays, pickupStart, pickupEnd, locationId }
import
{
  Router
} from 'express';
import multer from 'multer';
import
{
  requireAdmin
} from '../middleware/auth.js';
import
{
  HttpError
} from '../services/errors.js';
import
{
  LIMITS,
  addCategory,
  addLocation,
  deleteCategory,
  deleteLocation,
  getSettings,
  removeLogo,
  renameCategory,
  renameLocation,
  setLogo,
  updateApprovalRules,
  updateBranding,
  updateUnitDefaults,
} from '../services/settings.js';

const router = Router();
router.use(requireAdmin);

// The logo is held in memory, checked, and only then written to disk by the service.
const upload = multer(
  {
    storage: multer.memoryStorage(),
    limits:
    {
      fileSize: LIMITS.maxLogoBytes,
      files: 1
    }
  })
  .single('logo');

function idParam(req, res, notFound)
{
  if (/^\d+$/.test(req.params.id)) return Number(req.params.id);
  res.status(404).json(
  {
    error: notFound
  });
  return null;
}

router.get('/', (req, res) =>
{
  res.json(getSettings(req.user.organizationId));
});

// Branding
router.put('/branding', (req, res) =>
{
  updateBranding(req.user, req.body);
  res.json(
  {
    ok: true
  });
});

router.post('/logo', (req, res, next) =>
{
  upload(req, res, (error) =>
  {
    if (error?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'The logo must be 1 MB or smaller.',
    {
      logo: 'The logo must be 1 MB or smaller.'
    }));
    if (error) return next(new HttpError(400, 'The upload could not be read.',
    {
      logo: 'The upload could not be read.'
    }));
    try
    {
      res.json(
      {
        logoFilename: setLogo(req.user, req.file?.buffer)
      });
    }
    catch (problem)
    {
      next(problem);
    }
  });
});

router.delete('/logo', (req, res) =>
{
  removeLogo(req.user);
  res.json(
  {
    ok: true
  });
});

// Approval rules
router.put('/approvals', (req, res) =>
{
  updateApprovalRules(req.user, req.body);
  res.json(
  {
    ok: true
  });
});

// Categories and locations
const lists = [
{
  path: 'categories',
  add: addCategory,
  rename: renameCategory,
  remove: deleteCategory,
  notFound: 'Category not found.'
},
{
  path: 'locations',
  add: addLocation,
  rename: renameLocation,
  remove: deleteLocation,
  notFound: 'Location not found.'
}, ];

for (const list of lists)
{
  router.post(`/${list.path}`, (req, res) =>
  {
    res.status(201).json(
    {
      id: list.add(req.user, req.body)
    });
  });
  router.put(`/${list.path}/:id`, (req, res) =>
  {
    const id = idParam(req, res, list.notFound);
    if (id === null) return;
    list.rename(req.user, id, req.body);
    res.json(
    {
      ok: true
    });
  });
  router.delete(`/${list.path}/:id`, (req, res) =>
  {
    const id = idParam(req, res, list.notFound);
    if (id === null) return;
    list.remove(req.user, id);
    res.json(
    {
      ok: true
    });
  });
}

// Unit pickup defaults
router.put('/units/:id/defaults', (req, res) =>
{
  const id = idParam(req, res, 'Unit not found.');
  if (id === null) return;
  updateUnitDefaults(req.user, id, req.body);
  res.json(
  {
    ok: true
  });
});

export default router;
