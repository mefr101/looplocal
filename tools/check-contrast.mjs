// Checks the contrast of every text/background and key UI color pair in public/css/tokens.css,
// in both the light and the dark theme. Run with: npm run check:contrast
//
// Text needs 4.5:1 (WCAG AA). Focus rings and other meaningful UI shapes need 3:1.
// Exits with an error if anything fails, so it can gate a release.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'public/css/tokens.css'), 'utf8');

/** Collect `--name: #hex;` (or `--name: var(--other);`) declarations from a block of CSS. */
function colors(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6}|var\(--[\w-]+\))\s*;/g)) out[name] = value;
  return out;
}

/** Follow var(--x) references until a hex value is reached. */
function resolve(tokens) {
  const result = {};
  for (const name of Object.keys(tokens)) {
    let value = tokens[name];
    for (let hops = 0; hops < 5 && value?.startsWith('var('); hops += 1) value = tokens[value.slice(4, -1)];
    if (value?.startsWith('#')) result[name] = value;
  }
  return result;
}

// Find a rule's body by its selector, however the braces are laid out.
function blockAfter(selectorPattern)
{
  const match = css.match(selectorPattern);
  if (!match) throw new Error('Could not find ' + selectorPattern + ' in tokens.css');
  const open = match.index + match[0].length;
  return css.slice(open, css.indexOf('}', open));
}

const rawLight = colors(blockAfter(/:root\s*\{/));
const light = resolve(rawLight);
const dark = resolve({ ...rawLight, ...colors(blockAfter(/:root\[data-theme="dark"\]\s*\{/)) });

function luminance(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio, what it is]
const PAIRS = [
  ['--color-text', '--color-page', 4.5, 'Body text on the page'],
  ['--color-text', '--color-surface', 4.5, 'Text on cards'],
  ['--color-text', '--color-surface-muted', 4.5, 'Text on table headers and panels'],
  ['--color-text', '--color-brand-tint', 4.5, 'Text on highlighted rows'],
  ['--color-text-muted', '--color-page', 4.5, 'Secondary text on the page'],
  ['--color-text-muted', '--color-surface', 4.5, 'Secondary text on cards'],
  ['--color-text-muted', '--color-surface-muted', 4.5, 'Secondary text on panels'],
  ['--color-link', '--color-page', 4.5, 'Links on the page'],
  ['--color-link', '--color-surface', 4.5, 'Links on cards'],
  ['--color-link', '--color-brand-tint', 4.5, 'Links on highlighted rows'],
  ['--color-on-brand', '--color-brand', 4.5, 'Button text'],
  ['--color-on-brand', '--color-secondary', 4.5, 'Success button text'],
  ['--color-on-danger', '--color-danger', 4.5, 'Danger button text'],
  ['--color-success', '--color-success-light', 4.5, 'Success badge / alert'],
  ['--color-warning', '--color-warning-light', 4.5, 'Warning badge / alert'],
  ['--color-danger', '--color-danger-light', 4.5, 'Danger badge / alert'],
  ['--color-info', '--color-info-light', 4.5, 'Info badge / alert'],
  ['--color-success', '--color-surface', 4.5, 'Success text on cards'],
  ['--color-danger', '--color-surface', 4.5, 'Error text on cards'],
  ['--color-danger', '--color-page', 4.5, 'Error text on the page'],
  ['--color-focus', '--color-page', 3, 'Focus ring on the page'],
  ['--color-focus', '--color-surface', 3, 'Focus ring on cards'],
  ['--color-link', '--color-page', 3, 'Chart line on the page'],
];

let failures = 0;
for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  console.log(`\n${theme.toUpperCase()} THEME`);
  for (const [fg, bg, min, label] of PAIRS) {
    if (!tokens[fg] || !tokens[bg])
    {
      failures += 1;
      console.log(`  FAIL  ${label}: could not read ${fg} or ${bg}`);
      continue;
    }
    const value = ratio(tokens[fg], tokens[bg]);
    const ok = value >= min;
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)}:1 (needs ${min})  ${label}  [${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}]`);
  }
}
console.log(failures ? `\n${failures} pair(s) fail.` : '\nAll pairs pass.');
process.exit(failures ? 1 : 0);
