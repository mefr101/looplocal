// Resource Exchange API: browse, search, filter, sort, view details, and publish.
// Everything is limited to the signed-in person's own organization.
//
//   GET  /api/resources/context   what the publish form needs (units with defaults, lists, review rule)
//   GET  /api/resources/mine      listings from the person's units (any status; admins see all)
//   GET  /api/resources           browse approved listings
//   GET  /api/resources/:id       one approved listing
//   POST /api/resources           publish: multipart with a JSON "data" field and an optional "photo" file
import
{
  Router
} from 'express';
import multer from 'multer';
import
{
  db
} from '../database/db.js';
import
{
  requireLogin,
  requirePublisher
} from '../middleware/auth.js';
import
{
  HttpError
} from '../services/errors.js';
import
{
  LIMITS,
  getPublishContext,
  listMyListings,
  publishListing
} from '../services/resources.js';

const router = Router();
router.use(requireLogin);

// Whitelist of sort options. Never put user input straight into ORDER BY.
const SORT_OPTIONS =
{
  newest: 'r.created_at DESC',
  name: 'r.name COLLATE NOCASE ASC',
  quantity: '(r.quantity_total - r.quantity_reserved) DESC',
  value: 'r.replacement_value_cents DESC',
};

const SELECT_LISTING = `
  SELECT r.id, r.name, r.description, r.condition, r.location_note,
         r.quantity_total - r.quantity_reserved AS quantity_available,
         r.replacement_value_cents, r.available_from, r.available_until,
         r.pickup_days, r.pickup_time_start, r.pickup_time_end,
         c.id AS category_id, c.name AS category_name,
         u.id AS unit_id, u.name AS unit_name, l.name AS location_name,
         (SELECT filename FROM resource_images WHERE resource_id = r.id ORDER BY sort_order LIMIT 1) AS image,
         (SELECT tag FROM resource_tags WHERE resource_id = r.id AND kind = 'identity' ORDER BY tag LIMIT 1) AS primary_tag
  FROM resources r
  JOIN categories c ON c.id = r.category_id
  JOIN units u ON u.id = r.unit_id
  JOIN locations l ON l.id = r.location_id`;

// The photo is held in memory, checked by the service, and only then written to disk.
const upload = multer(
  {
    storage: multer.memoryStorage(),
    limits:
    {
      fileSize: LIMITS.maxPhotoBytes,
      files: 1
    }
  })
  .single('photo');

router.get('/mine', (req, res) =>
{
  res.json(
  {
    resources: listMyListings(req.user)
  });
});

router.get('/context', requirePublisher, (req, res) =>
{
  res.json(getPublishContext(req.user));
});

router.post('/', requirePublisher, (req, res, next) =>
{
  upload(req, res, (error) =>
  {
    if (error?.code === 'LIMIT_FILE_SIZE')
    {
      const message = `The photo must be ${LIMITS.maxPhotoBytes / 1024 / 1024} MB or smaller.`;
      return next(new HttpError(400, message,
      {
        photo: message
      }));
    }
    if (error) return next(new HttpError(400, 'The upload could not be read.',
    {
      photo: 'The upload could not be read.'
    }));
    try
    {
      let body;
      try
      {
        body = JSON.parse(req.body?.data ?? '');
      }
      catch
      {
        throw new HttpError(400, 'The form data could not be read.');
      }
      const photo = req.file ?
      {
        buffer: req.file.buffer,
        altText: typeof body?.altText === 'string' ? body.altText : ''
      } : null;
      const listing = publishListing(req.user, body, photo);
      res.status(201).json(
      {
        resource: listing,
        needsReview: listing.status === 'pending_review'
      });
    }
    catch (problem)
    {
      next(problem);
    }
  });
});

router.get('/', (req, res) =>
{
  const
  {
    q = '', category = '', sort = 'newest'
  } = req.query;
  const where = ['r.organization_id = ?', "r.status = 'approved'", '(r.quantity_total - r.quantity_reserved) > 0'];
  const params = [req.user.organizationId];

  if (typeof q === 'string' && q.trim())
  {
    where.push('r.name LIKE ?');
    params.push(`%${q.trim()}%`);
  }
  if (typeof category === 'string' && /^\d+$/.test(category))
  {
    where.push('r.category_id = ?');
    params.push(Number(category));
  }
  const orderBy = SORT_OPTIONS[sort] ?? SORT_OPTIONS.newest;

  const rows = db.prepare(`${SELECT_LISTING} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`).all(...params);
  res.json(
  {
    resources: rows
  });
});

router.get('/:id', (req, res) =>
{
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json(
  {
    error: 'Resource not found.'
  });
  const row = db.prepare(`${SELECT_LISTING} WHERE r.id = ? AND r.organization_id = ? AND r.status = 'approved'`)
    .get(Number(req.params.id), req.user.organizationId);
  if (!row) return res.status(404).json(
  {
    error: 'Resource not found.'
  });
  const images = db.prepare('SELECT filename, alt_text FROM resource_images WHERE resource_id = ? ORDER BY sort_order').all(row.id);
  const tags = db.prepare('SELECT tag, kind FROM resource_tags WHERE resource_id = ?').all(row.id);
  res.json(
  {
    resource:
    {
      ...row,
      images,
      tags
    }
  });
});

export default router;
