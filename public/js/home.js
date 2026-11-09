// Home page: fills in the public impact numbers from the database.
// Only totals from completed transfers are shown, and savings are labeled as estimates.
import { api, formatMoney } from './api.js';

async function loadImpact() {
  try {
    const stats = await api('/stats/public');
    document.getElementById('stat-items').textContent = stats.itemsReused.toLocaleString('en-US');
    document.getElementById('stat-transfers').textContent = stats.completedTransfers.toLocaleString('en-US');
    document.getElementById('stat-savings').textContent = formatMoney(stats.estimatedSavingsCents);
    document.getElementById('stat-orgs').textContent = stats.organizations.toLocaleString('en-US');
  } catch {
    // Leave the dashes in place if the server cannot be reached.
  }
}

loadImpact();
