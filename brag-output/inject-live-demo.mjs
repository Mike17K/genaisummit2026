#!/usr/bin/env node
/**
 * inject-live-demo.mjs
 *
 * One-command compositor that injects a real-world camera demo video clip
 * (e.g. `real-demo.mp4` or `.mov`) directly inside the taped sketchbook
 * window (`P6_WIN = { x: 340, y: 215, w: 1240, h: 610 }`) during Era 5
 * (`38.6s - 52.8s`, preserving the shape-morph transitions at 38.2s and 53.5s),
 * and mixes the clip's live audio on top of the soundtrack (ducking the music
 * while the live demo plays).
 *
 * Usage:
 *   node brag-output/inject-live-demo.mjs <path/to/real-demo.mp4> [output.mp4]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [clipArg, outArg] = process.argv.slice(2);
if (!clipArg) {
  console.error('Usage: node brag-output/inject-live-demo.mjs <path/to/real-demo.mp4> [output.mp4]');
  process.exit(2);
}

const clipPath = path.resolve(clipArg);
if (!fs.existsSync(clipPath)) {
  console.error(`Error: live demo clip not found at ${clipPath}`);
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const baseVideo = path.join(rootDir, 'voxeye-sketchbook-story.mp4');
const outVideo = outArg
  ? path.resolve(outArg)
  : path.join(rootDir, 'voxeye-sketchbook-story-with-live-demo.mp4');

if (!fs.existsSync(baseVideo)) {
  console.error(`Error: base video not found at ${baseVideo}`);
  process.exit(1);
}

// Check whether the input clip has an audio stream
const probe = spawnSync('ffprobe', [
  '-v', 'error', '-select_streams', 'a',
  '-show_entries', 'stream=index', '-of', 'csv=p=0', clipPath
], { encoding: 'utf8' });
const hasClipAudio = probe.stdout.trim().length > 0;

// P6_WIN inner viewport inside 1920x1080 (leaving the hand-drawn ink border & corner tape strips visible!)
const WIN_X = 352;
const WIN_Y = 227;
const WIN_W = 1216;
const WIN_H = 586;
const T_START = 38.75;
const T_END = 52.75;
const DUR = +(T_END - T_START).toFixed(2);

const vFilter = [
  `[1:v]trim=0:${DUR},setpts=PTS-STARTPTS+${T_START}/TB,`,
  `scale=${WIN_W}:${WIN_H}:force_original_aspect_ratio=increase,`,
  `crop=${WIN_W}:${WIN_H},`,
  `format=yuva420p,`,
  `fade=t=in:st=${T_START}:d=0.35:alpha=1,`,
  `fade=t=out:st=${T_END - 0.35}:d=0.35:alpha=1[demo];`,
  `[0:v][demo]overlay=${WIN_X}:${WIN_Y}:enable='between(t,${T_START},${T_END})'[vout]`
].join('');

const aFilter = hasClipAudio
  ? [
      `[0:a]volume='if(between(t,${T_START},${T_END}),0.28,1.0)':eval=frame[basea];`,
      `[1:a]atrim=0:${DUR},asetpts=PTS-STARTPTS,adelay=${Math.round(T_START * 1000)}|${Math.round(T_START * 1000)},volume=1.35[demoa];`,
      `[basea][demoa]amix=inputs=2:normalize=0:duration=first[aout]`
    ].join('')
  : `[0:a]acopy[aout]`;

const filterComplex = `${vFilter};${aFilter}`;

console.log(`Compositing ${path.basename(clipPath)} into P6_WIN (${WIN_W}x${WIN_H} @ ${WIN_X},${WIN_Y}, ${T_START}s-${T_END}s)...`);
const res = spawnSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', baseVideo,
  '-stream_loop', '-1', '-i', clipPath,
  '-filter_complex', filterComplex,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  outVideo
], { stdio: 'inherit' });

if (res.status !== 0) {
  console.error('ffmpeg live-demo injection failed');
  process.exit(1);
}

console.log(`Wrote ${outVideo}`);
