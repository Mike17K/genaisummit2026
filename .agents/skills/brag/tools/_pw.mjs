// Shared: load Playwright (local or global install) and detect which renderer a page uses.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { withFallback } from '../engine/tools/_launch.mjs';

const require = createRequire(import.meta.url);
export function loadPlaywright() {
  const pw = loadRaw();
  return { ...pw, chromium: withFallback(pw.chromium) };
}
function loadRaw() {
  try { return require('playwright'); } catch {
    try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch {
      console.error('Playwright is missing. Install it with:\n  npm i -g playwright && npx playwright install chromium');
      process.exit(2);
    }
  }
}

// Wait for a page to be ready and say how to draw a frame:
//   'canvas' — the engine (drawn styles): window.renderFrame(t, canvas) + window.TIMELINE
//   'dom'    — product-native: window.seek(t) from runtime/timeline.js, screenshot the #stage
export async function detectRenderer(page) {
  await page.waitForFunction(() => window.TIMELINE && (window.renderFrame || window.seek), null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const kind = await page.evaluate(() => (window.renderFrame ? 'canvas' : 'dom'));
  if (kind === 'dom') await page.evaluate(() => window.BRAG_READY);
  const T = await page.evaluate(() => ({ width: window.TIMELINE.width, height: window.TIMELINE.height, fps: window.TIMELINE.fps || 30, duration: window.TIMELINE.duration }));
  return { kind, T };
}

// One frame at time t as an image Buffer (jpeg or png).
export async function frameAt(page, kind, T, t, { type = 'jpeg', quality = 88, scale = 1 } = {}) {
  if (kind === 'canvas') {
    const url = await page.evaluate(([t, type, q, k]) => {
      const T = window.TIMELINE, c = document.createElement('canvas'); c.width = T.width; c.height = T.height;
      window.renderFrame(Math.round(t * T.fps) / T.fps, c);
      if (k === 1) return c.toDataURL('image/' + type, q / 100);
      const s = document.createElement('canvas'); s.width = Math.round(T.width * k); s.height = Math.round(T.height * k);
      const g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, s.width, s.height);
      return s.toDataURL('image/' + type, q / 100);
    }, [t, type, quality, scale]);
    return Buffer.from(url.split(',')[1], 'base64');
  }
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type, ...(type === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width: T.width, height: T.height }, scale: 'css' });
}
