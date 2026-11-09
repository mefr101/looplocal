// Header behavior. The header and footer HTML are already in every page
// (see tools/partials/ and `npm run sync-layout`), so they show even if this
// script fails. This file only:
//   1. marks the link for the current page,
//   2. reveals links/buttons that depend on who is signed in,
//   3. swaps the Sign in / Sign up buttons for the Account menu,
//   4. wires up the theme toggle and the phone menu button.
import { api } from './api.js';

const THEME_KEY = 'looplocal-theme';

// Escape user-supplied text before putting it into HTML.
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

export async function getCurrentUser() {
  try {
    return (await api('/auth/me')).user;
  } catch {
    return null; // server unreachable or signed out: show the signed-out header
  }
}

// --- Page-dependent bits ----------------------------------------------------

function markCurrentPage() {
  const file = window.location.pathname.split('/').pop() || 'index.html';
  const current = file.includes('.') ? file : `${file}.html`; // server also serves /resources
  // The logo is the only link to the home page, so nothing to highlight there.
  for (const link of document.querySelectorAll('.site-nav__link')) {
    if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'page');
  }
}

/**
 * Protects pages. A page opts in with <body data-requires="signedIn | publisher | admin">.
 * Visitors who do not qualify are sent away. (This only guides people; the real
 * protection is on the server, where every private API route checks the session.)
 */
function enforcePageAccess(user) {
  const needs = document.body.dataset.requires;
  if (!needs) return;

  if (!user) {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    window.location.replace(`login.html?next=${encodeURIComponent(file)}`);
    return;
  }
  const allowed = {
    signedIn: true,
    publisher: user.role === 'org_manager' || user.role === 'admin',
    admin: user.role === 'admin',
  };
  if (!allowed[needs]) window.location.replace('dashboard.html');
}

/** Show elements marked data-show="signedOut" | "signedIn" | "admin" | "publisher" when they apply. */
function revealForUser(user) {
  const allowed = {
    signedOut: !user,
    signedIn: Boolean(user),
    admin: user?.role === 'admin',
    publisher: user?.role === 'org_manager' || user?.role === 'admin',
  };
  for (const element of document.querySelectorAll('[data-show]')) {
    element.hidden = !allowed[element.dataset.show];
  }
}

function showAccountMenu(user) {
  if (!user) return;
  document.getElementById('auth-area').innerHTML = `
    <div class="account-menu">
      <button class="icon-button" type="button" id="account-toggle"
              aria-expanded="false" aria-controls="account-panel" aria-haspopup="true">
        Account <span aria-hidden="true">&#9662;</span>
      </button>
      <div class="account-menu__panel" id="account-panel" hidden>
        <div class="account-menu__who">
          <strong>${escapeHtml(user.name)}</strong>
          ${escapeHtml(user.organizationName)}
        </div>
        <a class="account-menu__item" href="account.html">Account information</a>
        <button class="account-menu__item" type="button" id="sign-out">Sign out</button>
      </div>
    </div>`;

  const toggle = document.getElementById('account-toggle');
  const panel = document.getElementById('account-panel');
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !event.target.closest('.account-menu')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); }
  });
  document.getElementById('sign-out').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = 'login.html?signedOut=1';
  });
}

// --- Behavior that works without a server -----------------------------------

const SUN = `<svg width="20" height="20" viewBox="0 0 20 20" focusable="false"><circle cx="10" cy="10" r="4" fill="currentColor"/>
  <path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1"
  stroke="currentColor" stroke-width="1.6"/></svg>`;
const MOON = `<svg width="20" height="20" viewBox="0 0 20 20" focusable="false">
  <path d="M16 11.5A7 7 0 0 1 8.5 4a7 7 0 1 0 7.5 7.5z" fill="currentColor"/></svg>`;

/** Which theme is showing right now: the saved choice, or else the device setting. */
function activeTheme() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setupThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');

  function refresh() {
    const dark = activeTheme() === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    icon.innerHTML = dark ? SUN : MOON; // show the mode you would switch TO
    label.textContent = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  button.addEventListener('click', () => {
    const next = activeTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: lasts this visit only */ }
    refresh();
  });
  refresh();
}

function setupMobileMenu() {
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('site-menu');
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// Wire up the buttons first (no server needed), then fetch who is signed in.
markCurrentPage();
setupThemeToggle();
setupMobileMenu();

const user = await getCurrentUser();
enforcePageAccess(user);
revealForUser(user);
showAccountMenu(user);
