// ─────────────────────────────────────────────────────────────────────────────
// routes/images.js — Responsive image variants: /img/<width>/<site path>
// e.g. /img/800/assets/images/tours/x.webp → 800px-wide WebP, generated once
// with sharp and cached on disk (server/.cache/img). Originals are never
// modified. Only whitelisted widths and paths inside assets/images/ are served.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WIDTHS = new Set([400, 800, 1200, 1600]);
const PATH_RE = /^assets\/images\/[A-Za-z0-9/_.\- ()]+\.(webp|jpe?g|png|avif)$/i;
const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'img');
const inflight = new Map();

export default async function imageRoutes(app) {
  const { cfg } = app;
  const root = path.resolve(cfg.siteRoot);

  app.get('/img/:w/*', async (req, reply) => {
    const w = Number(req.params.w);
    const rel = decodeURIComponent(req.params['*'] || '');
    if (!WIDTHS.has(w) || !PATH_RE.test(rel) || rel.includes('..')) return reply.code(404).send();
    const src = path.join(root, ...rel.split('/'));
    if (!src.startsWith(root + path.sep) || !fs.existsSync(src)) return reply.code(404).send();
    const out = path.join(CACHE, String(w), rel.replace(/\.[a-z]+$/i, '.webp'));

    const stale = async () => !fs.existsSync(out) || (await fsp.stat(out)).mtimeMs < (await fsp.stat(src)).mtimeMs;
    if (await stale()) {
      // Coalesce concurrent requests for the same variant
      if (!inflight.has(out)) {
        inflight.set(out, (async () => {
          await fsp.mkdir(path.dirname(out), { recursive: true });
          const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
          // Read into memory: on Windows sharp keeps files it opened locked
          await sharp(await fsp.readFile(src)).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
          await fsp.rename(tmp, out);
        })().finally(() => inflight.delete(out)));
      }
      await inflight.get(out);
    }
    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=2592000');
    return reply.send(fs.createReadStream(out));
  });
}
