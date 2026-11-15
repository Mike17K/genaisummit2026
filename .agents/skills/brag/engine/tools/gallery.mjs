#!/usr/bin/env node
// Lay every style's sample.png side by side with its name — the intake gallery ("which of these, or show me a reference?").
//   usage: node tools/gallery.mjs <out.png> [extra styles dirs...] [--no-custom]
// The last tile is "custom": any other look, made from the user's references (new-style.md).
// Reads this skill's styles/*/sample.png, then any extra styles/ folders given (e.g. a project's own styles/).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFallback } from './_launch.mjs';
const require = createRequire(import.meta.url);
const { chromium: _chromiumRaw } = (() => { try { return require('playwright'); } catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } })();
const chromium = withFallback(_chromiumRaw);
const argv = process.argv.slice(2), noCustom = argv.includes('--no-custom');
const [out, ...extra] = argv.filter((a) => a !== '--no-custom' && a !== '--no-native');
if (!out) { console.error('usage: node tools/gallery.mjs <out.png> [extra styles dirs...]'); process.exit(2); }
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['cut-paper', 'crosshatch', 'riso', 'sketchbook', 'math', 'pixel', 'isometric'];
const items = [];
for (const dir of [path.join(SKILL, 'styles'), ...extra.map((d) => path.resolve(d))]) {
  if (!fs.existsSync(dir)) continue;
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'sample.png')));
  names.sort((a, b) => ((ORDER.indexOf(a) + 1) || 99) - ((ORDER.indexOf(b) + 1) || 99) || a.localeCompare(b));
  for (const n of names) if (!items.some((i) => i.name === n)) items.push({ name: n, url: 'data:image/png;base64,' + fs.readFileSync(path.join(dir, n, 'sample.png')).toString('base64') });
}
if (!items.length) { console.error('no styles/*/sample.png found'); process.exit(1); }
if (!noCustom) items.push({ name: 'custom', custom: true });
// brag: the product's own UI comes first
if (!argv.includes('--no-native')) items.unshift({ name: 'product-native', native: true });
const browser = await chromium.launch(), page = await browser.newPage();
const png = await page.evaluate(async (items) => {
  const PW = 270, PH = 480, GAP = 24, LAB = 52, cols = Math.min(items.length, 5), rows = Math.ceil(items.length / cols);
  const c = document.createElement('canvas'); c.width = GAP + cols * (PW + GAP); c.height = GAP + rows * (PH + LAB + GAP);
  const g = c.getContext('2d'); g.fillStyle = '#1e1b19'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < items.length; i++) {
    const x = GAP + (i % cols) * (PW + GAP), y = GAP + Math.floor(i / cols) * (PH + LAB + GAP);
    if (items[i].native) {   // brag: the product's own UI, animated (not a drawn style)
      const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
      const bg = g.createLinearGradient(x, y, x + PW, y + PH); bg.addColorStop(0, '#20232b'); bg.addColorStop(1, '#14161b');
      g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, PW, PH, 14); g.fill();
      const wx = x + 22, wy = y + 70, ww = PW - 44, wh = 250;   // a browser window
      g.fillStyle = '#f7f7f9'; g.beginPath(); g.roundRect(wx, wy, ww, wh, 10); g.fill();
      g.fillStyle = '#e4e5ea'; g.beginPath(); g.roundRect(wx, wy, ww, 26, [10, 10, 0, 0]); g.fill();
      ['#ff5f57', '#febc2e', '#28c840'].forEach((c, k) => { g.fillStyle = c; g.beginPath(); g.arc(wx + 14 + k * 14, wy + 13, 4.5, 0, 7); g.fill(); });
      g.fillStyle = '#1f2330'; g.font = `700 22px ${SANS}`; g.fillText('Your product', wx + 16, wy + 64);
      g.fillStyle = '#8a8fa0'; g.font = `400 13px ${SANS}`; g.fillText('real UI, copy, fonts and colours', wx + 16, wy + 86);
      g.fillStyle = '#4c6ef5'; g.beginPath(); g.roundRect(wx + 16, wy + 102, 96, 30, 8); g.fill();
      g.fillStyle = '#fff'; g.font = `600 13px ${SANS}`; g.fillText('Get started', wx + 28, wy + 122);
      [[0, '#dfe3f0'], [1, '#e9ecf4'], [2, '#e9ecf4']].forEach(([k, c]) => { g.fillStyle = c; g.beginPath(); g.roundRect(wx + 16 + k * 62, wy + 150, 54, 80, 6); g.fill(); });
      g.fillStyle = '#fff'; g.strokeStyle = '#1f2330'; g.lineWidth = 1.5;   // the cursor, clicking
      g.beginPath(); g.moveTo(wx + 100, wy + 118); g.lineTo(wx + 100, wy + 140); g.lineTo(wx + 106, wy + 134); g.lineTo(wx + 111, wy + 145); g.lineTo(wx + 115, wy + 143); g.lineTo(wx + 110, wy + 132); g.lineTo(wx + 118, wy + 132); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(76,110,245,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(wx + 100, wy + 118, 13, 0, 7); g.stroke();
      g.textAlign = 'center'; g.font = `700 26px ${SANS}`; g.fillStyle = '#f0b27c'; g.fillText('your real UI', x + PW / 2, y + 380);
      g.font = `400 18px ${SANS}`; g.fillStyle = '#c9cdd6';
      ['the product itself, animated:', 'cursor, clicks, typing,', 'push-ins and cuts'].forEach((l, k) => g.fillText(l, x + PW / 2, y + 414 + k * 24));
      g.textAlign = 'left';
    } else if (items[i].custom) {   // the open slot: any other look, from the user's references
      const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif', HANDF = '"Ink Free", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
      g.fillStyle = '#2a2420'; g.beginPath(); g.roundRect(x, y, PW, PH, 14); g.fill();
      g.save(); g.setLineDash([14, 10]); g.lineWidth = 3; g.strokeStyle = '#f0b27c'; g.beginPath(); g.roundRect(x + 8, y + 8, PW - 16, PH - 16, 10); g.stroke(); g.restore();
      g.textAlign = 'center';
      g.font = `700 230px ${HANDF}`; g.fillStyle = 'rgba(240,178,124,0.35)'; g.fillText('?', x + PW / 2 + 6, y + 236);
      g.fillStyle = '#efe5cf'; g.fillText('?', x + PW / 2, y + 230);
      g.font = `700 30px ${SANS}`; g.fillStyle = '#f0b27c'; g.fillText('your look', x + PW / 2, y + 300);
      g.font = `400 19px ${SANS}`; g.fillStyle = '#d9c9a8';
      ['show it a video, stills', 'or a web page:', 'it measures the style,', 'matches frames with you', 'and saves it to reuse'].forEach((l, k) => g.fillText(l, x + PW / 2, y + 344 + k * 26));
      g.textAlign = 'left';
    } else { const img = new Image(); img.src = items[i].url; await img.decode(); g.imageSmoothingQuality = 'high'; g.drawImage(img, x, y, PW, PH); }
    g.fillStyle = '#f0b27c'; g.font = '700 24px "Segoe UI", "Helvetica Neue", Arial, sans-serif'; g.fillText(`${i + 1}`, x, y + PH + 34);
    g.fillStyle = '#efe5cf'; g.font = '600 24px "Segoe UI", "Helvetica Neue", Arial, sans-serif'; g.fillText(items[i].name, x + 30, y + PH + 34);
  }
  return c.toDataURL('image/png').split(',')[1];
}, items);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(png, 'base64'));
console.log('gallery', out, items.map((i) => i.name).join(', '));
await browser.close();
