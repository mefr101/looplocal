// Thin wrapper around fetch() so every page talks to the server the same way.

/**
 * Call the API and return parsed JSON.
 * Throws an Error (with .status and .fields) if the server reports a problem.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.fields = data.fields || {};
    throw error;
  }
  return data;
}

/** Format integer cents as dollars, e.g. 4500 -> "$45.00". */
export function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
