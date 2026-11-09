// Sign-up form: loads organizations, submits, and shows any field errors the server returns.
import { api } from './api.js';

const form = document.getElementById('register-form');
const errorBox = document.getElementById('register-error');
const orgSelect = document.getElementById('organizationId');
const FIELDS = ['name', 'email', 'password', 'organizationId'];

async function loadOrganizations() {
  const { organizations } = await api('/meta/organizations');
  for (const org of organizations) orgSelect.add(new Option(org.name, org.id));
}

function clearErrors() {
  errorBox.hidden = true;
  for (const field of FIELDS) {
    document.getElementById(`${field}-error`).textContent = '';
    document.getElementById(field).removeAttribute('aria-invalid');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const data = Object.fromEntries(new FormData(form));
  data.organizationId = Number(data.organizationId);

  try {
    await api('/auth/register', { method: 'POST', body: data });
    window.location.href = 'dashboard.html';
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    let firstBad = null;
    for (const field of FIELDS) {
      if (!error.fields[field]) continue;
      document.getElementById(`${field}-error`).textContent = error.fields[field];
      const input = document.getElementById(field);
      input.setAttribute('aria-invalid', 'true');
      firstBad ??= input;
    }
    firstBad?.focus();
  }
});

loadOrganizations();
