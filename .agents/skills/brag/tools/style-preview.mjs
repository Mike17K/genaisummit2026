#!/usr/bin/env node
// Render a style's demo into its picker preview (preview.mp4, 360×640 or the demo's aspect at 360 wide) and
// its still (sample.png, 540 wide; only written when missing or when --sample is given) for the gallery and reel.
//   usage: node tools/style-preview.mjs <style dir> [--sample <seconds>] [--workers 2]
// <style dir> is motion-styles/<name> (demo/index.html, product-native renderer) or engine/styles/<name>
// (demo piece, built with engine/tools/build.mjs first if it has no index.html).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const DIR = path.resolve(argv[0] || '');
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(DIR, 'demo');
if (!argv[0] || !fs.existsSync(demo)) { console.error('usage: node tools/style-preview.mjs <style dir with demo/> [--sample t]'); process.exit(2); }
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')}`); process.exit(1); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-preview-'));
const full = path.join(tmp, 'full.mp4');
const workers = opt('workers', '2');

if (fs.existsSync(path.join(demo, 'index.html')) && !fs.existsSync(path.join(demo, 'piece.json'))) {
  run('node', [path.join(SKILL, 'tools/export-dom.mjs'), demo, '--out', full, '--no-audio', '--workers', workers]);
} else {
  // engine piece: copy it out (export writes frames/renders next to it), build, export without audio
  const piece = path.join(tmp, 'piece');
  fs.cpSync(demo, piece, { recursive: true });
  run('node', [path.join(SKILL, 'engine/tools/build.mjs'), piece]);
  run('node', [path.join(SKILL, 'engine/tools/export.mjs'), piece, '--no-audio', '--no-captions', '--workers', workers]);
  const r = fs.readdirSync(path.join(piece, 'renders')).filter((f) => f.endsWith('.mp4')).map((f) => path.join(piece, 'renders', f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  fs.copyFileSync(r, full);
}
const ff = (a) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
ff(['-i', full, '-vf', 'scale=360:-2:flags=lanczos', '-an', '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(DIR, 'preview.mp4')]);
const t = opt('sample', null);
const dur = Number(spawnSync('ffmpeg', ['-i', full], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)?.slice(1).reduce((s, v, i) => s + Number(v) * [3600, 60, 1][i], 0) || 6);
if (t != null || !fs.existsSync(path.join(DIR, 'sample.png'))) ff(['-ss', String(t ?? (dur * 0.6).toFixed(2)), '-i', full, '-frames:v', '1', '-vf', 'scale=540:-2:flags=lanczos', path.join(DIR, 'sample.png')]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`preview ${path.join(DIR, 'preview.mp4')}\nsample  ${path.join(DIR, 'sample.png')}`);
