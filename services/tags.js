// Tags are how the Rescue Engine decides that a request and a listing are "the same kind of thing".
// People type "Reusable Containers" while a listing is tagged "reusable-container", so both
// are normalized the same way before they are compared.
//
// Normalization rules (deterministic, no guessing):
//   1. lowercase
//   2. every run of characters other than a-z and 0-9 becomes a single space
//   3. each word is reduced to its singular form with the simple rules in singular()
//   4. words are joined with hyphens
//   "Reusable Containers!"  ->  "reusable-container"

const MAX_TAG_LENGTH = 60;

/** Very small singularizer: enough for supply names, not a full English grammar. */
function singular(word) {
  if (word.length <= 3) return word;                      // "bus", "ice"
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`; // "batteries" -> "battery"
  if (/(sses|ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2); // "boxes" -> "box"
  if (word.endsWith('ss') || word.endsWith('us')) return word; // "glass", "campus"
  if (word.endsWith('s')) return word.slice(0, -1);       // "containers" -> "container"
  return word;
}

export function normalizeTag(text) {
  if (typeof text !== 'string') return '';
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.map(singular).join('-').slice(0, MAX_TAG_LENGTH).replace(/-$/, '');
}

/** "reusable-container" -> "reusable container", for showing a tag to people. */
export function humanizeTag(tag) {
  return String(tag).replace(/-/g, ' ');
}
