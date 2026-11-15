#!/usr/bin/env node
// Render every storyboard panel's key frame from the real composition, and write the image paths back.
//   usage: node tools/panels.mjs <composition dir | piece dir | index.html> <storyboard.json> [--only id1,id2] [--format 16:9] [--strip]
// Works with both renderers: product-native compositions (runtime/timeline.js, window.seek) and engine pieces
// (drawn styles, window.renderFrame). Images go to <storyboard dir>/panels/v<version>/pNN.jpg.
// With --only, the other panels' images are copied from the previous version (or kept as they are).
// --strip also writes pNN-strip.jpg: 6 frames from just after the panel starts to just before it ends, side by side,
// so the review shows the motion (entrance, hold, exit), not only the settled frame.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadPlaywright, detectRenderer, frameAt } from './_pw.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean) || null;
const format = opt('--format');
const STRIP = args.includes('--strip'); if (STRIP) args.splice(args.indexOf('--strip'), 1);
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
      const prevStrip = p.strip && path.join(SBDIR, p.strip), outStrip = out.replace(/\.jpg$/, '-strip.jpg');
      if (prevStrip && fs.existsSync(prevStrip)) { if (path.resolve(prevStrip) !== path.resolve(outStrip)) fs.copyFileSync(prevStrip, outStrip); p.strip = rel.replace(/\.jpg$/, '-strip.jpg'); }
      continue;
    }
    // no earlier image (a new panel): render it below
  }
  if (p.t == null) p.t = +(p.start + (p.end - p.start) * 0.7).toFixed(2);
  if (p.t > T.duration) console.warn(`warning: panel ${i + 1} (${p.id}) t=${p.t}s is past the piece's duration ${T.duration}s`);
  fs.writeFileSync(out, await frameAt(page, kind, T, p.t, { scale: kind === 'canvas' ? 0.5 : 1 }));
  p.image = rel; rendered++;
  if (STRIP) p.strip = await strip(p, out);
}
fs.writeFileSync(sbFile, JSON.stringify(SB, null, 2) + '\n');
console.log(`panels: ${rendered} rendered, ${copied} kept → ${vdir} (${kind} renderer, ${T.width}×${T.height})`);
await browser.close();

// 6 small frames across the panel, tiled into one jpg with ffmpeg
async function strip(p, out) {
  const tmp = fs.mkdtempSync(path.join(vdir, '.strip-'));
  const span = p.end - p.start, n = 6;
  for (let k = 0; k < n; k++) {
    const t = Math.min(T.duration - 0.001, p.start + 0.12 + (span - 0.24) * (k / (n - 1)));
    fs.writeFileSync(path.join(tmp, `s${k}.jpg`), await frameAt(page, kind, T, t, { scale: kind === 'canvas' ? 0.5 : 1 }));
  }
  const sout = out.replace(/\.jpg$/, '-strip.jpg');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(tmp, 's%d.jpg'), '-vf', `scale=480:-2,tile=${n}x1:padding=4`, '-frames:v', '1', '-q:v', '3', sout]);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) { console.warn(`strip failed for ${p.id} (is ffmpeg on PATH?)`); return undefined; }
  return path.relative(SBDIR, sout).split(path.sep).join('/');
}
