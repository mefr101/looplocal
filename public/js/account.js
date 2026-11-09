// Account page: shows who is signed in. Sends signed-out visitors to the sign-in page.
import { api } from './api.js';
import { escapeHtml } from './layout.js';

const ROLE_LABELS = {
  member: 'Member (can browse and request)',
  org_manager: 'Organization manager (can also publish resources)',
  admin: 'Administrator (can review and approve)',
};

const details = document.getElementById('account-details');

async function loadAccount() {
  const { user } = await api('/auth/me');
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  details.innerHTML = `
    <dl class="detail-list">
      <dt>Name</dt><dd>${escapeHtml(user.name)}</dd>
      <dt>Email</dt><dd>${escapeHtml(user.email)}</dd>
      <dt>Organization</dt><dd>${escapeHtml(user.organizationName)}</dd>
      <dt>Role</dt><dd>${escapeHtml(ROLE_LABELS[user.role] ?? user.role)}</dd>
    </dl>
    <button class="button button--secondary" type="button" id="account-sign-out">Sign out</button>`;

  document.getElementById('account-sign-out').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html?signedOut=1';
  });
}

loadAccount().catch((error) => {
  details.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
});
