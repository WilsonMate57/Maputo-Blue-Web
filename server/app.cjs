// ─────────────────────────────────────────────────────────────────────────────
// app.cjs — Static site server for the Plesk Node.js extension (Passenger).
// This branch publishes the static site as it was before the booking platform.
// It uses the same Plesk settings as the platform (application root server/,
// startup file app.cjs, document root server/public), so switching between the
// two is only: Git → choose the branch → Deploy Now → Restart App.
// Only the public site folders are served; no database, no API, no secrets.
// ─────────────────────────────────────────────────────────────────────────────
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ALLOW = /^\/(index\.html|logo\.webp|robots\.txt|sitemap\.xml|favicon\.ico|(assets|components|data|pages|en)\/.+)$/;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.pdf': 'application/pdf',
};

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 — Página não encontrada</h1><p><a href="/">Maputo Blue</a></p>');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return notFound(res); }
  if (p === '/admin' || p.startsWith('/admin/')) { res.writeHead(302, { Location: '/' }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  if (p.includes('..') || p.includes('\0') || !ALLOW.test(p)) return notFound(res);
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = p.startsWith('/assets/images/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Maputo Blue (site estático) na porta', server.address().port));
