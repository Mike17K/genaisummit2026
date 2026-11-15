#!/usr/bin/env node
// Serve the storyboard review page; write the user's feedback to disk and exit when they submit.
//   usage: node tools/review-server.mjs <storyboard dir> [--port 4517] [--timeout 240]
// Run it in the background: it prints `REVIEW <url>` when it's up and `FEEDBACK <path>` when the user submits,
// then exits 0, so whoever started it is woken by the exit. Also writes <storyboard dir>/index.html, a static copy
// of the page (it works offline too; without the server its button falls back to copying the feedback as text).
// Only files inside the storyboard dir are served, on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const PORT = Number(opt('--port', 4517));
const TIMEOUT_MIN = Number(opt('--timeout', 240));
const DIR = path.resolve(args[0] || '');
const SBFILE = path.join(DIR, 'storyboard.json');
if (!args[0] || !fs.existsSync(SBFILE)) { console.error('usage: node tools/review-server.mjs <storyboard dir containing storyboard.json>'); process.exit(2); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(path.join(HERE, 'review.html'), 'utf8');
const page = () => {
  const SB = JSON.parse(fs.readFileSync(SBFILE, 'utf8'));
  // </script> inside a string would end the script block early
  return TEMPLATE.replace('/*__STORYBOARD__*/null', JSON.stringify(SB).replace(/</g, '\\u003c'));
};
fs.writeFileSync(path.join(DIR, 'index.html'), page());

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
let done = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(page());
  }
  if (req.method === 'POST' && url.pathname === '/feedback') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let f;
      try { f = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
      const name = `${f.kind && f.kind !== 'storyboard' ? f.kind + '-' : ''}feedback-v${Number(f.version) || 1}.json`;
      const out = path.join(DIR, name);
      fs.writeFileSync(out, JSON.stringify(f, null, 2) + '\n');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      if (!done) {
        done = true;
        console.log(`FEEDBACK ${out}`);
        console.log(`DECISION ${f.decision}`);
        setTimeout(() => process.exit(0), 300);
      }
    });
    return;
  }
  if (req.method === 'GET') {
    const file = path.resolve(DIR, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(405); res.end();
});

function listen(port, tries = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 20) return listen(port + 1, tries + 1);
    console.error(e.message); process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const u = `http://127.0.0.1:${server.address().port}/`;
    fs.writeFileSync(path.join(DIR, 'review-url.txt'), u + '\n');
    console.log(`REVIEW ${u}`);
  });
}
listen(PORT);
setTimeout(() => { console.log('TIMEOUT no feedback received'); process.exit(3); }, TIMEOUT_MIN * 60 * 1000).unref();
