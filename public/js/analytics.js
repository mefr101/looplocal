// Analytics page (admins only): estimated savings over time from completed hand-offs.
// layout.js keeps non-admins out (body data-requires="admin") and the server repeats the check.
//
// The chart is drawn by Chart.js (public/vendor/chart.umd.js). If the library is missing the page still
// works: the summary sentence, the tiles, and the table below carry the same numbers.
import
{
  api,
  formatMoney
} from './api.js';
import
{
  escapeHtml
} from './layout.js';

const select = document.getElementById('range');
const tiles = document.getElementById('tiles');
const summary = document.getElementById('chart-summary');
const tableBox = document.getElementById('savings-table');
const errorBox = document.getElementById('analytics-error');
const canvas = document.getElementById('savings-chart');

const POLL_MS = 15_000; // how often to look for newly completed hand-offs while the page is open
const updatedText = document.getElementById('updated');

let chart = null;
let lastData = null;
let lastJson = '';
let loading = false;

function cssVar(name)
{
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function periodLabel(bucket, granularity)
{
  const [year, month, day] = bucket.start.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return granularity === 'month' ?
    date.toLocaleDateString('en-US',
    {
      month: 'short',
      year: 'numeric'
    }) :
    `Week of ${date.toLocaleDateString('en-US', 
{ month: 'short', day: 'numeric' })}`;
}

function statCard(value, label, note = '')
{
  return `
    <div class="stat-card">
      <p class="stat-card__value">${value}</p>
      <p class="stat-card__label">${label}</p>
      ${note ? `<p class="stat-card__note">${note}</p>` : ''}
    </div>`;
}

function describe(data)
{
  const
  {
    buckets,
    totals,
    granularity
  } = data;
  if (totals.transfers === 0) return 'No completed hand-offs in this period yet, so there is nothing to chart.';
  const best = buckets.reduce((top, b) => (b.savingsCents > top.savingsCents ? b : top), buckets[0]);
  return `About ${formatMoney(totals.savingsCents)} estimated savings over ${buckets.length} ${granularity}${buckets.length === 1 ? '' : 's'}. ` +
    `The highest ${granularity} was ${periodLabel(best, granularity).toLowerCase()}, at about ${formatMoney(best.savingsCents)}.`;
}

function renderTiles(
{
  totals
})
{
  tiles.innerHTML = [
    statCard(formatMoney(totals.savingsCents), 'Estimated money saved', 'An estimate from listed replacement values.'),
    statCard(totals.transfers.toLocaleString('en-US'), 'Completed hand-offs'),
    statCard(totals.items.toLocaleString('en-US'), 'Items reused'),
  ].join('');
}

function renderTable(
{
  buckets,
  granularity,
  totals
})
{
  tableBox.innerHTML = `
    <div class="table-scroll">
      <table class="table">
        <caption class="visually-hidden">Estimated savings per ${granularity}</caption>
        <thead>
        <tr>
        <th scope="col">${granularity === 'month' ? 'Month' : 'Week'}</th>
        <th scope="col">Hand-offs</th>
          <th scope="col">Items</th>
        <th scope="col">Estimated savings</th>
        </tr>
        </thead>
        <tbody>${buckets.map((b) => `
          <tr>
        <th scope="row">${escapeHtml(periodLabel(b, granularity))}</th>
            <td class="mono">${b.transfers}</td>
            <td class="mono">${b.items.toLocaleString('en-US')}</td>
            <td class="mono">${formatMoney(b.savingsCents)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
            <tr>
            <th scope="row">Total</th>
            <td class="mono">${totals.transfers}</td>
          <td class="mono">${totals.items.toLocaleString('en-US')}</td>
          <td class="mono">${formatMoney(totals.savingsCents)}</td>
          </tr>
          </tfoot>
      </table>
    </div>`;
}

function renderChart(data)
{
  if (!window.Chart)
  {
    canvas.hidden = true;
    summary.textContent = `${describe(data)} (The chart could not load; see the table below.)`;
    return;
  }
  canvas.hidden = false;
  chart?.destroy();

  const line = cssVar('--color-link');
  const ink = cssVar('--color-text-muted');
  const grid = cssVar('--color-border');
  const surface = cssVar('--color-surface');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  chart = new window.Chart(canvas,
  {
    type: 'line',
    data:
    {
      labels: data.buckets.map((b) => periodLabel(b, data.granularity)),
      datasets: [
      {
        label: 'Estimated savings',
        data: data.buckets.map((b) => b.savingsCents / 100),
        borderColor: line,
        backgroundColor: line.startsWith("#") && line.length === 7 ? `${line}22` : "transparent",
        fill: true,
        borderWidth: 2,
        tension: 0,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: line,
        pointBorderColor: surface,
        pointBorderWidth: 2,
      }],
    },
    options:
    {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false :
      {
        duration: 400
      },
      interaction:
      {
        mode: 'index',
        intersect: false
      },
      plugins:
      {
        legend:
        {
          display: false
        }, // one series: the heading names it
        tooltip:
        {
          callbacks:
          {
            label: (context) => `About ${formatMoney(Math.round(context.parsed.y * 100))} saved (estimate)`,
          },
        },
      },
      scales:
      {
        x:
        {
          ticks:
          {
            color: ink,
            maxRotation: 0,
            autoSkip: true
          },
          grid:
          {
            display: false
          }
        },
        y:
        {
          beginAtZero: true,
          ticks:
          {
            color: ink,
            callback: (value) => formatMoney(Math.round(value * 100))
          },
          grid:
          {
            color: grid
          },
          title:
          {
            display: true,
            text: 'Estimated savings',
            color: ink
          },
        },
      },
    },
  });
}

function render(data)
{
  lastData = data;
  renderTiles(data);
  renderTable(data);
  summary.textContent = describe(data);
  renderChart(data);
}

/**
 * Fetch the numbers. A background refresh (silent) only redraws when something actually changed, so the
 * chart does not flicker and screen readers are not interrupted every few seconds.
 */
async function load(
{
  silent = false
} =
{})
{
  if (loading) return;
  loading = true;
  if (!silent) errorBox.hidden = true;
  try
  {
    const range = select.value;
    const data = await api(`/admin/analytics/savings?range=${encodeURIComponent(range)}`);
    if (range !== select.value) return; // the person changed the range while this was loading
    const json = JSON.stringify(data.buckets);
    if (!silent || json !== lastJson || !lastData)
    {
      render(data);
      lastJson = json;
    }
    errorBox.hidden = true;
    updatedText.textContent = `Last checked ${new Date().toLocaleTimeString('en-US', 
{ hour: 'numeric', minute: '2-digit', second: '2-digit' })}. This page updates itself when hand-offs are completed.`;
  }
  catch (error)
  {
    if (!silent)
    {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  }
  finally
  {
    loading = false;
  }
}

select.addEventListener('change', () =>
{
  lastJson = '';
  load();
});
document.getElementById('refresh').addEventListener('click', () => load());

// Keep the chart live: poll while the tab is visible, and catch up the moment the person comes back to it.
setInterval(() =>
{
  if (!document.hidden) load(
  {
    silent: true
  });
}, POLL_MS);
document.addEventListener('visibilitychange', () =>
{
  if (!document.hidden) load(
  {
    silent: true
  });
});

// Redraw with the right colors when the light/dark theme changes.
new MutationObserver(() =>
  {
    if (lastData) renderChart(lastData);
  })
  .observe(document.documentElement,
  {
    attributes: true,
    attributeFilter: ['data-theme']
  });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () =>
{
  if (lastData) renderChart(lastData);
});

load();
