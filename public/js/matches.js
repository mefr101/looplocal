// Matches page: the signed-in organization's requests, with edit and cancel.
// layout.js already sends signed-out visitors to the sign-in page (body data-requires).
//
// Open requests can show the Rescue Engine's proposed plan (GET /api/matches/:id). The requester can tick
// substitutes to cover a shortfall and submit the plan (POST /api/matches/:id/submit). The server recomputes
// the plan on submit; if it changed, nothing is reserved and the updated plan is shown to confirm.
import
{
  api
} from './api.js';
import
{
  escapeHtml
} from './layout.js';
import
{
  confirmDialog,
  promptDialog
} from './dialog.js';

const container = document.getElementById('my-requests');
const banner = document.getElementById('banner');

// Wording and color for each request status.
const STATUS =
{
  pending_review:
  {
    label: 'Awaiting review',
    badge: 'badge--warning',
    message: 'An admin in your organization reviews requests before matching starts.'
  },
  rejected:
  {
    label: 'Not approved',
    badge: 'badge--danger',
    message: ''
  },
  open:
  {
    label: 'Open',
    badge: 'badge--info',
    message: 'Ready for matching. Open the proposed plan to review it and submit it.'
  },
  pending_approval:
  {
    label: 'Plan awaiting approval',
    badge: 'badge--warning',
    message: 'A fulfillment plan was submitted and is waiting for an administrator.'
  },
  approved:
  {
    label: 'Approved',
    badge: 'badge--success',
    message: 'Your plan is approved. Arrange the pickups.'
  },
  fulfilled:
  {
    label: 'Fulfilled',
    badge: 'badge--success',
    message: ''
  },
  cancelled:
  {
    label: 'Cancelled',
    badge: '',
    message: ''
  },
};

const DAY_NAMES =
{
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};

/** "2026-11-23" -> "Nov 23, 2026" (built from parts so time zones can't shift the day). */
function formatDate(iso)
{
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US',
  {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/** "15:30" -> "3:30 PM" */
function formatTime(time)
{
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US',
  {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function handoffSummary(request)
{
  const how = request.fulfillmentMethod === 'delivery' ?
    `Delivery to ${request.deliverToLocationName}` : 'Pickup';
  return `${how}: ${availabilitySummary(request)}`;
}

function availabilitySummary(request)
{
  const days = request.pickupDays.length ? request.pickupDays.map((d) => DAY_NAMES[d]).join(', ') : 'Any day';
  const times = request.pickupTimeStart ?
    `${formatTime(request.pickupTimeStart)} to ${formatTime(request.pickupTimeEnd)}` : 'any time';
  return `${days}, ${times}`;
}

function flexibility(request)
{
  const parts = [request.acceptsSubstitutes ? 'similar items OK' : 'exact item only'];
  if (request.acceptsPartial) parts.push('partial OK');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderRequest(request)
{
  const status = STATUS[request.status] ??
  {
    label: request.status,
    badge: '',
    message: ''
  };
  const message = request.status === 'rejected' ?
    `Not approved: ${request.reviewNote ?? 'no reason given.'} You can submit a new request with changes.` :
    status.message;
  const edit = request.canEdit ?
    `<a class="button button--secondary" href="requests.html?edit=${request.id}">Edit</a>` : '';
  const planButton = request.status === 'open' ?
    `<button class="button" type="button" data-plan="${request.id}" aria-expanded="false" aria-controls="plan-${request.id}">View proposed plan</button>` : '';
  const cancel = request.canCancel ?
    `<button class="button button--secondary" type="button" data-cancel="${request.id}"
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
      ${planButton || edit || cancel ? `<div class="request-card__actions">${planButton}${edit}${cancel}</div>` : ''}
      <div class="plan" id="plan-${request.id}" data-can-submit="${request.canEdit}" aria-live="polite" hidden></div>
    </li>`;
}

async function loadRequests()
{
  try
  {
    const
    {
      requests
    } = await api('/requests/mine');
    container.innerHTML = requests.length ?
      `<ul class="request-list">${requests.map(renderRequest).join('')}</ul>` :
      '<div class="placeholder-note">No requests yet. Use "New request" to ask for something your organization needs.</div>';
  }
  catch (error)
  {
    container.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

// Proposed plans
const CONDITION =
{
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  worn: 'Worn'
};
const plans = new Map(); // request id -> { selected: Set of substitute listing ids, plan }

function renderPlan(panel, requestId, plan, notice = '')
{
  const state = plans.get(requestId);
  const canSubmit = panel.dataset.canSubmit === 'true';
  const summary = plan.complete ?
    `This plan covers all ${plan.requested.toLocaleString('en-US')} you asked for.` :
    `This plan covers ${plan.covered.toLocaleString('en-US')} of ${plan.requested.toLocaleString('en-US')}.`;

  const lines = plan.lines.length ? `
    <div class="table-scroll">
      <table class="table">
        <caption class="visually-hidden">Proposed plan for this request</caption>
        <thead>
  <tr>
  <th scope="col">From</th>
  <th scope="col">Qty</th>
  <th scope="col">Why this one</th>
  <th scope="col">Hand-off</th>
  </tr>
  </thead>
        <tbody>${plan.lines.map((line) => `
          <tr>
            <th scope="row">${escapeHtml(line.unitName)}<span class="plan__sub">${escapeHtml(line.name)}</span></th>
            <td class="mono">${line.quantity.toLocaleString('en-US')}</td>
            <td>${escapeHtml(line.reason)}</td>
            <td>${escapeHtml(line.handoff.summary)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
          <th scope="row">Total</th>
          <td class="mono">${plan.covered.toLocaleString('en-US')} of ${plan.requested.toLocaleString('en-US')}</td>
        <td colspan="2">${plan.complete ? 'Request fully covered' : `${plan.shortfall.toLocaleString('en-US')} still needed`}</td>
        </tr>
        </tfoot>
      </table>
    </div>` : '';

  const suggestions = plan.suggestions.length ? `
    <fieldset class="form-fieldset plan__subs">
      <legend>Substitutes that could cover the shortfall</legend>
      <p class="form-field__hint">These are not the exact item. Tick the ones you are happy to use; nothing is added unless you do.</p>
      ${plan.suggestions.map((s) => `
        <label class="check-block">
          <input type="checkbox" data-substitute="${s.resourceId}" ${state.selected.has(s.resourceId) ? 'checked' : ''}>
          <span><strong>${escapeHtml(s.name)}</strong> from ${escapeHtml(s.unitName)}
            <span class="form-field__hint">${escapeHtml(CONDITION[s.condition])} condition, ${s.available.toLocaleString('en-US')} available.
            ${state.selected.has(s.resourceId) ? (s.quantity ? `Using ${s.quantity.toLocaleString('en-US')} of them.` : 'Not needed: the plan is already covered.') : ''}</span></span>
        </label>`).join('')}
    </fieldset>` : '';

  const excluded = plan.excluded.length ? `
    <details class="plan__why">
      <summary>Why not these? (${plan.excluded.length})</summary>
      <p class="form-field__hint">Listings that look like what you asked for, and why they are not in the plan.</p>
      <ul>${plan.excluded.map((e) => `<li><strong>${escapeHtml(e.name)}</strong> (${escapeHtml(e.unitName)}): ${escapeHtml(e.why)}</li>`).join('')}</ul>
    </details>` : '';

  const blocked = plan.blockedReason ? `<p class="alert alert--error">${escapeHtml(plan.blockedReason)}</p>` : '';
  const submit = plan.canSubmit ?
    (canSubmit ?
      `<button class="button" type="button" data-submit="${requestId}">Submit this plan</button>
         <span class="form-field__hint">Submitting holds these items for you. Another request cannot take them.</span>` :
      '<p class="form-field__hint">Only the person who made this request, a manager of its unit, or an admin can submit it.</p>') :
    '';

  panel.innerHTML = `
    ${notice ? `<p class="alert alert--error" role="alert" tabindex="-1">${escapeHtml(notice)}</p>` : ''}
    <h4 class="plan__summary">${escapeHtml(summary)}</h4>
    ${lines}${suggestions}${blocked}${excluded}
    ${submit ? `<div class="plan__actions">${submit}</div>` : ''}`;
  state.plan = plan;
}

async function loadPlan(panel, requestId,
{
  notice = '',
  refocus = null
} =
{})
{
  const state = plans.get(requestId) ??
  {
    selected: new Set(),
    plan: null
  };
  plans.set(requestId, state);
  panel.setAttribute('aria-busy', 'true');
  try
  {
    const ids = [...state.selected].join(',');
    const
    {
      plan
    } = await api(`/matches/${requestId}${ids ? `?substitutes=${ids}` : ''}`);
    if (!plan)
    {
      panel.innerHTML = '<p class="card__meta">This request is no longer open, so it has no proposed plan.</p>';
      return;
    }
    renderPlan(panel, requestId, plan, notice);
    if (refocus) panel.querySelector(refocus)?.focus();
  }
  catch (error)
  {
    panel.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
  finally
  {
    panel.removeAttribute('aria-busy');
  }
}

container.addEventListener('click', async (event) =>
{
  const toggle = event.target.closest('[data-plan]');
  if (toggle)
  {
    const requestId = Number(toggle.dataset.plan);
    const panel = document.getElementById(`plan-${requestId}`);
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Hide proposed plan' : 'View proposed plan';
    panel.hidden = !open;
    if (open) await loadPlan(panel, requestId); // always fresh: stock may have changed since the last look
    return;
  }

  const submit = event.target.closest('[data-submit]');
  if (!submit) return;
  const requestId = Number(submit.dataset.submit);
  const panel = document.getElementById(`plan-${requestId}`);
  const state = plans.get(requestId);
  submit.disabled = true;
  try
  {
    const result = await api(`/matches/${requestId}/submit`,
    {
      method: 'POST',
      body:
      {
        substituteIds: [...state.selected],
        signature: state.plan.signature
      }
    });
    showBanner(result.needsApproval ?
      'Plan submitted. An admin will review it, and the items are held for you in the meantime.' :
      'Plan approved automatically. Arrange the hand-off on the dates shown.');
    window.scrollTo(
    {
      top: 0,
      behavior: 'smooth'
    });
    await loadRequests();
    await loadListings();
  }
  catch (error)
  {
    if (error.status === 409 && error.data?.plan)
    {
      // The plan changed while it was on screen: nothing was reserved. Show the new one to confirm.
      renderPlan(panel, requestId, error.data.plan, error.message);
      panel.querySelector('.alert')?.focus();
    }
    else
    {
      showBanner(error.message, true);
      submit.disabled = false;
    }
  }
});

container.addEventListener('change', (event) =>
{
  const box = event.target.closest('[data-substitute]');
  if (!box) return;
  const panel = box.closest('.plan');
  const requestId = Number(panel.id.replace('plan-', ''));
  const selected = plans.get(requestId).selected;
  const id = Number(box.dataset.substitute);
  if (box.checked) selected.add(id);
  else selected.delete(id);
  loadPlan(panel, requestId,
  {
    refocus: `[data-substitute="${id}"]`
  });
});

// My listings
const LISTING_STATUS =
{
  pending_review:
  {
    label: 'Awaiting review',
    badge: 'badge--warning'
  },
  approved:
  {
    label: 'Live',
    badge: 'badge--success'
  },
  rejected:
  {
    label: 'Not approved',
    badge: 'badge--danger'
  },
  archived:
  {
    label: 'Archived',
    badge: ''
  },
};

function listingRow(item)
{
  const status = LISTING_STATUS[item.status] ??
  {
    label: item.status,
    badge: ''
  };
  return `<tr>
    <th scope="row">${escapeHtml(item.name)}<span class="plan__sub">${escapeHtml(item.categoryName)}</span>${item.reviewNote ? `<span class="plan__sub">Reason: ${escapeHtml(item.reviewNote)}</span>` : ''}</th>
    <td>${escapeHtml(item.unitName)}</td>
    <td><span class="badge ${status.badge}">${status.label}</span></td>
    <td class="mono">${item.quantityAvailable.toLocaleString('en-US')}</td>
    <td class="mono">${item.quantityReserved.toLocaleString('en-US')}</td>
    <td class="mono">${item.quantityTotal.toLocaleString('en-US')}</td>
    <td>${formatDate(item.availableUntil)}</td>
  </tr>`;
}

async function loadListings()
{
  const box = document.getElementById('my-listings');
  try
  {
    const
    {
      resources
    } = await api('/resources/mine');
    box.innerHTML = resources.length ? `
      <div class="table-scroll">
        <table class="table">
          <caption class="visually-hidden">Listings from your units</caption>
          <thead>
    <tr>
    <th scope="col">Item</th>
    <th scope="col">Unit</th>
    <th scope="col">Status</th>
            <th scope="col">Available</th>
    <th scope="col">Reserved</th>
    <th scope="col">Total</th>
    <th scope="col">Until</th>
    </tr>
    </thead>
          <tbody>${resources.map(listingRow).join('')}</tbody>
        </table>
      </div>` :
      '<div class="placeholder-note">Nothing listed yet. Use "+ Add a Resource" to share surplus supplies.</div>';
  }
  catch (error)
  {
    box.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

/** Move keyboard focus to the status message so screen-reader users hear what happened. */
function focusBanner()
{
  banner.setAttribute('tabindex', '-1');
  banner.focus();
}

function showBanner(text, isError = false)
{
  banner.textContent = text;
  banner.className = `alert ${isError ? 'alert--error' : 'alert--success'}`;
  banner.hidden = false;
}

// Cancel buttons (one listener for the whole list).
container.addEventListener('click', async (event) =>
{
  const button = event.target.closest('[data-cancel]');
  if (!button) return;

  const warning = button.dataset.status === 'pending_approval' ?
    ' The items reserved for your submitted plan will be released.' : '';
  const sure = await confirmDialog(
  {
    title: `Cancel your request for "${button.dataset.name}"?`,
    message: warning.trim(),
    confirmLabel: 'Cancel request',
    cancelLabel: 'Keep it',
    danger: true
  });
  if (!sure) return;

  button.disabled = true;
  try
  {
    await api(`/requests/${button.dataset.cancel}/cancel`,
    {
      method: 'POST'
    });
    showBanner('Request cancelled.');
    await loadRequests();
    focusBanner();
  }
  catch (error)
  {
    showBanner(error.message, true);
    button.disabled = false;
  }
});

// Confirmation messages sent here by the request form (?submitted=open|pending_review, ?updated=1).
const params = new URLSearchParams(window.location.search);
if (params.get('submitted') === 'pending_review')
{
  showBanner('Request submitted. An admin in your organization will review it before matching starts.');
}
else if (params.get('submitted'))
{
  showBanner('Request submitted. It is open for matching.');
}
else if (params.has('updated'))
{
  showBanner('Changes saved.');
}
if (params.size) window.history.replaceState(null, '', window.location.pathname); // so a reload doesn't repeat the message

loadRequests();
loadListings();

// Hand-offs
const HANDOFF_STATUS =
{
  scheduled:
  {
    label: 'Scheduled',
    badge: 'badge--warning'
  },
  completed:
  {
    label: 'Completed',
    badge: 'badge--success'
  },
  cancelled:
  {
    label: 'Cancelled',
    badge: ''
  },
};
const HANDOFF_ROLE =
{
  give: 'You give',
  receive: 'You receive',
  both: 'Both sides',
  oversee: 'Admin view'
};

function handoffRow(item)
{
  const status = HANDOFF_STATUS[item.status] ??
  {
    label: item.status,
    badge: ''
  };
  const label = `${item.quantity} ${item.resourceName}`;
  const when = item.status === 'completed' && item.completedAt ?
    `Done ${formatDate(item.completedAt.slice(0, 10))}` :
    item.scheduledFor ? formatDate(item.scheduledFor) : 'To be arranged';
  const actions = item.canAct ? `
    <button class="button button--success" type="button" data-complete-handoff="${item.id}"
            data-label="${escapeHtml(label)}">${item.role === 'give' ? 'Mark handed over' : 'Mark received'}</button>
    <button class="button button--secondary" type="button" data-cancel-handoff="${item.id}"
            data-label="${escapeHtml(label)}">Cancel</button>` : '';
  return `<tr>
    <th scope="row">${item.quantity.toLocaleString('en-US')} &times; ${escapeHtml(item.resourceName)}<span class="plan__sub">For: ${escapeHtml(item.requestItem)}</span></th>
    <td>${escapeHtml(item.supplierUnit)} &rarr; ${escapeHtml(item.receiverUnit)}<span class="plan__sub">${HANDOFF_ROLE[item.role]}</span></td>
    <td>${when}<span class="plan__sub">${escapeHtml(item.pickupNote ?? '')}</span></td>
    <td><span class="badge ${status.badge}">${status.label}</span></td>
    <td>
    <div class="handoff-actions">${actions}</div>
    </td>
  </tr>`;
}

async function loadHandoffs()
{
  const box = document.getElementById('my-handoffs');
  try
  {
    const
    {
      transfers
    } = await api('/transfers');
    box.innerHTML = transfers.length ? `
      <div class="table-scroll">
        <table class="table">
          <caption class="visually-hidden">Hand-offs for your units</caption>
          <thead>
    <tr>
    <th scope="col">Items</th>
    <th scope="col">From &rarr; to</th>
    <th scope="col">When</th>
            <th scope="col">Status</th>
    <th scope="col"><span class="visually-hidden">Actions</span></th>
    </tr>
    </thead>
          <tbody>${transfers.map(handoffRow).join('')}</tbody>
        </table>
      </div>` :
      '<div class="placeholder-note">No hand-offs yet. They appear here once a plan is approved.</div>';
  }
  catch (error)
  {
    box.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById('my-handoffs').addEventListener('click', async (event) =>
{
  const done = event.target.closest('[data-complete-handoff]');
  const cancel = event.target.closest('[data-cancel-handoff]');
  const button = done ?? cancel;
  if (!button) return;

  let url;
  let body =
  {};
  let success;
  if (done)
  {
    const sure = await confirmDialog(
    {
      title: 'Confirm the hand-off',
      message: `${button.dataset.label} has changed hands. This removes it from stock and cannot be undone.`,
      confirmLabel: 'Yes, it happened'
    });
    if (!sure) return;
    url = `/transfers/${done.dataset.completeHandoff}/complete`;
    success = 'Hand-off recorded. It now counts toward your impact.';
  }
  else
  {
    const reason = await promptDialog(
    {
      title: 'Cancel this hand-off?',
      message: `${button.dataset.label}. The reserved stock is released.`,
      label: 'Reason',
      required: true,
      requiredMessage: 'Give a short reason so everyone knows why.',
      confirmLabel: 'Cancel hand-off',
      cancelLabel: 'Keep it',
      danger: true
    });
    if (reason === null) return;
    url = `/transfers/${cancel.dataset.cancelHandoff}/cancel`;
    body =
    {
      reason
    };
    success = 'Hand-off cancelled. The stock was released.';
  }

  button.disabled = true;
  try
  {
    await api(url,
    {
      method: 'POST',
      body
    });
    showBanner(success);
  }
  catch (error)
  {
    showBanner(error.message, true);
  }
  await Promise.all([loadHandoffs(), loadRequests(), loadListings()]);
  focusBanner(); // the button that was clicked is gone after the reload, so move focus to the result
});

loadHandoffs();
