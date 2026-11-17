// Finds CSS mistakes that are easy to make by accident. Run with: npm run check:css
//   1. The same selector defined in two places with different values (the later one silently wins).
//   2. Classes used in the pages or scripts that have no style at all (informational: some are structural hooks).
// Exits with an error only for (1).
import fs from 'node:fs';
const pub = 'public';
const cssFiles = fs.readdirSync(`${pub}/css`).filter((f) => f.endsWith('.css'));

// Parse top-level (non-@media) rules per file: selector -> { file, props }
const rules = [];
for (const f of cssFiles) {
  let css = fs.readFileSync(`${pub}/css/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove @media / @supports / @keyframes blocks (nested) so we only see unconditional rules.
  let out = '', depth = 0, inAt = false, atDepth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (!inAt && ch === '@') {
      const head = css.slice(i, css.indexOf('{', i));
      if (/^@(media|supports|keyframes|font-face|layer)/.test(head)) { inAt = true; atDepth = depth; }
    }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (inAt && depth === atDepth) { inAt = false; continue; } }
    if (!inAt) out += ch;
  }
  for (const m of out.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = {};
    for (const d of m[2].split(';')) { const [k, ...v] = d.split(':'); if (v.length) props[k.trim()] = v.join(':').trim(); }
    for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) rules.push({ sel, file: f, props });
  }
}
const bySel = new Map();
for (const r of rules) { if (!bySel.has(r.sel)) bySel.set(r.sel, []); bySel.get(r.sel).push(r); }

let conflictCount = 0;
console.log('=== SAME SELECTOR DEFINED MORE THAN ONCE WITH CONFLICTING VALUES ===');
for (const [sel, list] of bySel) {
  if (list.length < 2) continue;
  const conflicts = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    for (const k of Object.keys(list[i].props)) if (k in list[j].props && list[i].props[k] !== list[j].props[k]) {
      conflicts.push(`${k}: "${list[i].props[k]}" (${list[i].file}) vs "${list[j].props[k]}" (${list[j].file})`);
    }
  }
  if (conflicts.length) conflictCount += 1;
  if (conflicts.length) console.log(`${sel}\n   ${[...new Set(conflicts)].join('\n   ')}`);
}

// Classes used in HTML and JS vs defined
const defined = new Set();
for (const r of rules) for (const m of r.sel.matchAll(/\.([\w-]+)/g)) defined.add(m[1]);
const allCss = cssFiles.map((f) => fs.readFileSync(`${pub}/css/${f}`, 'utf8')).join('\n');
for (const m of allCss.matchAll(/\.([\w-]+)/g)) defined.add(m[1]);

const used = new Map();
const note = (c, where) => { if (!used.has(c)) used.set(c, new Set()); used.get(c).add(where); };
for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
  const html = fs.readFileSync(`${pub}/${f}`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/\sclass="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) note(c, f);
}
for (const f of fs.readdirSync(`${pub}/js`).filter((x) => x.endsWith('.js'))) {
  const js = fs.readFileSync(`${pub}/js/${f}`, 'utf8');
  for (const m of js.matchAll(/class(?:Name)?(?:=\?["']|\s*=\s*[`'"])([^"'`$]*?)["'`]/g)) for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) note(c, `js/${f}`);
}
console.log('\n=== CLASSES USED BUT NEVER STYLED ===');
for (const [c, where] of [...used].sort()) if (!defined.has(c)) console.log(`${c}   <- ${[...where].slice(0, 3).join(', ')}`);

console.log(conflictCount ? `\n${conflictCount} conflicting selector(s).` : '\nNo conflicting selectors.');
process.exit(conflictCount ? 1 : 0);
