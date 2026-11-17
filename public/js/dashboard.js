// Dashboard page: loads statistics calculated by the server from database records.
import
{
  api,
  formatMoney
} from './api.js';
import
{
  escapeHtml
} from './layout.js';

const statsContainer = document.getElementById('stats');

function statCard(value, label, note = '')
{
  return `
    <div class="stat-card">
      <p class="stat-card__value">${value}</p>
      <p class="stat-card__label">${label}</p>
      ${note ? `<p class="stat-card__note">${note}</p>` : ''}
    </div>`;
}

async function loadStats()
{
  try
  {
    const stats = await api('/stats/dashboard');
    statsContainer.innerHTML = [
      statCard(stats.availableResources, 'Available resources'),
      statCard(stats.outstandingRequests, 'Outstanding requests'),
      statCard(stats.pendingApprovals, 'Pending approvals'),
      statCard(stats.completedTransfers, 'Completed transfers'),
      statCard(formatMoney(stats.estimatedSavingsCents), 'Estimated money saved',
        'Estimate based on listed replacement values of completed transfers.'),
    ].join('');
  }
  catch (error)
  {
    statsContainer.innerHTML = `<p class="alert alert--error" role="alert">${error.message}</p>`;
  }
}

const recentContainer = document.getElementById('recent');

async function loadRecent()
{
  try
  {
    const
    {
      reuse
    } = await api('/stats/recent');
    recentContainer.innerHTML = reuse.length ? `
      <ul class="request-list">${reuse.map((item) => `
        <li class="card">
          <strong>${item.quantity.toLocaleString('en-US')} &times; ${escapeHtml(item.resourceName)}</strong>
          from ${escapeHtml(item.supplierUnit)} to ${escapeHtml(item.receiverUnit)}
          <span class="card__meta">&middot; ${escapeHtml(item.completedAt.slice(0, 10))} &middot; about ${formatMoney(item.savingsCents)} saved (estimate)</span>
        </li>`).join('')}</ul>` :
      '<div class="placeholder-note">No completed hand-offs yet. They appear here once a transfer is marked done.</div>';
  }
  catch (error)
  {
    recentContainer.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

const matchesContainer = document.getElementById('matches');

/** One plain sentence about what the engine found for a request. */
function matchSentence(match)
{
  const from = match.sources.length ? ` from ${match.sources.map(escapeHtml).join(' and ')}` : '';
  if (match.covered === 0) return 'Nothing available can fill this right now.';
  if (match.complete) return `A plan covers all ${match.requested.toLocaleString('en-US')}${from}.`;
  const subs = match.substitutesAvailable ?
    ` Substitutes are available for ${match.shortfall.toLocaleString('en-US')} more.` : '';
  return `A plan covers ${match.covered.toLocaleString('en-US')} of ${match.requested.toLocaleString('en-US')}${from}.${subs}`;
}

async function loadMatches()
{
  try
  {
    const
    {
      matches,
      totalOpen
    } = await api('/matches');
    if (matches.length === 0)
    {
      matchesContainer.innerHTML = '<div class="placeholder-note">No open requests need matches right now. <a href="requests.html">Make a request</a> to see what is available.</div>';
      return;
    }
    matchesContainer.innerHTML = `<div class="grid">${matches.map((match) => `
      <article class="card">
        <h3 class="card__title">${escapeHtml(match.itemName)} <span class="card__meta">for ${escapeHtml(match.unitName)}</span></h3>
        <p>${matchSentence(match)}</p>
        <a class="button button--secondary" href="matches.html">Review plan</a>
      </article>`).join('')}</div>
      ${totalOpen > matches.length ? `<p class="card__meta">Showing ${matches.length} of ${totalOpen} open requests. <a href="matches.html">See all on Matches</a>.</p>` : ''}`;
  }
  catch (error)
  {
    matchesContainer.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

loadStats();
loadRecent();
loadMatches();
