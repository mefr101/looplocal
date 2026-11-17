// Static accessibility checks for every page in public/. Run with: npm run check:a11y
//
// It reads the HTML text, so it cannot see content that JavaScript adds later (use the browser checklist in
// the README for that). It catches the mistakes that are easy to make and easy to miss:
//   one <h1>, a lang and a title, a <main>, a skip link, alt text on images, a label for every form control,
//   no skipped heading levels, no duplicate ids, no inline styles, table captions, links that open new tabs
//   safely, and no browser alert/confirm/prompt in the scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const problems = [];
const report = (file, message) => problems.push(`${file}: ${message}`);

for (const file of fs.readdirSync(publicDir).filter((name) => name.endsWith('.html')).sort()) {
  const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

  if (!/<html[^>]*\slang="[a-z]/.test(body)) report(file, 'the <html> tag needs a lang attribute');
  if (!/<title>[^<]+<\/title>/.test(body)) report(file, 'missing a <title>');
  if ((body.match(/<main[\s>]/g) ?? []).length !== 1) report(file, 'needs exactly one <main>');
  if (!/class="skip-link"/.test(body)) report(file, 'missing the skip link');
  if ((body.match(/<h1[\s>]/g) ?? []).length !== 1) report(file, 'needs exactly one <h1>');

  // Heading levels must not skip downward (h2 then h4).
  let previous = 0;
  for (const [, level] of body.matchAll(/<h([1-6])[\s>]/g)) {
    if (previous && Number(level) > previous + 1) report(file, `heading level jumps from h${previous} to h${level}`);
    previous = Number(level);
  }

  for (const [tag] of body.matchAll(/<img\b[^>]*>/g)) if (!/\salt=/.test(tag)) report(file, `image without alt text: ${tag.slice(0, 60)}`);

  // Every form control needs a label: label[for], a wrapping label, aria-label, or aria-labelledby.
  const labelFor = new Set([...body.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  const wrapped = [...body.matchAll(/<label\b[\s\S]*?<\/label>/g)].map((m) => m[0]);
  for (const [tag] of body.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    if (/type="(hidden|submit|button)"/.test(tag)) continue;
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    const inWrappedLabel = wrapped.some((label) => label.includes(tag));
    if (!(id && labelFor.has(id)) && !inWrappedLabel && !/aria-label(ledby)?=/.test(tag)) {
      report(file, `form control without a label: ${tag.slice(0, 70)}`);
    }
  }

  // Buttons and links need a name.
  for (const [, inner] of body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    if (!inner.replace(/<[^>]+>/g, '').trim() && !/aria-label|visually-hidden/.test(inner)) report(file, 'a <button> has no text');
  }

  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) report(file, `duplicate id "${id}"`);

  if (/\sstyle="/.test(body)) report(file, 'inline style attribute (move it into a CSS file)');
  for (const [table] of body.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    if (!/<caption/.test(table)) report(file, 'a table has no <caption>');
  }
  for (const [tag] of body.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(tag)) report(file, 'a target="_blank" link needs rel="noopener"');
  }
}

for (const file of fs.readdirSync(path.join(publicDir, 'js')).filter((name) => name.endsWith('.js')).sort()) {
  const code = fs.readFileSync(path.join(publicDir, 'js', file), 'utf8');
  if (/window\.(alert|confirm|prompt)\(|(^|[^.\w])(alert|confirm|prompt)\(/m.test(code.replace(/\/\/.*$/gm, ''))) {
    report(`js/${file}`, 'uses a browser alert/confirm/prompt (use js/dialog.js)');
  }
}

if (problems.length) {
  console.log(`${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('No problems found in public/*.html or public/js/*.js.');
