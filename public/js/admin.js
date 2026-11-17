// Admin page: join code, plans, listings, conflicts and requests waiting on an admin, units, and people.
// layout.js already keeps non-admins out (body data-requires="admin"), and the server
// repeats that check on every /api/admin call.
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
  confirmDialog
} from './dialog.js';

const KIND_LABELS =
{
  department: 'Department',
  club: 'Club',
  team: 'Team',
  program: 'Program',
  other: 'Other'
};

const statusBox = document.getElementById('status-message');
const unitsBox = document.getElementById('units-box');
const peopleBox = document.getElementById('people-box');
const reviewBox = document.getElementById('review-box');
const plansBox = document.getElementById('plans-box');
const listingsBox = document.getElementById('listings-box');
const conflictsBox = document.getElementById('conflicts-box');

let units = [];
let members = [];
let me = null;
let editingUnitId = null; // which unit row is being renamed

/** Show the result of an action. Errors get the red style. */
function say(text, isError = false)
{
  statusBox.textContent = text;
  statusBox.className = `alert ${isError ? 'alert--error' : 'alert--success'}`;
  statusBox.hidden = false;
}

/** Run an action, report success or the server's message, and refresh the lists either way. */
async function perform(action, successText)
{
  try
  {
    await action();
    say(successText);
  }
  catch (error)
  {
    say(error.message, true);
  }
  await refreshAll();
  // The row that was clicked is usually gone after the refresh, so put keyboard focus on the result message.
  statusBox.setAttribute('tabindex', '-1');
  statusBox.focus(
  {
    preventScroll: true
  });
}

/** Units load first: the people table needs their names. */
async function refreshAll()
{
  await loadUnits();
  await Promise.all([loadMembers(), loadReview(), loadPlans(), loadListings(), loadConflicts()]);
}

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

// Join code
async function loadOrganization()
{
  const
  {
    organization
  } = await api('/admin/organization');
  document.getElementById('org-name').textContent = organization.name;
  document.getElementById('join-code').textContent = organization.joinCode;
}

document.getElementById('regenerate-code').addEventListener('click', async () =>
{
  const sure = await confirmDialog(
  {
    title: 'Generate a new join code?',
    message: 'The current code will stop working right away. People who already joined are not affected.',
    confirmLabel: 'Generate new code',
    danger: true
  });
  if (!sure) return;
  try
  {
    const
    {
      joinCode
    } = await api('/admin/organization/join-code',
    {
      method: 'POST'
    });
    document.getElementById('join-code').textContent = joinCode;
    say('New join code created. The old one no longer works.');
  }
  catch (error)
  {
    say(error.message, true);
  }
});

// Units
function unitRow(unit)
{
  if (unit.id === editingUnitId)
  {
    return `
      <tr>
        <td><label class="visually-hidden" for="edit-unit-name">Unit name</label>
            <input class="form-input" id="edit-unit-name" type="text" maxlength="60" value="${escapeHtml(unit.name)}"></td>
        <td><label class="visually-hidden" for="edit-unit-kind">Type</label>
            <select class="form-input" id="edit-unit-kind">${Object.entries(KIND_LABELS).map(([value, label]) =>
    `<option value="${value}" ${value === unit.kind ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
        <td class="mono">${unit.memberCount}</td>
        <td class="row-actions">
          <button class="button" type="button" data-save-unit="${unit.id}">Save</button>
          <button class="button button--secondary" type="button" data-cancel-edit>Cancel</button>
        </td>
      </tr>`;
  }
  return `
    <tr>
      <th scope="row">${escapeHtml(unit.name)}</th>
      <td>${KIND_LABELS[unit.kind]}</td>
      <td class="mono">${unit.memberCount}</td>
      <td class="row-actions">
        <button class="button button--secondary" type="button" data-edit-unit="${unit.id}"
                aria-label="Rename ${escapeHtml(unit.name)}">Rename</button>
      </td>
    </tr>`;
}

async function loadUnits()
{
  (
  {
    units
  } = await api('/admin/units'));
  unitsBox.innerHTML = units.length ? `
    <div class="table-scroll">
      <table class="table admin-table">
        <thead>
  <tr>
  <th scope="col">Name</th>
  <th scope="col">Type</th>
  <th scope="col">People</th>
  <th scope="col"><span class="visually-hidden">Actions</span></th>
  </tr>
  </thead>
        <tbody>${units.map(unitRow).join('')}</tbody>
      </table>
    </div>` : '<div class="placeholder-note">No units yet. Add your first department, club, or team below.</div>';
}

unitsBox.addEventListener('click', async (event) =>
{
  const edit = event.target.closest('[data-edit-unit]');
  if (edit)
  {
    editingUnitId = Number(edit.dataset.editUnit);
    await loadUnits();
    document.getElementById('edit-unit-name')?.focus();
    return;
  }
  if (event.target.closest('[data-cancel-edit]'))
  {
    editingUnitId = null;
    await loadUnits();
    return;
  }
  const save = event.target.closest('[data-save-unit]');
  if (save)
  {
    const body =
    {
      name: document.getElementById('edit-unit-name').value,
      kind: document.getElementById('edit-unit-kind').value
    };
    editingUnitId = null;
    await perform(() => api(`/admin/units/${save.dataset.saveUnit}`,
    {
      method: 'PUT',
      body
    }), 'Unit updated.');
  }
});

document.getElementById('add-unit-form').addEventListener('submit', async (event) =>
{
  event.preventDefault();
  const nameInput = document.getElementById('new-unit-name');
  const error = document.getElementById('new-unit-name-error');
  error.textContent = '';
  try
  {
    await api('/admin/units',
    {
      method: 'POST',
      body:
      {
        name: nameInput.value,
        kind: document.getElementById('new-unit-kind').value
      }
    });
    nameInput.value = '';
    say('Unit added.');
    await refreshAll();
  }
  catch (problem)
  {
    error.textContent = problem.fields?.name ?? problem.message;
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.focus();
  }
});

// People
function membershipSummary(member)
{
  if (!member.units.length) return member.role === 'org_admin' ? 'All units (admin)' : 'No units yet';
  return member.units.map((m) =>
  {
    const unit = units.find((u) => u.id === m.unitId);
    return `${unit ? unit.name : 'Unit'}${m.role === 'manager' ? ' (manager)' : ''}`;
  }).join(', ');
}

function memberRow(member)
{
  const unitControls = units.map((unit) =>
  {
    const current = member.units.find((m) => m.unitId === unit.id)?.role ?? '';
    const id = `m${member.id}-u${unit.id}`;
    return `
      <div class="member-units__row">
        <label for="${id}">${escapeHtml(unit.name)}</label>
        <select class="form-input" id="${id}" data-unit="${unit.id}">
          <option value="" ${current === '' ? 'selected' : ''}>Not in unit</option>
          <option value="member" ${current === 'member' ? 'selected' : ''}>Member</option>
          <option value="manager" ${current === 'manager' ? 'selected' : ''}>Manager</option>
        </select>
      </div>`;
  }).join('');

  return `
    <tr>
      <th scope="row">${escapeHtml(member.name)}${member.id === me.id ? ' <span class="badge">You</span>' : ''}
          <br><span class="card__meta">${escapeHtml(member.email)}</span></th>
      <td>
        <label class="visually-hidden" for="role-${member.id}">Role for ${escapeHtml(member.name)}</label>
        <select class="form-input" id="role-${member.id}" data-role-for="${member.id}">
          <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
          <option value="org_admin" ${member.role === 'org_admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>
        <details class="member-units">
          <summary>${escapeHtml(membershipSummary(member))}</summary>
          ${units.length ? `<div class="member-units__grid">${unitControls}</div>
          <button class="button" type="button" data-save-units="${member.id}">Save units</button>`
    : '<p class="card__meta">Add a unit first.</p>'}
        </details>
      </td>
    </tr>`;
}

async function loadMembers()
{
  (
  {
    members
  } = await api('/admin/members'));
  peopleBox.innerHTML = `
    <div class="table-scroll">
      <table class="table admin-table">
        <thead>
  <tr>
  <th scope="col">Person</th>
  <th scope="col">Role</th>
  <th scope="col">Units</th>
  </tr>
  </thead>
        <tbody>${members.map(memberRow).join('')}</tbody>
      </table>
    </div>`;
}

peopleBox.addEventListener('change', (event) =>
{
  const select = event.target.closest('[data-role-for]');
  if (!select) return;
  perform(() => api(`/admin/members/${select.dataset.roleFor}/role`,
    {
      method: 'PUT',
      body:
      {
        role: select.value
      }
    }),
    'Role updated.');
});

peopleBox.addEventListener('click', (event) =>
{
  const save = event.target.closest('[data-save-units]');
  if (!save) return;
  const memberships = [...save.closest('details').querySelectorAll('select[data-unit]')]
    .filter((select) => select.value)
    .map((select) => (
    {
      unitId: Number(select.dataset.unit),
      role: select.value
    }));
  perform(() => api(`/admin/members/${save.dataset.saveUnits}/units`,
    {
      method: 'PUT',
      body:
      {
        units: memberships
      }
    }),
    'Units updated.');
});

// Requests waiting for review
function reviewItem(request)
{
  return `
    <div class="review-item">
      <h3>${escapeHtml(request.itemName)} <span class="mono">&times; ${request.quantity.toLocaleString('en-US')}</span></h3>
      <p class="card__meta">${escapeHtml(request.unitName)} &middot; requested by ${escapeHtml(request.requesterName)}
         &middot; needed by ${formatDate(request.neededBy)}</p>
      <p>${escapeHtml(request.intendedUse)}</p>
      <div class="review-item__actions">
        <button class="button button--success" type="button" data-approve="${request.id}">Approve</button>
        <label class="visually-hidden" for="reject-note-${request.id}">Reason for rejecting ${escapeHtml(request.itemName)}</label>
        <input class="form-input" id="reject-note-${request.id}" type="text" maxlength="300" placeholder="Reason, if rejecting">
        <button class="button button--secondary" type="button" data-reject="${request.id}">Reject</button>
      </div>
    </div>`;
}

async function loadReview()
{
  const
  {
    requests
  } = await api('/admin/requests/pending');
  reviewBox.innerHTML = requests.length ? requests.map(reviewItem).join('') :
    '<p class="card__meta">Nothing is waiting for review.</p>';
}

reviewBox.addEventListener('click', (event) =>
{
  const approve = event.target.closest('[data-approve]');
  if (approve)
  {
    perform(() => api(`/admin/requests/${approve.dataset.approve}/approve`,
      {
        method: 'POST',
        body:
        {}
      }),
      'Request approved. It is now open for matching.');
    return;
  }
  const reject = event.target.closest('[data-reject]');
  if (reject)
  {
    const note = document.getElementById(`reject-note-${reject.dataset.reject}`).value;
    perform(() => api(`/admin/requests/${reject.dataset.reject}/reject`,
    {
      method: 'POST',
      body:
      {
        note
      }
    }), 'Request rejected.');
  }
});

// Plans waiting for approval
const dollars = (cents) => (cents / 100).toLocaleString('en-US',
{
  style: 'currency',
  currency: 'USD'
});

function planItem(plan)
{
  const lines = plan.lines.map((line) => `
    <li>
      <strong>${line.quantity.toLocaleString('en-US')} &times; ${escapeHtml(line.resourceName)}</strong>
      from ${escapeHtml(line.supplierUnit)}${line.matchType === 'substitute' ? ' (substitute)' : ''}
      &middot; hand-off ${line.handoffDate ? formatDate(line.handoffDate) : 'to be arranged'}
      <span class="card__meta">${escapeHtml(line.reason)}</span>
    </li>`).join('');
  const partial = plan.covered < plan.requested ?
    ` <span class="badge badge--warning">Partial: ${plan.covered} of ${plan.requested}</span>` : '';
  return `
    <div class="review-item">
      <h3>${escapeHtml(plan.itemName)} <span class="mono">&times; ${plan.requested.toLocaleString('en-US')}</span>${partial}</h3>
      <p class="card__meta">For ${escapeHtml(plan.unitName)} &middot; submitted by ${escapeHtml(plan.submittedBy)}
         &middot; needed by ${formatDate(plan.neededBy)} &middot; estimated value ${dollars(plan.totalValueCents)}</p>
      <ul class="plan-lines">${lines}</ul>
      <div class="review-item__actions">
        <button class="button button--success" type="button" data-approve-plan="${plan.id}">Approve plan</button>
        <label class="visually-hidden" for="plan-note-${plan.id}">Reason for rejecting the plan for ${escapeHtml(plan.itemName)}</label>
        <input class="form-input" id="plan-note-${plan.id}" type="text" maxlength="300" placeholder="Reason, if rejecting">
        <button class="button button--secondary" type="button" data-reject-plan="${plan.id}">Reject plan</button>
      </div>
    </div>`;
}

async function loadPlans()
{
  const
  {
    plans
  } = await api('/admin/plans/pending');
  plansBox.innerHTML = plans.length ? plans.map(planItem).join('') :
    '<p class="card__meta">No plans are waiting for approval.</p>';
}

plansBox.addEventListener('click', (event) =>
{
  const approve = event.target.closest('[data-approve-plan]');
  if (approve)
  {
    perform(() => api(`/admin/plans/${approve.dataset.approvePlan}/approve`,
      {
        method: 'POST',
        body:
        {}
      }),
      'Plan approved. Transfers are scheduled.');
    return;
  }
  const reject = event.target.closest('[data-reject-plan]');
  if (reject)
  {
    const note = document.getElementById(`plan-note-${reject.dataset.rejectPlan}`).value;
    perform(() => api(`/admin/plans/${reject.dataset.rejectPlan}/reject`,
      {
        method: 'POST',
        body:
        {
          note
        }
      }),
      'Plan rejected. The stock was released and the request is open again.');
  }
});

// Listings waiting for review
function listingItem(item)
{
  return `
    <div class="review-item">
      <h3>${escapeHtml(item.name)} <span class="mono">&times; ${item.quantity.toLocaleString('en-US')}</span></h3>
      <p class="card__meta">${escapeHtml(item.unitName)} &middot; ${escapeHtml(item.categoryName)} &middot; ${escapeHtml(item.condition)}
         &middot; listed by ${escapeHtml(item.publisher)} &middot; ${dollars(item.valueCents)} each (estimate)</p>
      <p>${escapeHtml(item.description)}</p>
      <div class="review-item__actions">
        <button class="button button--success" type="button" data-approve-listing="${item.id}">Approve listing</button>
        <label class="visually-hidden" for="listing-note-${item.id}">Reason for rejecting ${escapeHtml(item.name)}</label>
        <input class="form-input" id="listing-note-${item.id}" type="text" maxlength="300" placeholder="Reason, if rejecting">
        <button class="button button--secondary" type="button" data-reject-listing="${item.id}">Reject listing</button>
      </div>
    </div>`;
}

async function loadListings()
{
  const
  {
    listings
  } = await api('/admin/listings/pending');
  listingsBox.innerHTML = listings.length ? listings.map(listingItem).join('') :
    '<p class="card__meta">No listings are waiting for review.</p>';
}

listingsBox.addEventListener('click', (event) =>
{
  const approve = event.target.closest('[data-approve-listing]');
  if (approve)
  {
    perform(() => api(`/admin/listings/${approve.dataset.approveListing}/approve`,
      {
        method: 'POST',
        body:
        {}
      }),
      'Listing approved. It can now be matched.');
    return;
  }
  const reject = event.target.closest('[data-reject-listing]');
  if (reject)
  {
    const note = document.getElementById(`listing-note-${reject.dataset.rejectListing}`).value;
    perform(() => api(`/admin/listings/${reject.dataset.rejectListing}/reject`,
      {
        method: 'POST',
        body:
        {
          note
        }
      }),
      'Listing rejected.');
  }
});

// Conflicts
function conflictItem(conflict)
{
  return `
    <div class="review-item">
      <h3><span class="badge badge--warning">${escapeHtml(conflict.kindLabel)}</span></h3>
      <p>${escapeHtml(conflict.description)}</p>
      <div class="review-item__actions">
        <label class="visually-hidden" for="conflict-note-${conflict.id}">How this was resolved</label>
        <input class="form-input" id="conflict-note-${conflict.id}" type="text" maxlength="300" placeholder="How it was resolved">
        <button class="button" type="button" data-resolve-conflict="${conflict.id}">Mark resolved</button>
      </div>
    </div>`;
}

async function loadConflicts()
{
  const
  {
    conflicts
  } = await api('/admin/conflicts');
  conflictsBox.innerHTML = conflicts.length ? conflicts.map(conflictItem).join('') :
    '<p class="card__meta">Nothing needs your attention.</p>';
}

conflictsBox.addEventListener('click', (event) =>
{
  const resolve = event.target.closest('[data-resolve-conflict]');
  if (!resolve) return;
  const note = document.getElementById(`conflict-note-${resolve.dataset.resolveConflict}`).value;
  perform(() => api(`/admin/conflicts/${resolve.dataset.resolveConflict}/resolve`,
    {
      method: 'POST',
      body:
      {
        note
      }
    }),
    'Conflict marked resolved.');
});

// Start-up
async function start()
{
  me = (await api('/auth/me')).user;
  if (new URLSearchParams(window.location.search).has('welcome'))
  {
    document.getElementById('welcome').hidden = false;
    window.history.replaceState(null, '', window.location.pathname);
  }
  await loadOrganization();
  await loadUnits(); // units first: the people table needs their names
  await Promise.all([loadMembers(), loadReview(), loadPlans(), loadListings(), loadConflicts()]);
}

start().catch((error) => say(error.message, true));
