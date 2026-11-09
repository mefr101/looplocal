// Lookup lists used by forms and filters (categories, organizations).
import { Router } from 'express';
import { db } from '../database/db.js';

const router = Router();

router.get('/categories', (_req, res) => {
  res.json({ categories: db.prepare('SELECT id, name FROM categories ORDER BY name').all() });
});

router.get('/organizations', (_req, res) => {
  res.json({ organizations: db.prepare('SELECT id, name, type FROM organizations ORDER BY name').all() });
});

export default router;
