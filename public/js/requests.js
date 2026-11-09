// Request form: create a new request, or edit an open one (requests.html?edit=ID).
//
// Layout of this file
//   1. Setup and constants
//   2. Type-ahead (combobox) for the item field
//   3. Reading the form and checking it in the browser
//   4. Showing errors
//   5. Saving
//   6. Start-up
//
// The browser checks are a convenience. The server repeats every check
// (services/requests.js) and its answer is what decides if a request is saved.
import { api } from './api.js';
import { escapeHtml } from './layout.js';

// 1. SETUP ---------------------------------------------------------------------

const form = document.getElementById('request-form');
const errorSummary = document.getElementById('form-errors');
const params = new URLSearchParams(window.location.search);
const editId = /^\d+$/.test(params.get('edit') ?? '') ? Number(params.get('edit')) : null;

const FIELDS = ['unitId', 'itemName', 'categoryId', 'quantity', 'intendedUse', 'neededBy', 'fulfillmentMethod',
  'deliverToLocationId', 'pickupDays', 'pickupTimeStart', 'pickupTimeEnd', 'notes', 'acceptsSubstitutes', 'acceptsPartial'];

// Which element should receive focus when a field has an error.
const FOCUS_TARGET = { pickupDays: 'day-mon', fulfillmentMethod: 'fulfillmentMethod' };

// Names shown in the error summary.
const FIELD_LABELS = {
  unitId: 'Unit', itemName: 'What you need', categoryId: 'Category', quantity: 'Quantity',
  intendedUse: 'How you will use it', neededBy: 'Needed by', fulfillmentMethod: 'Pickup or delivery',
  deliverToLocationId: 'Deliver to', pickupDays: 'Days', pickupTimeStart: 'Earliest time',
  pickupTimeEnd: 'Latest time', notes: 'Hand-off notes', acceptsSubstitutes: 'Substitutes', acceptsPartial: 'Partial plan',
};

const itemInput = document.getElementById('itemName');
const itemHint = document.getElementById('itemName-hint');
const categorySelect = document.getElementById('categoryId');
const unitSelect = document.getElementById('unitId');
const deliverField = document.getElementById('deliver-field');
const deliverSelect = document.getElementById('deliverToLocationId');
let chosenTag = ''; // tag picked from the suggestions ('' means derive it from the typed words)

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in the visitor's local calendar
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const method = () => form.elements.fulfillmentMethod.value;

// Delivery needs a destination; pickup doesn't.
function refreshDelivery() {
  const delivery = method() === 'delivery';
  deliverField.hidden = !delivery;
  if (!delivery) deliverSelect.value = '';
}
for (const radio of form.elements.fulfillmentMethod) radio.addEventListener('change', refreshDelivery);

// 2. TYPE-AHEAD ----------------------------------------------------------------
// Follows the ARIA "combobox with listbox popup" pattern so keyboard and
// screen-reader users get the same suggestions: Up/Down to move, Enter to pick,
// Escape to close.

const list = document.getElementById('item-suggestions');
let options = [];
let activeIndex = -1;
let searchTimer;
let searchCounter = 0; // lets us ignore answers that arrive out of order

function setOpen(open) {
  list.hidden = !open;
  itemInput.setAttribute('aria-expanded', String(open));
  if (!open) { activeIndex = -1; itemInput.removeAttribute('aria-activedescendant'); }
}

function renderOptions() {
  list.innerHTML = options.map((option, index) => `
    <li class="combobox__option" role="option" id="item-option-${index}" data-index="${index}"
        aria-selected="${index === activeIndex}">
      <span>${escapeHtml(capitalize(option.label))}</span>
      <span class="combobox__meta">${option.available} available &middot; ${escapeHtml(option.categoryName)}</span>
    </li>`).join('');
  setOpen(options.length > 0);
}

function highlight(index) {
  activeIndex = index;
  for (const li of list.children) li.setAttribute('aria-selected', String(Number(li.dataset.index) === index));
  if (index >= 0) itemInput.setAttribute('aria-activedescendant', `item-option-${index}`);
  else itemInput.removeAttribute('aria-activedescendant');
  list.children[index]?.scrollIntoView({ block: 'nearest' });
}

function choose(index) {
  const option = options[index];
  if (!option) return;
  itemInput.value = capitalize(option.label);
  chosenTag = option.tag;
  categorySelect.value = String(option.categoryId);
  itemHint.textContent = `${option.available} available from other units right now.`;
  setOpen(false);
}

async function search() {
  const ticket = ++searchCounter;
  const query = itemInput.value.trim();
  const unit = unitSelect.value ? `&unitId=${encodeURIComponent(unitSelect.value)}` : '';
  try {
    const { suggestions } = await api(`/requests/suggestions?q=${encodeURIComponent(query)}${unit}`);
    if (ticket !== searchCounter) return; // a newer search is already running
    options = suggestions;
    activeIndex = -1;
    // A slow answer must not pop the list open after the person has moved on to another field.
    if (document.activeElement === itemInput) renderOptions(); else setOpen(false);
    if (query && options.length === 0) {
      itemHint.textContent = 'Nothing listed matches yet. You can still submit this request as typed.';
    } else if (!chosenTag) {
      itemHint.textContent = 'Pick a suggestion to see how many are available, or keep typing to describe something new.';
    }
  } catch {
    setOpen(false); // suggestions are optional; the form still works without them
  }
}

itemInput.addEventListener('input', () => {
  chosenTag = '';                // typing again means the earlier pick no longer applies
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 200);
});
itemInput.addEventListener('focus', () => { if (!itemInput.value.trim()) search(); });
itemInput.addEventListener('blur', () => setTimeout(() => setOpen(false), 150));
itemInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (list.hidden && options.length) setOpen(true);
    highlight(Math.min(activeIndex + 1, options.length - 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlight(Math.max(activeIndex - 1, 0));
  } else if (event.key === 'Enter' && !list.hidden && activeIndex >= 0) {
    event.preventDefault();      // pick the suggestion instead of submitting the form
    choose(activeIndex);
  } else if (event.key === 'Escape' && !list.hidden) {
    event.preventDefault();
    setOpen(false);
  }
});
// mousedown (not click) so the choice happens before the input loses focus.
list.addEventListener('mousedown', (event) => {
  const li = event.target.closest('[data-index]');
  if (li) { event.preventDefault(); choose(Number(li.dataset.index)); }
});

// 3. READING AND CHECKING THE FORM ---------------------------------------------

function readForm() {
  const value = (id) => document.getElementById(id).value;
  return {
    unitId: value('unitId') ? Number(value('unitId')) : null,
    itemName: value('itemName').trim(),
    needTag: chosenTag || undefined,
    categoryId: value('categoryId') ? Number(value('categoryId')) : null,
    quantity: value('quantity') === '' ? null : Number(value('quantity')),
    intendedUse: value('intendedUse').trim(),
    neededBy: value('neededBy'),
    fulfillmentMethod: method(),
    deliverToLocationId: method() === 'delivery' && value('deliverToLocationId') ? Number(value('deliverToLocationId')) : null,
    pickupDays: [...form.querySelectorAll('input[name="pickupDays"]:checked')].map((box) => box.value),
    pickupTimeStart: value('pickupTimeStart') || null,
    pickupTimeEnd: value('pickupTimeEnd') || null,
    notes: value('notes').trim(),
    acceptsSubstitutes: document.getElementById('acceptsSubstitutes').checked,
    acceptsPartial: document.getElementById('acceptsPartial').checked,
  };
}

/** Quick checks for the most common mistakes. Returns { field: message }. */
function checkInBrowser(data) {
  const problems = {};
  if (!data.unitId) problems.unitId = 'Choose the unit this request is for.';
  if (!data.itemName) problems.itemName = 'Enter the item you need.';
  if (!data.categoryId) problems.categoryId = 'Choose a category.';
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 10000) {
    problems.quantity = 'Enter a whole number from 1 to 10,000.';
  }
  if (data.intendedUse.length < 5) problems.intendedUse = 'Describe how you will use it (at least 5 characters).';
  if (!data.neededBy) problems.neededBy = 'Choose the date you need it by.';
  else if (data.neededBy < isoDate(0)) problems.neededBy = 'The date cannot be in the past.';
  else if (data.neededBy > isoDate(365)) problems.neededBy = 'Choose a date within the next year.';
  if (data.fulfillmentMethod === 'delivery' && !data.deliverToLocationId) {
    problems.deliverToLocationId = 'Choose where it should be delivered.';
  }
  if (Boolean(data.pickupTimeStart) !== Boolean(data.pickupTimeEnd)) {
    problems.pickupTimeStart = 'Enter both an earliest and a latest time, or leave both empty.';
  } else if (data.pickupTimeStart && data.pickupTimeStart >= data.pickupTimeEnd) {
    problems.pickupTimeEnd = 'The latest time must be after the earliest time.';
  }
  return problems;
}

// 4. SHOWING ERRORS ------------------------------------------------------------

function clearErrors() {
  errorSummary.hidden = true;
  errorSummary.innerHTML = '';
  for (const field of FIELDS) {
    document.getElementById(`${field}-error`).textContent = '';
    document.getElementById(field)?.removeAttribute('aria-invalid');
  }
}

function showErrors(problems, heading = 'Please fix the following:') {
  clearErrors();
  const entries = FIELDS.filter((field) => problems[field]).map((field) => [field, problems[field]]);
  for (const [field, message] of entries) {
    document.getElementById(`${field}-error`).textContent = message;
    document.getElementById(field)?.setAttribute('aria-invalid', 'true');
  }
  errorSummary.innerHTML = `${escapeHtml(heading)}<ul>${entries.map(([field, message]) =>
    `<li><a href="#${FOCUS_TARGET[field] ?? field}">${escapeHtml(FIELD_LABELS[field])}</a>: ${escapeHtml(message)}</li>`).join('')}</ul>`;
  errorSummary.hidden = false;
  errorSummary.focus();
}

// Jump to the field when a summary link is used (the default anchor jump doesn't focus it).
errorSummary.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  const target = document.getElementById(link.getAttribute('href').slice(1));
  (target?.matches('input, select, textarea') ? target : target?.querySelector('input'))?.focus();
});

// Live character counters under the long text boxes.
for (const id of ['intendedUse', 'notes']) {
  const box = document.getElementById(id);
  const counter = document.getElementById(`${id}-counter`);
  const update = () => { counter.textContent = `${box.value.length}/${box.maxLength}`; };
  box.addEventListener('input', update);
  update();
}

// 5. SAVING --------------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = readForm();

  const problems = checkInBrowser(data);
  if (Object.keys(problems).length) return showErrors(problems);

  const button = document.getElementById('submit-button');
  button.disabled = true;
  try {
    if (editId) {
      await api(`/requests/${editId}`, { method: 'PUT', body: data });
      window.location.href = 'matches.html?updated=1';
    } else {
      const { request } = await api('/requests', { method: 'POST', body: data });
      window.location.href = `matches.html?submitted=${request.status}`;
    }
  } catch (error) {
    button.disabled = false;
    if (Object.keys(error.fields ?? {}).length) showErrors(error.fields);
    else showErrors({}, error.message); // e.g. "no longer editable"
  }
});

// 6. START-UP ------------------------------------------------------------------

function fillForm(request) {
  unitSelect.value = String(request.unitId);
  itemInput.value = request.itemName;
  chosenTag = request.needTag;
  categorySelect.value = String(request.categoryId);
  document.getElementById('quantity').value = request.quantity;
  document.getElementById('intendedUse').value = request.intendedUse;
  document.getElementById('neededBy').value = request.neededBy;
  form.elements.fulfillmentMethod.value = request.fulfillmentMethod;
  deliverSelect.value = request.deliverToLocationId ? String(request.deliverToLocationId) : '';
  for (const box of form.querySelectorAll('input[name="pickupDays"]')) box.checked = request.pickupDays.includes(box.value);
  document.getElementById('pickupTimeStart').value = request.pickupTimeStart ?? '';
  document.getElementById('pickupTimeEnd').value = request.pickupTimeEnd ?? '';
  document.getElementById('notes').value = request.notes;
  document.getElementById('acceptsSubstitutes').checked = request.acceptsSubstitutes;
  document.getElementById('acceptsPartial').checked = request.acceptsPartial;
  for (const id of ['intendedUse', 'notes']) document.getElementById(id).dispatchEvent(new Event('input'));
  refreshDelivery();
}

/** "Request this" links on the Resources page arrive with ?item=...&tag=...&category=... */
function prefillFromLink() {
  const item = params.get('item');
  if (item) itemInput.value = item.slice(0, 100);
  if (params.get('tag')) chosenTag = params.get('tag').slice(0, 60);
  if (/^\d+$/.test(params.get('category') ?? '')) categorySelect.value = params.get('category');
}

async function start() {
  // Allowed dates: today through one year from now.
  const dateInput = document.getElementById('neededBy');
  dateInput.min = isoDate(0);
  dateInput.max = isoDate(365);

  const [{ categories }, context] = await Promise.all([api('/meta/categories'), api('/requests/context')]);
  for (const category of categories) categorySelect.add(new Option(category.name, category.id));
  for (const location of context.locations) deliverSelect.add(new Option(location.name, location.id));
  document.getElementById('org-name').textContent = context.organizationName;

  // Which units can this person ask for? One unit is preselected; several give a choice.
  if (context.units.length === 0) {
    form.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
    showErrors({ unitId: 'You are not part of any unit yet. Ask an organization admin to add you to one.' });
    return;
  }
  if (context.units.length > 1) unitSelect.add(new Option('Choose a unit…', ''));
  for (const unit of context.units) unitSelect.add(new Option(unit.name, unit.id));
  // Changing the unit changes which listings count as "other units" in the suggestions.
  unitSelect.addEventListener('change', () => { if (document.activeElement === itemInput) search(); });

  if (editId) {
    document.getElementById('page-heading').textContent = 'Edit request';
    document.title = 'Edit request | LoopLocal';
    document.getElementById('submit-button').textContent = 'Save changes';
    try {
      const { request } = await api(`/requests/${editId}`);
      if (!request.canEdit) {
        form.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
        showErrors({}, request.status === 'pending_approval' || request.status === 'approved'
          ? 'A plan has been submitted for this request, so it can no longer be edited. You can cancel it from the Matches page.'
          : 'You cannot edit this request.');
        return;
      }
      fillForm(request);
    } catch (error) {
      form.hidden = true;
      showErrors({}, error.message);
    }
  } else {
    prefillFromLink();
    document.getElementById('review-note').hidden = !context.reviewRequired;
  }
}

start().catch((error) => showErrors({}, error.message));
