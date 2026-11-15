#!/usr/bin/env node
// Render every storyboard panel's key frame from the real composition, and write the image paths back.
//   usage: node tools/panels.mjs <composition dir | piece dir | index.html> <storyboard.json> [--only id1,id2] [--format 16:9]
// Works with both renderers: product-native compositions (runtime/timeline.js, window.seek) and engine pieces
// (drawn styles, window.renderFrame). Images go to <storyboard dir>/panels/v<version>/pNN.jpg.
// With --only, the other panels' images are copied from the previous version (or kept as they are).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright, detectRenderer, frameAt } from './_pw.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean) || null;
const format = opt('--format');
const [src, sbFile] = args;
if (!src || !sbFile) { console.error('usage: node tools/panels.mjs <composition dir | index.html> <storyboard.json> [--only id1,id2] [--format F]'); process.exit(2); }

const SB = JSON.parse(fs.readFileSync(sbFile, 'utf8'));
const SBDIR = path.dirname(path.resolve(sbFile));
const html = src.endsWith('.html') ? src : path.join(src, 'index.html');
if (!fs.existsSync(html)) { console.error(`no ${html} (build the piece first: engine/tools/build.mjs for drawn styles)`); process.exit(1); }
const vdir = path.join(SBDIR, 'panels', `v${SB.version || 1}`);
fs.mkdirSync(vdir, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const probe = await browser.newPage();
const url = pathToFileURL(path.resolve(html)).href + '?export=1' + (format ? `&format=${encodeURIComponent(format)}` : '');
await probe.goto(url);
const { T } = await detectRenderer(probe);
await probe.close();
const page = await browser.newPage({ viewport: { width: T.width, height: T.height } });
page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(url);
const { kind } = await detectRenderer(page);

let rendered = 0, copied = 0;
for (const [i, p] of SB.panels.entries()) {
  const name = `p${String(i + 1).padStart(2, '0')}.jpg`, out = path.join(vdir, name);
  const rel = path.relative(SBDIR, out).split(path.sep).join('/');
  if (only && !only.includes(p.id)) {
    // keep the previous image for an untouched panel
    const prev = p.image && path.join(SBDIR, p.image);
    if (prev && fs.existsSync(prev)) {
      if (path.resolve(prev) !== path.resolve(out)) fs.copyFileSync(prev, out);
      p.image = rel; copied++;
      continue;
    }
    // no earlier image (a new panel): render it below
  }
  if (p.t == null) p.t = +(p.start + (p.end - p.start) * 0.7).toFixed(2);
  if (p.t > T.duration) console.warn(`warning: panel ${i + 1} (${p.id}) t=${p.t}s is past the piece's duration ${T.duration}s`);
  fs.writeFileSync(out, await frameAt(page, kind, T, p.t, { scale: kind === 'canvas' ? 0.5 : 1 }));
  p.image = rel; rendered++;
}
fs.writeFileSync(sbFile, JSON.stringify(SB, null, 2) + '\n');
console.log(`panels: ${rendered} rendered, ${copied} kept → ${vdir} (${kind} renderer, ${T.width}×${T.height})`);
await browser.close();
