// Matches page: the signed-in organization's requests, with edit and cancel.
// layout.js already sends signed-out visitors to the sign-in page (body data-requires).
// TODO: show each open request's proposed plan here once the Rescue Engine exists,
//       and fill in "My listings" once publishing is built.
import { api } from './api.js';
import { escapeHtml } from './layout.js';

const container = document.getElementById('my-requests');
const banner = document.getElementById('banner');

// Wording and color for each request status.
const STATUS = {
  pending_review: { label: 'Awaiting review', badge: 'badge--warning',
    message: 'An admin in your organization reviews requests before matching starts.' },
  rejected: { label: 'Not approved', badge: 'badge--danger', message: '' },
  open: { label: 'Open', badge: 'badge--info',
    message: 'Ready for matching. Proposed plans will appear here once the Rescue Engine is connected.' },
  pending_approval: { label: 'Plan awaiting approval', badge: 'badge--warning',
    message: 'A fulfillment plan was submitted and is waiting for an administrator.' },
  approved: { label: 'Approved', badge: 'badge--success', message: 'Your plan is approved. Arrange the pickups.' },
  fulfilled: { label: 'Fulfilled', badge: 'badge--success', message: '' },
  cancelled: { label: 'Cancelled', badge: '', message: '' },
};

const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** "2026-11-23" -> "Nov 23, 2026" (built from parts so time zones can't shift the day). */
function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "15:30" -> "3:30 PM" */
function formatTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function handoffSummary(request) {
  const how = request.fulfillmentMethod === 'delivery'
    ? `Delivery to ${request.deliverToLocationName}` : 'Pickup';
  return `${how}: ${availabilitySummary(request)}`;
}

function availabilitySummary(request) {
  const days = request.pickupDays.length ? request.pickupDays.map((d) => DAY_NAMES[d]).join(', ') : 'Any day';
  const times = request.pickupTimeStart
    ? `${formatTime(request.pickupTimeStart)} to ${formatTime(request.pickupTimeEnd)}` : 'any time';
  return `${days}, ${times}`;
}

function flexibility(request) {
  const parts = [request.acceptsSubstitutes ? 'similar items OK' : 'exact item only'];
  if (request.acceptsPartial) parts.push('partial OK');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderRequest(request) {
  const status = STATUS[request.status] ?? { label: request.status, badge: '', message: '' };
  const message = request.status === 'rejected'
    ? `Not approved: ${request.reviewNote ?? 'no reason given.'} You can submit a new request with changes.`
    : status.message;
  const edit = request.canEdit
    ? `<a class="button button--secondary" href="requests.html?edit=${request.id}">Edit</a>` : '';
  const cancel = request.canCancel
    ? `<button class="button button--secondary" type="button" data-cancel="${request.id}"
         data-status="${request.status}" data-name="${escapeHtml(request.itemName)}">Cancel request</button>` : '';

  return `
    <li class="card request-card">
      <div class="request-card__header">
        <h3>${escapeHtml(request.itemName)}</h3>
        <span class="badge ${status.badge}">${status.label}</span>
      </div>
      <dl class="request-card__facts">
        <div><dt>Quantity</dt><dd class="mono">${request.quantity.toLocaleString('en-US')}</dd></div>
        <div><dt>Needed by</dt><dd>${formatDate(request.neededBy)}</dd></div>
        <div><dt>Unit</dt><dd>${escapeHtml(request.unitName)}</dd></div>
        <div><dt>Category</dt><dd>${escapeHtml(request.categoryName)}</dd></div>
        <div><dt>Flexibility</dt><dd>${escapeHtml(flexibility(request))}</dd></div>
        <div><dt>Hand-off</dt><dd>${escapeHtml(handoffSummary(request))}</dd></div>
        <div><dt>Requested by</dt><dd>${escapeHtml(request.requesterName)}</dd></div>
      </dl>
      ${message ? `<p class="request-card__message">${escapeHtml(message)}</p>` : ''}
      ${edit || cancel ? `<div class="request-card__actions">${edit}${cancel}</div>` : ''}
    </li>`;
}

async function loadRequests() {
  try {
    const { requests } = await api('/requests/mine');
    container.innerHTML = requests.length
      ? `<ul class="request-list">${requests.map(renderRequest).join('')}</ul>`
      : '<div class="placeholder-note">No requests yet. Use "New request" to ask for something your organization needs.</div>';
  } catch (error) {
    container.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

function showBanner(text, isError = false) {
  banner.textContent = text;
  banner.className = `alert ${isError ? 'alert--error' : 'alert--success'}`;
  banner.hidden = false;
}

// Cancel buttons (one listener for the whole list).
container.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-cancel]');
  if (!button) return;

  const warning = button.dataset.status === 'pending_approval'
    ? ' The items reserved for your submitted plan will be released.' : '';
  if (!window.confirm(`Cancel your request for "${button.dataset.name}"?${warning}`)) return;

  button.disabled = true;
  try {
    await api(`/requests/${button.dataset.cancel}/cancel`, { method: 'POST' });
    showBanner('Request cancelled.');
    await loadRequests();
  } catch (error) {
    showBanner(error.message, true);
    button.disabled = false;
  }
});

// Confirmation messages sent here by the request form (?submitted=open|pending_review, ?updated=1).
const params = new URLSearchParams(window.location.search);
if (params.get('submitted') === 'pending_review') {
  showBanner('Request submitted. An admin in your organization will review it before matching starts.');
} else if (params.get('submitted')) {
  showBanner('Request submitted. It is open for matching.');
} else if (params.has('updated')) {
  showBanner('Changes saved.');
}
if (params.size) window.history.replaceState(null, '', window.location.pathname); // so a reload doesn't repeat the message

loadRequests();
