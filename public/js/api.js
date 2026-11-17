// Thin wrapper around fetch() so every page talks to the server the same way.

/** Read a response as JSON; throw an Error (with .status and .fields) if the server reports a problem. */
async function parse(response)
{
  const data = await response.json().catch(() => (
  {}));
  if (!response.ok)
  {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.fields = data.fields ||
    {};
    error.data = data; // the whole error body, for answers that carry more than a message (e.g. a changed plan)
    throw error;
  }
  return data;
}

/**
 * Call the API and return parsed JSON.
 * Throws an Error (with .status, .fields and .data) if the server reports a problem.
 */
export async function api(path,
{
  method = 'GET',
  body
} =
{})
{
  return parse(await fetch(`/api${path}`,
  {
    method,
    headers: body ?
    {
      'Content-Type': 'application/json'
    } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  }));
}

/** POST a FormData (for file uploads). The browser sets the multipart headers itself. */
export async function apiUpload(path, formData)
{
  return parse(await fetch(`/api${path}`,
  {
    method: 'POST',
    body: formData,
    credentials: 'same-origin'
  }));
}

/** Format integer cents as dollars, e.g. 4500 -> "$45.00". */
export function formatMoney(cents)
{
  return new Intl.NumberFormat('en-US',
  {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100);
}
