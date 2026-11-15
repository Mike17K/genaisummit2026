#!/usr/bin/env node
// The style picker: every style's moving preview, numbered and labelled, as one looping grid video
// (style-reel.mp4) plus a page (picker.html, with the clips next to it) for when a video can't be sent.
//   usage: node tools/style-reel.mjs <out dir> [extra styles dirs...] [--cols 6] [--only a,b,c]
// Order and blurbs come from <skill-dir>/styles.json; a project's own styles (extra dirs with
// <name>/preview.mp4) are added at the end. Only ffmpeg is needed (no browser).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const COLS = Number(opt('cols', 6));
const ONLY = opt('only', null)?.split(',').map((s) => s.trim());
const [outDir, ...extra] = argv;
if (!outDir) { console.error('usage: node tools/style-reel.mjs <out dir> [extra styles dirs...] [--cols 6] [--only a,b]'); process.exit(2); }
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = JSON.parse(fs.readFileSync(path.join(SKILL, 'styles.json'), 'utf8'));

// where each style's preview lives
const where = (s) => ({
  'product-native': path.join(SKILL, 'assets/style-previews/product-native.mp4'),
  drawn: path.join(SKILL, 'engine/styles', s.name, 'preview.mp4'),
  motion: path.join(SKILL, 'motion-styles', s.name, 'preview.mp4'),
})[s.renderer];
let items = REG.styles.map((s) => ({ ...s, file: where(s) }));
for (const dir of extra.map((d) => path.resolve(d))) {
  if (!fs.existsSync(dir)) continue;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n, 'preview.mp4');
    if (fs.existsSync(f) && !items.some((i) => i.name === n)) items.push({ name: n, renderer: 'project', blurb: 'Your own style', file: f });
  }
}
if (ONLY) items = items.filter((i) => ONLY.includes(i.name));
const missing = items.filter((i) => !fs.existsSync(i.file));
missing.forEach((i) => console.warn(`no preview for ${i.name} (${path.relative(SKILL, i.file)}): render it with tools/style-preview.mjs`));
items = items.filter((i) => fs.existsSync(i.file));
if (!items.length) { console.error('no previews found'); process.exit(1); }
items.forEach((it, i) => { it.n = i + 1; });

fs.mkdirSync(path.join(outDir, 'clips'), { recursive: true });
const ff = (a) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' }); if (r.status !== 0) { console.error('ffmpeg failed'); process.exit(1); } };

// ---- grid video: tiles 240×426 + a 44px label, 6 s loop
const FONT = ['/config/browser/libs/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'].find((f) => fs.existsSync(f));
const TW = 240, TH = 426, LH = 44, DUR = 6;
const cols = Math.min(COLS, items.length), rows = Math.ceil(items.length / cols);
const inputs = [], chains = [], layout = [];
items.forEach((it, i) => {
  inputs.push('-stream_loop', '-1', '-t', String(DUR), '-i', it.file);
  const label = `${it.n}  ${it.name}`.replace(/[:']/g, '');
  const text = FONT ? `,drawtext=fontfile='${FONT}':text='${label}':x=12:y=${TH + 12}:fontsize=20:fontcolor=white` : '';
  chains.push(`[${i}:v]fps=30,scale=${TW}:${TH}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=black,pad=${TW}:${TH + LH}:0:0:color=0x1e1b19${text},setsar=1[t${i}]`);
  layout.push(`${(i % cols) * TW}_${Math.floor(i / cols) * (TH + LH)}`);
});
// fill the last row so xstack gets a full grid
const blanks = cols * rows - items.length;
for (let b = 0; b < blanks; b++) {
  const i = items.length + b;
  chains.push(`color=c=0x1e1b19:s=${TW}x${TH + LH}:d=${DUR}:r=30,setsar=1[t${i}]`);
  layout.push(`${(i % cols) * TW}_${Math.floor(i / cols) * (TH + LH)}`);
}
const n = items.length + blanks;
chains.push(`${Array.from({ length: n }, (_, i) => `[t${i}]`).join('')}xstack=inputs=${n}:layout=${layout.join('|')}:fill=0x1e1b19[out]`);
const reel = path.join(outDir, 'style-reel.mp4');
ff([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-t', String(DUR), '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', reel]);

// ---- picker page: the clips side by side, numbered, with what each is for
for (const it of items) fs.copyFileSync(it.file, path.join(outDir, 'clips', `${it.name}.mp4`));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// landscape previews (16:9 demos) get a wide card instead of a centre crop
// (ffmpeg -i prints the stream size on stderr; ffprobe isn't always installed)
const probe = (f) => (/Video:.*?(\d{2,5})x(\d{2,5})/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', f]).stderr?.toString() || '') || []).slice(1).map(Number);
for (const it of items) { const [w, h] = probe(it.file); it.wide = w > h; }
const card = (it) => `<figure${it.wide ? ' class="wide"' : ''}><div class="clip"><video src="clips/${esc(it.name)}.mp4" autoplay loop muted playsinline preload="metadata" aria-label="${esc(it.name)} preview"></video><span class="n">${it.n}</span></div><figcaption><b>${esc(it.name)}</b><span>${esc(it.blurb)}</span>${it.bestFor ? `<small>${esc(it.bestFor)}</small>` : ''}</figcaption></figure>`;
const groups = [['Your product', (i) => i.renderer === 'product-native', 'its real UI, animated'], ['Motion styles', (i) => i.renderer === 'motion', 'HTML + GSAP, can hold real UI'], ['Drawn styles', (i) => i.renderer === 'drawn', 'canvas, hand-made looks'], ['Your styles', (i) => i.renderer === 'project', 'saved from earlier videos']];
const html = `<title>Brag Style Picker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;600&display=swap">
<style>
/* layout: a contact sheet of moving 9:16 clips (16:9 ones span two columns), grouped by renderer, numbered for a one-word reply */
:root { --bg: #eef0f3; --fg: #15171c; --muted: #5b6170; --card: #ffffff; --line: #d9dde4; --accent: #e8452c;
  --display: "Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif; --body: Figtree, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101216; --fg: #eceef2; --muted: #9aa1ae; --card: #1a1d23; --line: #2b2f37; --accent: #ff6a4d; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #101216; --fg: #eceef2; --muted: #9aa1ae; --card: #1a1d23; --line: #2b2f37; --accent: #ff6a4d; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 15px/1.45 var(--body); }
main { max-width: 1180px; margin: 0 auto; padding-block: 28px 56px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1 { font: 800 clamp(28px, 6vw, 44px)/1.05 var(--display); letter-spacing: -0.02em; margin: 0 0 8px; text-wrap: balance; }
.lead { color: var(--muted); margin: 0 0 8px; max-width: 62ch; }
h2 { font: 600 13px/1 var(--body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 34px 0 12px; display: flex; gap: 10px; align-items: baseline; }
h2 span { font-weight: 400; letter-spacing: 0; text-transform: none; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
.clip { position: relative; aspect-ratio: 9 / 16; max-width: 100%; background: #000; }
figure.wide { grid-column: span 2; }
figure.wide .clip { aspect-ratio: 16 / 9; }
@media (max-width: 340px) { figure.wide { grid-column: auto; } }
.grid { align-items: start; }
video { width: 100%; height: 100%; object-fit: cover; display: block; }
.n { position: absolute; left: 8px; top: 8px; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 14px; background: var(--accent); color: #fff; font: 800 15px/28px var(--display); text-align: center; font-variant-numeric: tabular-nums; }
figcaption { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
figcaption b { font: 600 15px/1.2 var(--body); overflow-wrap: anywhere; }
figcaption span { font-size: 13px; }
figcaption small { color: var(--muted); font-size: 12px; }
</style>
<main>
<h1>Pick a style</h1>
<p class="lead">Every clip is a real render of the same Pantry demo. Reply with a number or a name, or two or three to compare. Send references instead for a custom look.</p>
${groups.map(([t, f, note]) => { const g = items.filter(f); return g.length ? `<h2>${t} <span>${note}</span></h2><div class="grid">${g.map(card).join('')}</div>` : ''; }).join('\n')}
</main>
<script>
// still frames for viewers who asked for less motion
if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('video').forEach((v) => { v.removeAttribute('autoplay'); v.pause(); v.controls = true; });
</script>`;
fs.writeFileSync(path.join(outDir, 'picker.html'), html);
console.log(`reel   ${reel} (${items.length} styles, ${cols}×${rows})\npicker ${path.join(outDir, 'picker.html')} + clips/`);
