#!/usr/bin/env node
// Inventory a product's OWN motion, so the video moves its UI exactly as the app does (product-native.md → "The UI moves like the UI").
//   usage: node tools/ui-motion.mjs <project-dir | url> --out <composition>/ui-motion.js [--max-files 400]
// Reads the CSS (transitions, animations, @keyframes, duration/easing custom properties) and lists the JS that animates
// (.animate(), View Transitions, Framer Motion, GSAP, rAF) with file:line, for you to read. A URL is loaded in a headless
// browser and the CSS and JS it downloads are scanned the same way.
// Writes `window.UI_MOTION = {…}` (load it before motion.js: fx.ui and fx.uiAnim read it) and prints a short summary.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const out = opt('--out', null), maxFiles = Number(opt('--max-files', 400));
const src = args[0];
if (!src || !out) { console.error('usage: node tools/ui-motion.mjs <project-dir | url> --out <composition>/ui-motion.js'); process.exit(2); }

// ---- gather sources: [{ file, kind: 'css'|'js', text }]
const sources = [];
const CSS_EXT = /\.(css|scss|sass|less)$/i, JS_EXT = /\.(m?js|jsx|ts|tsx|svelte|vue|html?)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', 'design', 'brag']);
function walk(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (sources.length >= maxFiles) return;
    if (d.name.startsWith('.') && d.name !== '.') continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (!SKIP.has(d.name)) walk(p); continue; }
    if (/\.min\.(js|css)$/.test(d.name) || fs.statSync(p).size > 600_000) continue;
    if (CSS_EXT.test(d.name)) sources.push({ file: path.relative(src, p), kind: 'css', text: fs.readFileSync(p, 'utf8') });
    else if (JS_EXT.test(d.name)) {
      const text = fs.readFileSync(p, 'utf8');
      sources.push({ file: path.relative(src, p), kind: 'js', text });
      // <style> blocks and style="" in markup and components
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) sources.push({ file: path.relative(src, p) + ' <style>', kind: 'css', text: m[1] });
    }
  }
}
if (/^https?:\/\//.test(src)) {
  const { loadPlaywright } = await import('./_pw.mjs');
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pending = [];
    page.on('response', (r) => {
      const ct = (r.headers()['content-type'] || '').toLowerCase(), u = r.url();
      const kind = ct.includes('css') || /\.css(\?|$)/.test(u) ? 'css' : ct.includes('javascript') || /\.m?js(\?|$)/.test(u) ? 'js' : null;
      if (kind) pending.push(r.text().then((text) => sources.push({ file: u, kind, text })).catch(() => {}));
    });
    await page.goto(src, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(src, { waitUntil: 'load', timeout: 60000 }));
    await page.waitForTimeout(1500);
    await Promise.all(pending);
    const inline = await page.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'));
    sources.push({ file: src + ' <style>', kind: 'css', text: inline });
  } finally { await browser.close(); }
} else if (fs.statSync(src).isDirectory()) walk(src);
else sources.push({ file: path.basename(src), kind: CSS_EXT.test(src) ? 'css' : 'js', text: fs.readFileSync(src, 'utf8') });

// ---- CSS parsing (plain CSS and SCSS-style nesting, good enough for declarations we care about)
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
function blocks(css, base = 0) {
  const res = []; let depth = 0, start = 0, open = -1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') { if (depth === 0) open = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0) { res.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i), at: base + open }); start = i + 1; } if (depth < 0) depth = 0; }
    else if (c === ';' && depth === 0) start = i + 1;
  }
  return res;
}
function decls(body) {
  // top-level declarations only (nested blocks removed)
  let flat = '', depth = 0;
  for (const c of body) { if (c === '{') depth++; else if (c === '}') depth--; else if (depth === 0) flat += c; }
  const out = {};
  for (const d of flat.split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/, '').trim(); }
  return out;
}
const splitTop = (s, sep) => { const r = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === sep && d === 0) { r.push(cur); cur = ''; } else cur += c; } r.push(cur); return r.map((x) => x.trim()).filter(Boolean); };
const words = (s) => { const r = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (/\s/.test(c) && d === 0) { if (cur) r.push(cur); cur = ''; } else cur += c; } if (cur) r.push(cur); return r; };
const joinSel = (parent, child) => {
  if (!parent) return child;
  return splitTop(parent, ',').flatMap((p) => splitTop(child, ',').map((c) => (c.includes('&') ? c.replace(/&/g, p) : p + ' ' + c))).join(', ');
};

const vars = {};          // custom properties: --name → value (first definition wins, usually :root)
const rules = [];         // { selector, d: decls, file, line, media }
const keyframes = {};     // name → { file, line, frames }
function parse(css, file, text, base, parentSel, media) {
  for (const b of blocks(css, base)) {
    const p = b.prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/^@(-webkit-)?keyframes\s/i.test(p)) { const name = p.split(/\s+/)[1]; keyframes[name] ??= { file, line: lineAt(text, b.at), frames: b.body.replace(/\s+/g, ' ').trim().slice(0, 400) }; continue; }
    if (/^@(media|supports|layer|container|document)/i.test(p)) { parse(b.body, file, text, b.at + 1, parentSel, p.startsWith('@media') ? p : media); continue; }
    if (p.startsWith('@')) continue;
    const sel = joinSel(parentSel, p);
    const d = decls(b.body);
    for (const [k, v] of Object.entries(d)) if (k.startsWith('--') && !(k in vars)) vars[k] = v;
    rules.push({ selector: sel, d, file, line: lineAt(text, b.at), media });
    if (b.body.includes('{')) parse(b.body, file, text, b.at + 1, sel, media);
  }
}
for (const s of sources) if (s.kind === 'css' && s.text) parse(s.text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')), s.file, s.text, 0, '', null);

const resolve = (v, n = 0) => (n > 6 || !v ? v : v.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*(?:\([^)]*\))?[^()]*))?\)/g, (_, k, fb) => resolve(vars[k] ?? fb ?? '', n + 1)));
const secs = (t) => { const m = /^(-?[\d.]+)(m?s)$/.exec(t); return m ? Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) : null; };
const EASE = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$|^(cubic-bezier|steps|linear)\(/;
const ANIM_KW = /^(infinite|normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused)$/;

const transitions = [], animations = [];
const reduced = (m) => m && /prefers-reduced-motion\s*:\s*reduce/.test(m);
for (const r of rules) {
  if (reduced(r.media)) continue;
  const d = Object.fromEntries(Object.entries(r.d).map(([k, v]) => [k, resolve(v)]));
  const where = `${r.file}:${r.line}`, media = r.media || undefined;
  const sels = splitTop(r.selector, ',');
  // transitions: shorthand, then longhands override
  let items = d.transition && d.transition !== 'none' ? splitTop(d.transition, ',').map((it) => {
    const w = words(it), times = w.map(secs).filter((x) => x !== null);
    return { property: w.find((x) => secs(x) === null && !EASE.test(x)) || 'all', duration: times[0] ?? 0, delay: times[1] ?? 0, easing: w.find((x) => EASE.test(x)) || 'ease' };
  }) : [];
  if (d['transition-property'] || d['transition-duration']) {
    const props = splitTop(d['transition-property'] || 'all', ','), durs = splitTop(d['transition-duration'] || '0s', ','),
      eases = splitTop(d['transition-timing-function'] || 'ease', ','), dels = splitTop(d['transition-delay'] || '0s', ',');
    items = props.map((p, i) => ({ property: p, duration: secs(durs[i % durs.length]) ?? 0, delay: secs(dels[i % dels.length]) ?? 0, easing: eases[i % eases.length] }));
  }
  for (const it of items) if (it.duration > 0) for (const selector of sels) transitions.push({ selector, ...it, at: where, media });
  // animations
  const anim = d.animation && d.animation !== 'none' ? splitTop(d.animation, ',').map((it) => {
    const w = words(it), times = w.map(secs).filter((x) => x !== null);
    return { name: w.find((x) => secs(x) === null && !EASE.test(x) && !ANIM_KW.test(x) && !/^[\d.]+$/.test(x)), duration: times[0] ?? 0, delay: times[1] ?? 0,
      easing: w.find((x) => EASE.test(x)) || 'ease', iterations: w.find((x) => /^[\d.]+$/.test(x) || x === 'infinite') || '1',
      direction: w.find((x) => /^(reverse|alternate|alternate-reverse)$/.test(x)) || 'normal' };
  }) : d['animation-name'] && d['animation-name'] !== 'none' ? [{ name: d['animation-name'], duration: secs(d['animation-duration'] || '0s') ?? 0, delay: secs(d['animation-delay'] || '0s') ?? 0,
    easing: d['animation-timing-function'] || 'ease', iterations: d['animation-iteration-count'] || '1', direction: d['animation-direction'] || 'normal' }] : [];
  for (const a of anim) if (a.name && a.duration > 0) animations.push({ ...a, selector: r.selector, at: where, media, keyframes: keyframes[a.name] ? `${keyframes[a.name].file}:${keyframes[a.name].line}` : 'not found' });
}

// ---- JS that animates: list it with file:line for the model to read (not executed)
const JS_PATTERNS = [
  ['waapi', /\.animate\(\s*[[{]/], ['view-transition', /startViewTransition|view-transition-name/], ['framer-motion', /from ['"](framer-motion|motion\/react)['"]|<motion\.|transition=\{\{/],
  ['gsap', /\bgsap\.(to|from|fromTo|timeline)\(/], ['react-spring', /useSpring|useTransition\(/], ['raf', /requestAnimationFrame\(/], ['reduced-motion', /prefers-reduced-motion/],
  ['class-toggle', /classList\.(add|toggle)\(['"](open|show|active|visible|enter|leave|in|out|is-[\w-]+)['"]/],
];
const js = [];
for (const s of sources) {
  if (s.kind !== 'js' || !s.text) continue;
  const lines = s.text.split('\n');
  lines.forEach((l, i) => { if (l.length > 400) return; for (const [kind, re] of JS_PATTERNS) if (re.test(l)) { js.push({ kind, at: `${s.file}:${i + 1}`, code: l.trim().slice(0, 160) }); break; } });
}

const tokens = Object.fromEntries(Object.entries(vars).filter(([k, v]) => /dur|time|speed|ease|motion|transition|spring|delay/i.test(k) || /cubic-bezier|^\s*[\d.]+m?s\s*$/.test(v)).map(([k, v]) => [k, resolve(v)]));
const inventory = { source: src, made: new Date().toISOString().slice(0, 10), tokens, transitions, animations,
  keyframes: Object.fromEntries(Object.entries(keyframes).map(([k, v]) => [k, `${v.file}:${v.line}`])), js: js.slice(0, 120) };

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, `// The product's own motion, from tools/ui-motion.mjs (${src}). fx.ui / fx.uiAnim read it; edit by hand if a value is wrong.\nwindow.UI_MOTION = ${JSON.stringify(inventory, null, 1)};\n`);

const easeCount = {};
for (const t of transitions) easeCount[`${t.duration}s ${t.easing}`] = (easeCount[`${t.duration}s ${t.easing}`] || 0) + 1;
const top = Object.entries(easeCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(', ');
const jsKinds = Object.entries(js.reduce((m, j) => ((m[j.kind] = (m[j.kind] || 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`${sources.length} files scanned → ${out}`);
console.log(`transitions: ${transitions.length}${top ? ` (most used: ${top})` : ''}`);
console.log(`animations: ${animations.length}${animations.length ? ' (' + [...new Set(animations.map((a) => `${a.name} ${a.duration}s`))].slice(0, 8).join(', ') + ')' : ''}`);
console.log(`motion tokens: ${Object.keys(tokens).length ? Object.entries(tokens).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
console.log(`JS motion: ${jsKinds || 'none'}${js.length ? ' (read the listed lines: they hold the motion the CSS doesn\'t)' : ''}`);
if (!transitions.length && !animations.length && !js.some((j) => j.kind !== 'reduced-motion')) console.log('No motion found: the app changes state instantly, so the video must too.');
