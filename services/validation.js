// Small, reusable input checks. Every form is validated here on the server
// (the browser also validates, but the browser is never trusted).

/** Collects field errors so the API can return all of them at once. */
export class FieldErrors {
  constructor() { this.errors = {}; }
  add(field, message) { if (!this.errors[field]) this.errors[field] = message; }
  get hasAny() { return Object.keys(this.errors).length > 0; }
}

export function isNonEmptyString(value, { min = 1, max = 500 } = {}) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

export function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
