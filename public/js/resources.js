// Resource Exchange page: search, filter, sort, and render listings.
import { api, formatMoney } from './api.js';
import { escapeHtml } from './layout.js';

const form = document.getElementById('filters');
const list = document.getElementById('resource-list');
const count = document.getElementById('result-count');
const categorySelect = document.getElementById('category');

/**
 * Link to the request form, pre-filled from this listing. Signed-out visitors are sent
 * to sign in first and then returned here with the same pre-fill.
 */
function requestLink(resource) {
  const params = new URLSearchParams({ category: resource.category_id });
  if (resource.primary_tag) {
    params.set('tag', resource.primary_tag);
    params.set('item', resource.primary_tag.replace(/-/g, ' ')); // "reusable-container" -> "reusable container"
  } else {
    params.set('item', resource.name);
  }
  return escapeHtml(`requests.html?${params}`);
}

function renderCard(resource) {
  const photo = resource.image
    ? `<img class="resource-card__photo" src="/uploads/${encodeURIComponent(resource.image)}" alt="${escapeHtml(resource.name)}">`
    : '<div class="resource-card__photo resource-card__photo--empty" role="img" aria-label="No photo provided">No photo yet</div>';

  return `
    <article class="card resource-card">
      ${photo}
      <div class="resource-card__body">
        <h2 class="card__title">${escapeHtml(resource.name)}</h2>
        <p class="card__meta">${escapeHtml(resource.unit_name)} &middot; ${escapeHtml(resource.location_name)}</p>
        <ul class="resource-card__facts">
          <li><span class="badge badge--info">${escapeHtml(resource.category_name)}</span></li>
          <li><span class="badge">${resource.quantity_available} available</span></li>
          <li><span class="badge badge--success">Condition: ${escapeHtml(resource.condition)}</span></li>
        </ul>
        <p class="resource-card__value">${formatMoney(resource.replacement_value_cents)} each (estimated)</p>
        <a class="button button--secondary resource-card__request" href="${requestLink(resource)}"
           aria-label="Request ${escapeHtml(resource.name)}">Request this</a>
      </div>
    </article>`;
}

async function loadResources() {
  const params = new URLSearchParams(new FormData(form));
  try {
    const { resources } = await api(`/resources?${params}`);
    count.textContent = `${resources.length} ${resources.length === 1 ? 'resource' : 'resources'} found`;
    list.innerHTML = resources.length
      ? resources.map(renderCard).join('')
      : '<p class="placeholder-note">No resources match those filters.</p>';
  } catch (error) {
    list.innerHTML = `<p class="alert alert--error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

async function loadCategories() {
  const { categories } = await api('/meta/categories');
  for (const category of categories) {
    categorySelect.add(new Option(category.name, category.id));
  }
}

// Re-run the search whenever a filter changes (with a short delay while typing).
let typingTimer;
form.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(loadResources, 250);
});
form.addEventListener('submit', (event) => { event.preventDefault(); loadResources(); });

await loadCategories();
loadResources();
