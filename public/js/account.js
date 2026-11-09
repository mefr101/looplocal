// Account page: shows who is signed in, their organization, and their units.
// layout.js already sends signed-out visitors to the sign-in page (body data-requires).
import { api } from './api.js';
import { escapeHtml } from './layout.js';

const details = document.getElementById('account-details');

function roleSummary(user) {
  if (user.isAdmin) return 'Organization admin: can approve requests, manage people and units, and see everything in the organization.';
  if (user.canPublish) return 'Unit manager: can publish and manage listings for the units you manage, and make requests.';
  return 'Member: can browse resources and make requests for your units.';
}

async function loadAccount() {
  const { user } = await api('/auth/me');
  if (!user) return; // layout.js is already redirecting

  const units = user.units.length
    ? `<ul class="plain-list">${user.units.map((unit) =>
      `<li>${escapeHtml(unit.name)} <span class="badge">${unit.role === 'manager' ? 'Manager' : 'Member'}</span></li>`).join('')}</ul>`
    : user.isAdmin ? 'All units (admins can act for any unit)'
      : 'None yet. Ask an organization admin to add you to a unit so you can make requests.';

  details.innerHTML = `
    <dl class="detail-list">
      <dt>Name</dt><dd>${escapeHtml(user.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(user.email)}</dd>
      <dt>Organization</dt><dd>${escapeHtml(user.organizationName)}</dd>
      <dt>Role</dt><dd>${escapeHtml(roleSummary(user))}</dd>
      <dt>Your units</dt><dd>${units}</dd>
    </dl>
    <button class="button button--secondary" type="button" id="account-sign-out">Sign out</button>`;

  document.getElementById('account-sign-out').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = 'login.html?signedOut=1';
  });
}

loadAccount().catch((error) => {
  details.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
});
