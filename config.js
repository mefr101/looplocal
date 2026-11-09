// Central configuration. Every deploy-specific value comes from an environment
// variable so the same code runs locally, in Docker, or on a hosting platform.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3000,
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || './data/looplocal.db'),
  uploadDir: path.resolve(ROOT_DIR, process.env.UPLOAD_DIR || './uploads'),
  publicDir: path.join(ROOT_DIR, 'public'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
  maxUploadBytes: 5 * 1024 * 1024, // 5 MB per photo
  // Limits repeated sign-in and join-code guesses. Set RATE_LIMIT_DISABLED=1 only for automated tests.
  rateLimitEnabled: process.env.RATE_LIMIT_DISABLED !== '1',
};

if (isProduction && config.sessionSecret === 'dev-only-secret') {
  throw new Error('SESSION_SECRET must be set in production.');
}
