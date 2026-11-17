// Add a Resource form: publish a listing with an optional photo.
//
// Layout of this file
//   1. Setup and constants
//   2. Unit defaults and the photo picker
//   3. Reading the form and checking it in the browser
//   4. Showing errors
//   5. Saving
//   6. Start-up
//
// The browser checks are a convenience. The server repeats every check
// (services/resources.js) and its answer is what decides if a listing is saved.
import
{
  api,
  apiUpload
} from './api.js';
import
{
  escapeHtml
} from './layout.js';

// 1. SETUP ---------------------------------------------------------------------

const form = document.getElementById('resource-form');
const errorSummary = document.getElementById('form-errors');
const unitSelect = document.getElementById('unitId');
const photoInput = document.getElementById('photo');

const FIELDS = ['unitId', 'name', 'description', 'categoryId', 'condition', 'quantity', 'replacementValue',
  'substitutesFor', 'photo', 'altText', 'locationId', 'locationNote', 'pickupDays', 'pickupTimeStart',
  'pickupTimeEnd', 'availableFrom', 'availableUntil'
];

// The server names the price field in cents; the form shows dollars.
const SERVER_FIELD =
{
  replacementValueCents: 'replacementValue'
};

// Which element should receive focus when a field has an error.
const FOCUS_TARGET =
{
  pickupDays: 'day-mon'
};

// Names shown in the error summary.
const FIELD_LABELS =
{
  unitId: 'Unit',
  name: 'Item name',
  description: 'Description',
  categoryId: 'Category',
  condition: 'Condition',
  quantity: 'Quantity',
  replacementValue: 'Value of one item',
  substitutesFor: 'Can stand in for',
  photo: 'Photo',
  altText: 'Photo description',
  locationId: 'Where it is kept',
  locationNote: 'Exactly where',
  pickupDays: 'Days',
  pickupTimeStart: 'Earliest time',
  pickupTimeEnd: 'Latest time',
  availableFrom: 'Available from',
  availableUntil: 'Available until',
};

const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let context = null; // what the server says the form needs (see GET /api/resources/context)
let previewUrl = null;

function isoDate(offsetDays)
{
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in the visitor's local calendar
}

const byId = (id) => document.getElementById(id);

// 2. UNIT DEFAULTS AND PHOTO ---------------------------------------------------

/** Start the pickup fields from the chosen unit's usual hand-off settings (set by an admin in Settings). */
function applyUnitDefaults()
{
  const unit = context?.units.find((candidate) => String(candidate.id) === unitSelect.value);
  if (!unit) return;
  for (const box of form.querySelectorAll('input[name="pickupDays"]')) box.checked = unit.pickupDays.includes(box.value);
  byId('pickupTimeStart').value = unit.pickupTimeStart ?? '';
  byId('pickupTimeEnd').value = unit.pickupTimeEnd ?? '';
  if (unit.locationId) byId('locationId').value = String(unit.locationId);
}

function clearPhoto()
{
  photoInput.value = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  byId('photo-preview').hidden = true;
  byId('alt-field').hidden = true;
  byId('altText').value = '';
  byId('photo-preview-img').removeAttribute('src');
}

photoInput.addEventListener('change', () =>
{
  const file = photoInput.files[0];
  byId('photo-error').textContent = '';
  photoInput.removeAttribute('aria-invalid');
  if (!file) return clearPhoto();
  const problem = photoProblem(file);
  if (problem)
  {
    clearPhoto();
    byId('photo-error').textContent = problem;
    photoInput.setAttribute('aria-invalid', 'true');
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  byId('photo-preview-img').src = previewUrl;
  byId('photo-preview').hidden = false;
  byId('alt-field').hidden = false;
});

byId('photo-remove').addEventListener('click', () =>
{
  clearPhoto();
  photoInput.focus();
});

function photoProblem(file)
{
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a PNG, JPG, or WebP image.';
  const limit = context?.limits.maxPhotoBytes ?? 5 * 1024 * 1024;
  if (file.size > limit) return `The photo must be ${limit / 1024 / 1024} MB or smaller.`;
  return null;
}

// 3. READING AND CHECKING THE FORM ---------------------------------------------

function readForm()
{
  const value = (id) => byId(id).value;
  const dollars = value('replacementValue');
  return (
    {
      unitId: value('unitId') ? Number(value('unitId')) : null,
      name: value('name').trim(),
      description: value('description').trim(),
      categoryId: value('categoryId') ? Number(value('categoryId')) : null,
      condition: value('condition'),
      quantity: value('quantity') === '' ? null : Number(value('quantity')),
      // Dollars to whole cents; Math.round avoids 19.99 * 100 = 1998.9999999999998.
      replacementValueCents: dollars === '' ? null : Math.round(Number(dollars) * 100),
      substitutesFor: value('substitutesFor').split(',').map((part) => part.trim()).filter(Boolean),
      altText: value('altText').trim(),
      locationId: value('locationId') ? Number(value('locationId')) : null,
      locationNote: value('locationNote').trim(),
      pickupDays: [...form.querySelectorAll('input[name="pickupDays"]:checked')].map((box) => box.value),
      pickupTimeStart: value('pickupTimeStart') || null,
      pickupTimeEnd: value('pickupTimeEnd') || null,
      availableFrom: value('availableFrom'),
      availableUntil: value('availableUntil'),
    }
  );
}

/** Quick checks for the most common mistakes. Returns { field: message }. */
function checkInBrowser(data, file)
{
  const limits = context.limits;
  const problems =
  {};
  if (!data.unitId) problems.unitId = 'Choose the unit this listing is for.';
  if (data.name.length < limits.name.min) problems.name = `Enter the item name (${limits.name.min} to ${limits.name.max} characters).`;
  if (data.description.length < limits.description.min)
  {
    problems.description = `Describe the item (at least ${limits.description.min} characters).`;
  }
  if (!data.categoryId) problems.categoryId = 'Choose a category.';
  if (!data.condition) problems.condition = 'Choose the condition.';
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > limits.maxQuantity)
  {
    problems.quantity = 'Enter a whole number from 1 to 10,000.';
  }
  if (!Number.isInteger(data.replacementValueCents) || data.replacementValueCents < 0 || data.replacementValueCents > limits.maxValueCents)
  {
    problems.replacementValue = 'Enter the value of one item, from $0 to $100,000.';
  }
  if (data.substitutesFor.length > limits.maxSubstitutes)
  {
    problems.substitutesFor = `List up to ${limits.maxSubstitutes} things this can stand in for.`;
  }
  if (file)
  {
    const problem = photoProblem(file);
    if (problem) problems.photo = problem;
    if (data.altText.length < limits.altText.min)
    {
      problems.altText = `Describe the photo for people who cannot see it (at least ${limits.altText.min} characters).`;
    }
  }
  if (!data.locationId) problems.locationId = 'Choose where the item is kept.';
  if (Boolean(data.pickupTimeStart) !== Boolean(data.pickupTimeEnd))
  {
    problems.pickupTimeStart = 'Enter both an earliest and a latest time, or leave both empty.';
  }
  else if (data.pickupTimeStart && data.pickupTimeStart >= data.pickupTimeEnd)
  {
    problems.pickupTimeEnd = 'The latest time must be after the earliest time.';
  }
  if (!data.availableFrom) problems.availableFrom = 'Choose the first day it can be collected.';
  else if (data.availableFrom < isoDate(0)) problems.availableFrom = 'The date cannot be in the past.';
  if (!data.availableUntil) problems.availableUntil = 'Choose the last day it can be collected.';
  else if (data.availableUntil > isoDate(limits.maxDaysAhead)) problems.availableUntil = 'Choose a date within the next two years.';
  else if (data.availableFrom && data.availableUntil < data.availableFrom) problems.availableUntil = 'This must be on or after the first day.';
  return problems;
}

// 4. SHOWING ERRORS ------------------------------------------------------------

function clearErrors()
{
  errorSummary.hidden = true;
  errorSummary.innerHTML = '';
  for (const field of FIELDS)
  {
    byId(`${field}-error`).textContent = '';
    byId(field)?.removeAttribute('aria-invalid');
  }
}

function showErrors(problems, heading = 'Please fix the following:')
{
  clearErrors();
  const entries = FIELDS.filter((field) => problems[field]).map((field) => [field, problems[field]]);
  for (const [field, message] of entries)
  {
    byId(`${field}-error`).textContent = message;
    byId(field)?.setAttribute('aria-invalid', 'true');
  }
  errorSummary.innerHTML = `${escapeHtml(heading)}<ul>${entries.map(([field, message]) =>
    `<li><a href="#${FOCUS_TARGET[field] ?? field}">${escapeHtml(FIELD_LABELS[field])}</a>: ${escapeHtml(message)}</li>`).join('')}</ul>`;
  errorSummary.hidden = false;
  errorSummary.focus();
}

// Jump to the field when a summary link is used (the default anchor jump doesn't focus it).
errorSummary.addEventListener('click', (event) =>
{
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  const target = byId(link.getAttribute('href').slice(1));
  (target?.matches('input, select, textarea') ? target : target?.querySelector('input'))?.focus();
});

// Live character counter under the description.
{
  const box = byId('description');
  const counter = byId('description-counter');
  const update = () =>
  {
    counter.textContent = `${box.value.length}/${box.maxLength}`;
  };
  box.addEventListener('input', update);
  update();
}

// 5. SAVING --------------------------------------------------------------------

form.addEventListener('submit', async (event) =>
{
  event.preventDefault();
  const data = readForm();
  const file = photoInput.files[0] ?? null;

  const problems = checkInBrowser(data, file);
  if (Object.keys(problems).length) return showErrors(problems);

  const body = new FormData();
  body.append('data', JSON.stringify(data));
  if (file) body.append('photo', file);

  const button = byId('submit-button');
  button.disabled = true;
  try
  {
    const
    {
      resource,
      needsReview
    } = await apiUpload('/resources', body);
    showSuccess(resource.name, needsReview);
  }
  catch (error)
  {
    button.disabled = false;
    const fields = Object.fromEntries(Object.entries(error.fields ??
    {}).map(([key, message]) => [SERVER_FIELD[key] ?? key, message]));
    if (Object.keys(fields).length) showErrors(fields);
    else showErrors(
    {}, error.message); // e.g. "the form data could not be read"
  }
});

function showSuccess(name, needsReview)
{
  clearErrors();
  form.hidden = true;
  byId('review-note').hidden = true;
  byId('success-heading').textContent = needsReview ? 'Sent for review' : 'Listing published';
  byId('success-text').textContent = needsReview ?
    `"${name}" is saved. An admin will review it, and it will appear in Browse once approved.` :
    `"${name}" is now in Browse, so other units can request it.`;
  const panel = byId('success');
  panel.hidden = false;
  panel.focus();
}

// 6. START-UP ------------------------------------------------------------------

async function start()
{
  context = await api('/resources/context');
  byId('org-name').textContent = (await api('/auth/me')).user?.organizationName ?? 'your organization';
  byId('review-note').hidden = !context.reviewRequired;

  const today = isoDate(0);
  for (const id of ['availableFrom', 'availableUntil'])
  {
    byId(id).min = today;
    byId(id).max = isoDate(context.limits.maxDaysAhead);
  }
  byId('availableFrom').value = today;
  byId('availableUntil').value = isoDate(90);

  for (const category of context.categories) byId('categoryId').add(new Option(category.name, category.id));
  for (const location of context.locations) byId('locationId').add(new Option(location.name, location.id));

  // Which units can this person list under? One is preselected; several give a choice.
  if (context.units.length === 0)
  {
    form.querySelectorAll('input, select, textarea, button').forEach((el) =>
    {
      el.disabled = true;
    });
    showErrors(
    {
      unitId: 'You are not part of any unit yet. Ask an organization admin to add you to one.'
    });
    return;
  }
  if (context.units.length > 1) unitSelect.add(new Option('Choose a unit…', ''));
  for (const unit of context.units) unitSelect.add(new Option(unit.name, unit.id));
  unitSelect.addEventListener('change', applyUnitDefaults);
  applyUnitDefaults();
}

start().catch((error) => showErrors(
{}, error.message));
