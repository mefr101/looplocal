// Sign-up. Two paths:
//   join:   check an organization's join code, pick your units, then make an account
//   create: start a brand-new organization and become its admin
// The server repeats every check; its answers are shown next to the fields.
import { api } from './api.js';
import { escapeHtml } from './layout.js';

const form = document.getElementById('register-form');
const errorBox = document.getElementById('register-error');
const joinSection = document.getElementById('join-section');
const createSection = document.getElementById('create-section');
const unitsSection = document.getElementById('units-section');
const personSection = document.getElementById('person-section');
const submitButton = document.getElementById('submit-button');
const FIELDS = ['joinCode', 'unitIds', 'organizationName', 'type', 'name', 'email', 'password'];

let verifiedCode = false; // true once the join code has been checked successfully

const mode = () => form.elements.mode.value;

function clearErrors() {
  errorBox.hidden = true;
  for (const field of FIELDS) {
    const span = document.getElementById(`${field}-error`);
    if (span) span.textContent = '';
    document.getElementById(field)?.removeAttribute('aria-invalid');
  }
}

function showFieldErrors(error) {
  errorBox.textContent = error.message;
  errorBox.hidden = false;
  let firstBad = null;
  for (const field of FIELDS) {
    const message = error.fields?.[field];
    if (!message) continue;
    document.getElementById(`${field}-error`).textContent = message;
    const input = document.getElementById(field);
    input?.setAttribute('aria-invalid', 'true');
    firstBad ??= input ?? document.querySelector(`#${field} input`);
  }
  firstBad?.focus();
}

/** Show the parts of the form that belong to the chosen path. */
function refresh() {
  const joining = mode() === 'join';
  joinSection.hidden = !joining;
  createSection.hidden = joining;
  // When joining, the personal details appear only after the code is verified.
  personSection.hidden = joining && !verifiedCode;
  submitButton.hidden = joining && !verifiedCode;
  submitButton.textContent = joining ? 'Join and create account' : 'Create organization and account';
}

for (const radio of form.elements.mode) radio.addEventListener('change', () => { clearErrors(); refresh(); });

// --- Join: check the code ---------------------------------------------------------

async function checkCode() {
  clearErrors();
  verifiedCode = false;
  unitsSection.hidden = true;
  const code = document.getElementById('joinCode').value.trim();
  try {
    const { organization, units } = await api(`/auth/join-code?code=${encodeURIComponent(code)}`);
    document.getElementById('joining-note').textContent = `You are joining ${organization.name}.`;
    document.getElementById('unitIds').innerHTML = units.map((unit) => `
      <label class="check"><input type="checkbox" name="unitIds" value="${unit.id}"> ${escapeHtml(unit.name)}</label>`).join('')
      || '<p class="form-field__hint">This organization has not added any units yet. Ask the admin to add one.</p>';
    unitsSection.hidden = false;
    verifiedCode = true;
  } catch (error) {
    showFieldErrors({ message: error.message, fields: { joinCode: error.message } });
  }
  refresh();
}

document.getElementById('check-code').addEventListener('click', checkCode);
// Pressing Enter in the code box checks the code instead of submitting the whole form.
document.getElementById('joinCode').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); checkCode(); }
});
// Changing the code means it must be checked again.
document.getElementById('joinCode').addEventListener('input', () => {
  if (verifiedCode) { verifiedCode = false; unitsSection.hidden = true; refresh(); }
});

// --- Submit -----------------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const person = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
  };
  submitButton.disabled = true;
  try {
    if (mode() === 'join') {
      const unitIds = [...form.querySelectorAll('input[name="unitIds"]:checked')].map((box) => Number(box.value));
      await api('/auth/register', {
        method: 'POST',
        body: { ...person, joinCode: document.getElementById('joinCode').value.trim(), unitIds },
      });
      window.location.href = 'dashboard.html';
    } else {
      await api('/auth/register-organization', {
        method: 'POST',
        body: {
          ...person,
          organizationName: document.getElementById('organizationName').value.trim(),
          type: document.getElementById('type').value,
        },
      });
      window.location.href = 'admin.html?welcome=1'; // next steps: add units and share the join code
    }
  } catch (error) {
    submitButton.disabled = false;
    showFieldErrors(error);
  }
});

refresh();
