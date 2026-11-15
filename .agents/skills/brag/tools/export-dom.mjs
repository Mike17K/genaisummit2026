#!/usr/bin/env node
// Render a product-native composition (HTML + runtime/timeline.js) to MP4: seek every frame, screenshot the stage,
// mix <composition>/audio.json with ffmpeg, mux.
//   usage: node tools/export-dom.mjs <composition dir> [--out brag.mp4] [--workers 4] [--from N] [--to N]
//                                    [--poster <seconds>] [--poster-out brag.jpg] [--no-audio] [--keep-frames]
// --poster t   also writes the frame at t as the poster (default <out>.jpg) and bakes it in as frame 0, so every
//              platform's idle thumbnail shows it (the frame is replaced, not added: duration and sync stay the same)
// Frames go to <composition>/../work/frames/ and are deleted after a successful mux unless --keep-frames.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadPlaywright, detectRenderer, frameAt } from './_pw.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const ROOT = path.resolve(argv[0] || '');
if (!argv[0] || !fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('usage: node tools/export-dom.mjs <composition dir> [--out brag.mp4] [--poster t]'); process.exit(2); }
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'brag.mp4')));
const WORK = path.join(path.dirname(OUT), 'work');
const FRAMES = path.join(WORK, 'frames');
const WORKERS = Math.max(1, Number(opt('workers', 4)));
const POSTER = opt('poster', null);
const POSTER_OUT = path.resolve(opt('poster-out', OUT.replace(/\.mp4$/i, '.jpg')));
const ff = (a) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: ['ignore', 'inherit', 'inherit'] }); if (r.status !== 0) { console.error('ffmpeg failed:', a.join(' ')); process.exit(1); } };

const { chromium } = loadPlaywright();
const url = pathToFileURL(path.join(ROOT, 'index.html')).href + '?export=1';
const browser = await chromium.launch();
const probe = await browser.newPage();
await probe.goto(url);
const { kind, T } = await detectRenderer(probe);
await probe.close();
if (kind !== 'dom') console.warn('note: this page uses the canvas renderer; engine/tools/export.mjs is the usual exporter for it');
const N = Math.round(T.duration * T.fps);
const from = Number(opt('from', 0)), to = Math.min(N, Number(opt('to', N)));
fs.mkdirSync(FRAMES, { recursive: true });
console.log(`export ${T.width}×${T.height} @ ${T.fps}fps, ${T.duration}s = ${N} frames (${from}–${to}), ${WORKERS} workers`);

// ---- frames
const t0 = Date.now();
let doneCount = 0;
async function worker(w) {
  const page = await browser.newPage({ viewport: { width: T.width, height: T.height } });
  page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto(url);
  await detectRenderer(page);
  for (let i = from + w; i < to; i += WORKERS) {
    fs.writeFileSync(path.join(FRAMES, `f${String(i).padStart(5, '0')}.png`), await frameAt(page, kind, T, i / T.fps, { type: 'png' }));
    if (++doneCount % 60 === 0) process.stdout.write(`  ${doneCount}/${to - from} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));

// ---- poster: render it, write the jpg, bake it as frame 0
if (POSTER != null) {
  const page = await browser.newPage({ viewport: { width: T.width, height: T.height } });
  await page.goto(url); await detectRenderer(page);
  const png = await frameAt(page, kind, T, Number(POSTER), { type: 'png' });
  await page.close();
  if (from === 0) fs.writeFileSync(path.join(FRAMES, 'f00000.png'), png);
  const tmp = path.join(WORK, 'poster.png'); fs.writeFileSync(tmp, png);
  ff(['-i', tmp, '-q:v', '2', POSTER_OUT]);
  console.log(`\nposter ${POSTER_OUT} (t=${POSTER}s, baked as frame 0)`);
}
await browser.close();
console.log(`\nframes done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (from !== 0 || to !== N) { console.log(`partial range: frames are in ${FRAMES}; not muxing`); process.exit(0); }

// ---- audio
const resolveFrom = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const AJ = path.join(ROOT, 'audio.json');
let audio = null;
if (!flag('no-audio') && fs.existsSync(AJ)) {
  const A = JSON.parse(fs.readFileSync(AJ, 'utf8'));
  const inputs = [], chains = [], mixes = [];
  const dur = T.duration.toFixed(3);
  let musicLabel = null, voiceLabel = null, nIn = 0;
  if (A.music?.file) {
    const m = A.music, i = nIn++;
    inputs.push('-ss', String(m.start || 0), '-i', resolveFrom(m.file));
    const fo = m.fadeOut ?? 1.5, fi = m.fadeIn ?? 0.05;
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur},asetpts=N/SR/TB,volume=${m.gain || 0}dB,afade=t=in:d=${fi},afade=t=out:st=${Math.max(0, T.duration - fo).toFixed(3)}:d=${fo}[mus]`);
    musicLabel = 'mus';
  }
  if (A.voice?.file) {
    const v = A.voice, i = nIn++;
    inputs.push('-i', resolveFrom(v.file));
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${v.gain || 0}dB,asplit=2[vo][vsc]`);
    voiceLabel = 'vo';
    if (musicLabel) {
      // duck the music under the voice: sidechain compression keyed by the voice
      const depth = Math.abs(v.musicUnderVoice ?? -10);
      const ratio = Math.min(20, 1 + depth / 2).toFixed(1);
      chains.push(`[${musicLabel}][vsc]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=20:release=300[musd]`);
      musicLabel = 'musd';
    } else chains.push('[vsc]anullsink');
  }
  (A.sfx || []).forEach((s, k) => {
    const i = nIn++, ms = Math.round((s.t || 0) * 1000);
    inputs.push('-i', resolveFrom(s.file));
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.gain ?? -6}dB,adelay=${ms}|${ms}[s${k}]`);
    mixes.push(`[s${k}]`);
  });
  if (musicLabel) mixes.unshift(`[${musicLabel}]`);
  if (voiceLabel) mixes.push(`[${voiceLabel}]`);
  if (mixes.length) {
    const lufs = A.lufs ?? -14;
    chains.push(`${mixes.join('')}amix=inputs=${mixes.length}:normalize=0:duration=longest,apad,atrim=0:${dur},loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000[out]`);
    audio = path.join(WORK, 'audio.wav');
    ff([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-ac', '2', audio]);
    console.log(`audio ${audio} (${mixes.length} source${mixes.length > 1 ? 's' : ''}, ${lufs} LUFS)`);
  }
}

// ---- mux
fs.mkdirSync(path.dirname(OUT), { recursive: true });
ff(['-framerate', String(T.fps), '-i', path.join(FRAMES, 'f%05d.png'), ...(audio ? ['-i', audio] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []), OUT]);
if (!flag('keep-frames')) fs.rmSync(FRAMES, { recursive: true, force: true });
console.log(`video ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
