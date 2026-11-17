// Settings page: branding (with a live contrast preview), categories, locations,
// default pickup hours per unit, and approval rules.
// layout.js keeps non-admins out (body data-requires="admin"); the server repeats the check
// on every /api/admin/settings call.
import
{
  api
} from './api.js';
import
{
  applyBranding,
  escapeHtml
} from './layout.js';
import
{
  confirmDialog
} from './dialog.js';
import
{
  contrastRatio,
  isHexColor,
  textColorFor
} from './color.js';

const DEFAULT_COLOR = '#439de8';
const DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun']
];

const statusBox = document.getElementById('status-message');
let settings = null;
let colorChosen = false; // false = use the LoopLocal default colors
const editing =
{
  categories: null,
  locations: null
}; // id of the row being renamed

/** Show the result of an action. Errors get the red style. */
function say(text, isError = false)
{
  statusBox.textContent = text;
  statusBox.className = `alert ${isError ? 'alert--error' : 'alert--success'}`;
  statusBox.hidden = false;
  // The message sits at the top of the page, so bring it into view if the person scrolled down.
  statusBox.scrollIntoView(
  {
    block: 'nearest'
  });
}

async function load()
{
  settings = await api('/admin/settings');
  document.getElementById('org-name').textContent = settings.organization.name;
  renderBranding();
  renderList('categories');
  renderList('locations');
  renderHours();
  renderApprovals();
}

/** Run an action, report the outcome, and reload either way so the screen matches the server. */
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
  await load();
  // The row that was clicked is usually gone after the refresh, so put keyboard focus on the result message.
  statusBox.setAttribute('tabindex', '-1');
  statusBox.focus(
  {
    preventScroll: true
  });
}

function setFieldError(inputId, message)
{
  const input = document.getElementById(inputId);
  const error = document.getElementById(`${inputId}-error`);
  error.textContent = message ?? '';
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

// Tabs
const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab,
{
  focus = false
} =
{})
{
  for (const other of tabs)
  {
    const selected = other === tab;
    other.setAttribute('aria-selected', String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
  try
  {
    window.history.replaceState(null, '', `#${tab.id.replace('tab-', '')}`);
  }
  catch
  {
    /* ignore */ }
}

document.getElementById('tablist').addEventListener('click', (event) =>
{
  const tab = event.target.closest('[role="tab"]');
  if (tab) selectTab(tab);
});

document.getElementById('tablist').addEventListener('keydown', (event) =>
{
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const target =
  {
    ArrowRight: tabs[(index + 1) % tabs.length],
    ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
    Home: tabs[0],
    End: tabs[tabs.length - 1]
  } [event.key];
  if (target)
  {
    event.preventDefault();
    selectTab(target,
    {
      focus: true
    });
  }
});

// Branding: live preview
const colorInput = document.getElementById('brand-color');
const nameInput = document.getElementById('org-name-input');

/** The page's background as #rrggbb, so the preview follows light and dark mode. */
function pageBackground()
{
  const match = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
  if (!match) return '#ffffff';
  return `#${match.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function showCheck(ratioId, badgeId, ratio, needed)
{
  const pass = ratio >= needed;
  document.getElementById(ratioId).textContent = `${ratio.toFixed(1)} : 1`;
  const badge = document.getElementById(badgeId);
  badge.textContent = pass ? 'Passes' : 'Too low';
  badge.className = `badge ${pass ? 'badge--success' : 'badge--warning'}`;
}

function updatePreview()
{
  const color = colorChosen && isHexColor(colorInput.value) ? colorInput.value : DEFAULT_COLOR;
  const text = textColorFor(color);
  const button = document.getElementById('preview-button');
  button.style.background = color;
  button.style.color = text;
  document.getElementById('preview-org').textContent = nameInput.value.trim() || 'Your organization';

  const textRatio = contrastRatio(color, text);
  const pageRatio = contrastRatio(color, pageBackground());
  showCheck('check-text-ratio', 'check-text-badge', textRatio, 4.5);
  showCheck('check-page-ratio', 'check-page-badge', pageRatio, 3);

  document.getElementById('preview-note').textContent = colorChosen ?
    (textRatio >= 4.5 && pageRatio >= 3 ?
      'This color is easy to read. It will be used for buttons and highlights.' :
      'This color may be hard to read for some people. You can still save it, but a darker or more vivid color is safer.') :
    'Showing the LoopLocal default colors.';
}

colorInput.addEventListener('input', () =>
{
  colorChosen = true;
  updatePreview();
});
nameInput.addEventListener('input', updatePreview);
document.getElementById('reset-color').addEventListener('click', () =>
{
  colorChosen = false;
  colorInput.value = DEFAULT_COLOR;
  updatePreview();
});
// The page background changes with the theme, so recheck the color-against-page ratio.
new MutationObserver(updatePreview).observe(document.documentElement,
{
  attributes: true,
  attributeFilter: ['data-theme']
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updatePreview);

function renderBranding()
{
  const
  {
    organization
  } = settings;
  nameInput.value = organization.name;
  colorChosen = isHexColor(organization.brandColor);
  colorInput.value = colorChosen ? organization.brandColor : DEFAULT_COLOR;
  updatePreview();

  const image = document.getElementById('logo-image');
  const hasLogo = Boolean(organization.logoFilename);
  image.hidden = !hasLogo;
  if (hasLogo)
  {
    image.src = `/uploads/${encodeURIComponent(organization.logoFilename)}`;
    image.alt = `${organization.name} logo`;
  }
  document.getElementById('logo-empty').hidden = hasLogo;
  document.getElementById('remove-logo').hidden = !hasLogo;
}

document.getElementById('branding-form').addEventListener('submit', async (event) =>
{
  event.preventDefault();
  setFieldError('org-name-input', null);
  setFieldError('brand-color', null);
  try
  {
    await api('/admin/settings/branding',
    {
      method: 'PUT',
      body:
      {
        name: nameInput.value,
        brandColor: colorChosen ? colorInput.value : null
      },
    });
    applyBranding(
    {
      name: nameInput.value.trim(),
      color: colorChosen ? colorInput.value : null,
      logoFilename: settings.organization.logoFilename
    });
    say('Branding saved.');
    await load();
  }
  catch (error)
  {
    if (error.fields?.name) setFieldError('org-name-input', error.fields.name);
    if (error.fields?.brandColor) setFieldError('brand-color', error.fields.brandColor);
    say(error.message, true);
    (error.fields?.name ? nameInput : colorInput).focus();
  }
});

document.getElementById('upload-logo').addEventListener('click', async () =>
{
  const fileInput = document.getElementById('logo-file');
  setFieldError('logo-file', null);
  const file = fileInput.files[0];
  if (!file)
  {
    setFieldError('logo-file', 'Choose an image file first.');
    fileInput.focus();
    return;
  }
  if (file.size > 1024 * 1024)
  {
    setFieldError('logo-file', 'The logo must be 1 MB or smaller.');
    fileInput.focus();
    return;
  }

  const form = new FormData();
  form.append('logo', file);
  try
  {
    const response = await fetch('/api/admin/settings/logo',
    {
      method: 'POST',
      body: form,
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => (
    {}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Upload failed.'),
    {
      fields: data.fields
    });
    fileInput.value = '';
    applyBranding(
    {
      name: settings.organization.name,
      color: settings.organization.brandColor,
      logoFilename: data.logoFilename
    });
    say('Logo uploaded.');
    await load();
  }
  catch (error)
  {
    setFieldError('logo-file', error.fields?.logo ?? error.message);
    fileInput.focus();
  }
});

document.getElementById('remove-logo').addEventListener('click', () =>
{
  perform(async () =>
  {
    await api('/admin/settings/logo',
    {
      method: 'DELETE'
    });
    applyBranding(
    {
      name: settings.organization.name,
      color: settings.organization.brandColor,
      logoFilename: null
    });
  }, 'Logo removed.');
});

// Categories and locations
const LIST_TEXT =
{
  categories:
  {
    noun: 'category',
    empty: 'No categories yet. Add your first one below.'
  },
  locations:
  {
    noun: 'location',
    empty: 'No locations yet. Add the places where items are kept.'
  },
};

function listRow(kind, item)
{
  const
  {
    noun
  } = LIST_TEXT[kind];
  if (item.id === editing[kind])
  {
    return `
      <tr>
        <td><label class="visually-hidden" for="edit-${kind}">Rename ${noun}</label>
            <input class="form-input" id="edit-${kind}" type="text" maxlength="40" value="${escapeHtml(item.name)}"></td>
        <td></td>
        <td class="row-actions">
          <button class="button" type="button" data-save="${item.id}">Save</button>
          <button class="button button--secondary" type="button" data-cancel>Cancel</button>
        </td>
      </tr>`;
  }
  const usage = item.inUse ? `${item.inUse.toLocaleString('en-US')} in use` : 'Not used';
  const deleteControl = item.inUse ?
    `<button class="button button--secondary" type="button" disabled aria-label="Cannot delete ${escapeHtml(item.name)}: it is in use">Delete</button>` :
    `<button class="button button--secondary" type="button" data-delete="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button>`;
  return `
    <tr>
      <th scope="row">${escapeHtml(item.name)}</th>
      <td class="card__meta">${usage}</td>
      <td class="row-actions">
        <button class="button button--secondary" type="button" data-edit="${item.id}" aria-label="Rename ${escapeHtml(item.name)}">Rename</button>
        ${deleteControl}
      </td>
    </tr>`;
}

function renderList(kind)
{
  const box = document.getElementById(`${kind}-box`);
  const items = settings[kind];
  box.innerHTML = items.length ? `
    <div class="table-scroll">
      <table class="table admin-table list-table">
        <thead>
  <tr>
  <th scope="col">Name</th>
  <th scope="col">Use</th>
  <th scope="col"><span class="visually-hidden">Actions</span></th>
  </tr>
  </thead>
        <tbody>${items.map((item) => listRow(kind, item)).join('')}</tbody>
      </table>
    </div>` : `<div class="placeholder-note">${LIST_TEXT[kind].empty}</div>`;
}

for (const kind of ['categories', 'locations'])
{
  document.getElementById(`${kind}-box`).addEventListener('click', async (event) =>
  {
    const edit = event.target.closest('[data-edit]');
    if (edit)
    {
      editing[kind] = Number(edit.dataset.edit);
      renderList(kind);
      document.getElementById(`edit-${kind}`).focus();
      return;
    }
    if (event.target.closest('[data-cancel]'))
    {
      editing[kind] = null;
      renderList(kind);
      return;
    }

    const save = event.target.closest('[data-save]');
    if (save)
    {
      const name = document.getElementById(`edit-${kind}`).value;
      editing[kind] = null;
      await perform(() => api(`/admin/settings/${kind}/${save.dataset.save}`,
        {
          method: 'PUT',
          body:
          {
            name
          }
        }),
        `${LIST_TEXT[kind].noun[0].toUpperCase()}${LIST_TEXT[kind].noun.slice(1)} renamed.`);
      return;
    }
    const remove = event.target.closest('[data-delete]');
    if (remove)
    {
      const item = settings[kind].find((row) => row.id === Number(remove.dataset.delete));
      const sure = await confirmDialog(
      {
        title: `Delete "${item.name}"?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!sure) return;
      await perform(() => api(`/admin/settings/${kind}/${item.id}`,
      {
        method: 'DELETE'
      }), `${LIST_TEXT[kind].noun} deleted.`);
    }
  });

  document.querySelector(`[data-add-form="${kind}"]`).addEventListener('submit', async (event) =>
  {
    event.preventDefault();
    const inputId = `new-${kind}`;
    const input = document.getElementById(inputId);
    setFieldError(inputId, null);
    try
    {
      await api(`/admin/settings/${kind}`,
      {
        method: 'POST',
        body:
        {
          name: input.value
        }
      });
      input.value = '';
      say(`${LIST_TEXT[kind].noun[0].toUpperCase()}${LIST_TEXT[kind].noun.slice(1)} added.`);
      await load();
    }
    catch (error)
    {
      setFieldError(inputId, error.fields?.name ?? error.message);
      input.focus();
    }
  });
}

// Default pickup hours
function hoursUnit(unit)
{
  const p = `hours-${unit.id}`;
  const days = DAYS.map(([value, label]) => `
    <label class="check"><input type="checkbox" value="${value}" ${unit.pickupDays.includes(value) ? 'checked' : ''}> ${label}</label>`).join('');
  const locations = settings.locations.map((loc) =>
    `<option value="${loc.id}" ${loc.id === unit.locationId ? 'selected' : ''}>${escapeHtml(loc.name)}</option>`).join('');
  return `
    <form class="hours-unit" data-unit="${unit.id}" novalidate>
      <h3>${escapeHtml(unit.name)}</h3>
      <fieldset class="form-fieldset">
        <legend>Pickup days <span class="form-field__hint">(none ticked means any day)</span></legend>
        <div class="check-group">${days}</div>
      </fieldset>
      <div class="hours-unit__grid">
        <div class="form-field">
          <label class="form-field__label" for="${p}-start">From</label>
          <input class="form-input" id="${p}-start" type="time" value="${unit.pickupStart ?? ''}" aria-describedby="${p}-start-error">
          <span class="form-field__error" id="${p}-start-error"></span>
        </div>
        <div class="form-field">
          <label class="form-field__label" for="${p}-end">Until</label>
          <input class="form-input" id="${p}-end" type="time" value="${unit.pickupEnd ?? ''}" aria-describedby="${p}-end-error">
          <span class="form-field__error" id="${p}-end-error"></span>
        </div>
        <div class="form-field">
          <label class="form-field__label" for="${p}-loc">Usual location</label>
          <select class="form-input" id="${p}-loc">
            <option value="">No usual location</option>${locations}
          </select>
        </div>
        <div class="form-field"><button class="button" type="submit">Save ${escapeHtml(unit.name)}</button></div>
      </div>
    </form>`;
}

function renderHours()
{
  document.getElementById('hours-box').innerHTML = settings.units.length ?
    settings.units.map(hoursUnit).join('') :
    '<div class="placeholder-note">No units yet. Add units on the administration page first.</div>';
}

document.getElementById('hours-box').addEventListener('submit', async (event) =>
{
  event.preventDefault();
  const form = event.target.closest('form[data-unit]');
  const unitId = Number(form.dataset.unit);
  const p = `hours-${unitId}`;
  const body =
  {
    pickupDays: [...form.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value),
    pickupStart: document.getElementById(`${p}-start`).value || null,
    pickupEnd: document.getElementById(`${p}-end`).value || null,
    locationId: document.getElementById(`${p}-loc`).value ? Number(document.getElementById(`${p}-loc`).value) : null,
  };
  setFieldError(`${p}-start`, null);
  setFieldError(`${p}-end`, null);
  try
  {
    await api(`/admin/settings/units/${unitId}/defaults`,
    {
      method: 'PUT',
      body
    });
    say('Pickup defaults saved.');
    await load();
  }
  catch (error)
  {
    if (error.fields?.pickupStart) setFieldError(`${p}-start`, error.fields.pickupStart);
    if (error.fields?.pickupEnd) setFieldError(`${p}-end`, error.fields.pickupEnd);
    say(error.fields?.pickupDays ?? error.fields?.locationId ?? error.message, true);
    document.getElementById(`${p}-start`).focus();
  }
});

// Approval rules
const thresholdField = document.getElementById('threshold-field');
const thresholdInput = document.getElementById('threshold');

function selectedMode()
{
  return document.querySelector('input[name="plan-mode"]:checked')?.value;
}

function syncThresholdVisibility()
{
  thresholdField.hidden = selectedMode() !== 'threshold';
}

function renderApprovals()
{
  const
  {
    organization
  } = settings;
  document.getElementById('review-requests').checked = organization.reviewRequests;
  document.getElementById('review-listings').checked = organization.reviewListings;
  document.querySelector(`input[name="plan-mode"][value="${organization.planApprovalMode}"]`).checked = true;
  thresholdInput.value = (organization.planApprovalThresholdCents / 100).toFixed(2);
  syncThresholdVisibility();
}

for (const radio of document.querySelectorAll('input[name="plan-mode"]'))
{
  radio.addEventListener('change', syncThresholdVisibility);
}

document.getElementById('approvals-form').addEventListener('submit', async (event) =>
{
  event.preventDefault();
  setFieldError('threshold', null);
  const mode = selectedMode();
  const dollars = Number(thresholdInput.value);
  if (mode === 'threshold' && (thresholdInput.value.trim() === '' || !Number.isFinite(dollars) || dollars < 0))
  {
    setFieldError('threshold', 'Enter an amount of $0 or more.');
    thresholdInput.focus();
    return;
  }
  try
  {
    await api('/admin/settings/approvals',
    {
      method: 'PUT',
      body:
      {
        reviewRequests: document.getElementById('review-requests').checked,
        reviewListings: document.getElementById('review-listings').checked,
        planApprovalMode: mode,
        planApprovalThresholdCents: mode === 'threshold' ? Math.round(dollars * 100) : undefined,
      },
    });
    say('Approval rules saved.');
    await load();
  }
  catch (error)
  {
    if (error.fields?.planApprovalThresholdCents) setFieldError('threshold', error.fields.planApprovalThresholdCents);
    say(error.message, true);
  }
});

// Start-up
const hashTab = document.getElementById(`tab-${window.location.hash.slice(1)}`);
if (hashTab) selectTab(hashTab);
load().catch((error) => say(error.message, true));
