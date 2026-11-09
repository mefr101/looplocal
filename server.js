// LoopLocal entry point: wires middleware, API routes, and static pages together.
import fs from 'node:fs';
import express from 'express';
import session from 'express-session';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import resourceRoutes from './routes/resources.js';
import requestRoutes from './routes/requests.js';
import matchRoutes from './routes/matches.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// NOTE: the default in-memory session store is fine for local demos but loses
// logins on restart. Swap in a persistent store before a real deployment.
app.use(session({
  name: 'looplocal.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 1000 * 60 * 60 * 8 },
}));

// Health check for hosting platforms.
app.get('/health', (_req, res) => res.json({ ok: true }));

// API routes. Each file in routes/ only handles HTTP; logic lives in services/.
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);

// Unknown API paths return JSON, not an HTML page.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Uploaded photos and the static front end.
app.use('/uploads', express.static(config.uploadDir));
app.use(express.static(config.publicDir, { extensions: ['html'] }));

// Central error handler: never leak stack traces to the browser.
app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : error.message });
});

app.listen(config.port, () => {
  console.log(`LoopLocal running at http://localhost:${config.port}`);
});
