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

/** 24-hour time like "15:30". */
export function isTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Today's date (server's local calendar day) as YYYY-MM-DD, offset by a number of days. */
export function isoDateFromToday(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
