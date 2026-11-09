// Resource Exchange API: browse, search, filter, sort, and view details.
// TODO: POST / (publish a resource with photo upload + validation).
import { Router } from 'express';
import { db } from '../database/db.js';

const router = Router();

// Whitelist of sort options. Never put user input straight into ORDER BY.
const SORT_OPTIONS = {
  newest: 'r.created_at DESC',
  name: 'r.name COLLATE NOCASE ASC',
  quantity: '(r.quantity_total - r.quantity_reserved) DESC',
  value: 'r.replacement_value_cents DESC',
};

const SELECT_LISTING = `
  SELECT r.id, r.name, r.description, r.condition, r.location,
         r.quantity_total - r.quantity_reserved AS quantity_available,
         r.replacement_value_cents, r.available_from, r.available_until,
         c.id AS category_id, c.name AS category_name, o.name AS organization_name,
         (SELECT filename FROM resource_images WHERE resource_id = r.id ORDER BY sort_order LIMIT 1) AS image
  FROM resources r
  JOIN categories c ON c.id = r.category_id
  JOIN organizations o ON o.id = r.organization_id`;

router.get('/', (req, res) => {
  const { q = '', category = '', sort = 'newest' } = req.query;
  const where = ["r.status = 'approved'", '(r.quantity_total - r.quantity_reserved) > 0'];
  const params = [];

  if (typeof q === 'string' && q.trim()) {
    where.push('r.name LIKE ?');
    params.push(`%${q.trim()}%`);
  }
  if (typeof category === 'string' && /^\d+$/.test(category)) {
    where.push('r.category_id = ?');
    params.push(Number(category));
  }
  const orderBy = SORT_OPTIONS[sort] ?? SORT_OPTIONS.newest;

  const rows = db.prepare(`${SELECT_LISTING} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`).all(...params);
  res.json({ resources: rows });
});

router.get('/:id', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Resource not found.' });
  const row = db.prepare(`${SELECT_LISTING} WHERE r.id = ? AND r.status = 'approved'`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Resource not found.' });
  const images = db.prepare('SELECT filename, alt_text FROM resource_images WHERE resource_id = ? ORDER BY sort_order').all(row.id);
  const tags = db.prepare('SELECT tag, kind FROM resource_tags WHERE resource_id = ?').all(row.id);
  res.json({ resource: { ...row, images, tags } });
});

export default router;
