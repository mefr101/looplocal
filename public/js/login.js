// Sign-in form.
import { api } from './api.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const params = new URLSearchParams(window.location.search);

// Sign-out sends people here with ?signedOut=1 so we can confirm it worked.
if (params.has('signedOut')) {
  document.getElementById('signed-out-note').hidden = false;
}

/**
 * Where to go after signing in: the page they were trying to open (?next=matches.html),
 * or the dashboard. Only plain file names are accepted, so a crafted link can't
 * bounce someone to another website.
 */
function destinationAfterLogin() {
  const next = params.get('next');
  return next && /^[a-z0-9-]+\.html$/i.test(next) ? next : 'dashboard.html';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const data = Object.fromEntries(new FormData(form));

  try {
    await api('/auth/login', { method: 'POST', body: data });
    window.location.href = destinationAfterLogin();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});
