// Dashboard page: loads statistics calculated by the server from database records.
import { api, formatMoney } from './api.js';

const statsContainer = document.getElementById('stats');

function statCard(value, label, note = '') {
  return `
    <div class="stat-card">
      <p class="stat-card__value">${value}</p>
      <p class="stat-card__label">${label}</p>
      ${note ? `<p class="stat-card__note">${note}</p>` : ''}
    </div>`;
}

async function loadStats() {
  try {
    const stats = await api('/stats/dashboard');
    statsContainer.innerHTML = [
      statCard(stats.availableResources, 'Available resources'),
      statCard(stats.outstandingRequests, 'Outstanding requests'),
      statCard(stats.pendingApprovals, 'Pending approvals'),
      statCard(stats.completedTransfers, 'Completed transfers'),
      statCard(formatMoney(stats.estimatedSavingsCents), 'Estimated money saved',
        'Estimate based on listed replacement values of completed transfers.'),
    ].join('');
  } catch (error) {
    statsContainer.innerHTML = `<p class="alert alert--error" role="alert">${error.message}</p>`;
  }
}

loadStats();
