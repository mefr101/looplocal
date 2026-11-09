// Small in-memory rate limiters. They slow down guessing of passwords and join codes.
// (In-memory means the counts reset when the server restarts, which is fine for this purpose.)
//
// Why two kinds:
//   * rateLimit      counts every request. Good for rarely-used actions like creating an organization.
//   * FailureLimiter counts only FAILED attempts. Good for sign-in and join codes: a whole class at a
//                    school shares one IP address, so correct sign-ins must never use up the allowance.
import { config } from '../config.js';

/** Remember recent timestamps per key and forget old ones. */
class Window {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
    const sweeper = setInterval(() => {
      for (const key of this.hits.keys()) this.recent(key);
    }, windowMs);
    sweeper.unref(); // don't keep the process alive just for this timer
  }

  recent(key) {
    const cutoff = Date.now() - this.windowMs;
    const times = (this.hits.get(key) ?? []).filter((time) => time > cutoff);
    if (times.length) this.hits.set(key, times); else this.hits.delete(key);
    return times;
  }

  add(key) { this.hits.set(key, [...this.recent(key), Date.now()]); }
  count(key) { return this.recent(key).length; }
  clear(key) { this.hits.delete(key); }
}

const tooMany = (res, windowMs, message) => {
  res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
  return res.status(429).json({ error: message });
};

const DEFAULT_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.';

/** At most `max` requests per `windowMs` from one IP address. */
export function rateLimit({ windowMs, max, message = DEFAULT_MESSAGE }) {
  const window = new Window(windowMs);
  return (req, res, next) => {
    if (!config.rateLimitEnabled) return next();
    if (window.count(req.ip) >= max) return tooMany(res, windowMs, message);
    window.add(req.ip);
    next();
  };
}

/**
 * Blocks a key once it has `max` failures inside the window. Call `isBlocked` before
 * checking credentials, `fail` after a wrong guess, and `succeed` after a correct one.
 */
export class FailureLimiter {
  constructor({ windowMs, max, message = DEFAULT_MESSAGE }) {
    this.window = new Window(windowMs);
    this.windowMs = windowMs;
    this.max = max;
    this.message = message;
  }

  isBlocked(key) { return config.rateLimitEnabled && this.window.count(key) >= this.max; }
  fail(key) { this.window.add(key); }
  succeed(key) { this.window.clear(key); }

  /** Send the 429 reply. */
  reject(res) { return tooMany(res, this.windowMs, this.message); }
}
