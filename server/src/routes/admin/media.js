// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/media.js — Image library on the local disk (assets/images/).
// Uploads are decoded by sharp (so the real file type is verified, not the
// extension), auto-rotated, resized and stored as WebP. Existing files are
// never overwritten, and a file can only be deleted when no package uses it.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { tx } from '../../db.js';

const IMAGE_EXT = /\.(webp|jpe?g|png|avif)$/i;
const FOLDER_RE = /^[a-z0-9-]+(\/[a-z0-9-]+){0,3}$/;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff', 'gif']);
const EXCLUDED_DIRS = new Set(['lixo']);
const MAX_WIDTH = 2000;

const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';

/** 'assets/images/x.webp' ⇄ '../assets/images/x.webp' (the form stored in content). */
const toContentPath = p => '../' + p;
const fromAnyPath = p => String(p || '').replace(/^(\.\.\/|\.\/|\/)+/, '');

export default async function mediaRoutes(app) {
  const { pool, cfg } = app;
  const imagesRoot = path.join(cfg.siteRoot, 'assets', 'images');

  function safeDir(folder) {
    if (!FOLDER_RE.test(folder || '') || EXCLUDED_DIRS.has(folder.split('/')[0])) throw badRequest('invalid_folder');
    const dir = path.join(imagesRoot, ...folder.split('/'));
    if (!dir.startsWith(imagesRoot + path.sep)) throw badRequest('invalid_folder');
    return dir;
  }

  function safeFile(sitePath) {
    const rel = fromAnyPath(sitePath);
    if (!/^assets\/images\/[a-z0-9/_.-]+$/i.test(rel) || rel.includes('..') || !IMAGE_EXT.test(rel)) throw badRequest('invalid_path');
    return { rel, abs: path.join(cfg.siteRoot, ...rel.split('/')) };
  }

  /** Packages whose content/SEO references a file. */
  async function referencesOf(db, rel) {
    const variants = [rel, toContentPath(rel), '/' + rel, './' + rel];
    const { rows } = await db.query(
      `select id, coalesce(content->>'title', content->>'name') as title from packages
        where content->>'cover' = any($1) or seo->>'og_image' = any($1)
           or exists (select 1 from jsonb_array_elements_text(coalesce(content->'images','[]'::jsonb)) i where i = any($1))`, [variants]);
    let gallery = false;
    try { gallery = fs.readFileSync(path.join(cfg.siteRoot, 'data', 'gallery.json'), 'utf8').includes(rel); } catch { /* optional */ }
    return { packages: rows, gallery };
  }

  app.get('/media/folders', async () => {
    const out = [];
    const walk = (dir, rel, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || (depth === 0 && EXCLUDED_DIRS.has(e.name))) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        out.push(r);
        if (depth < 2) walk(path.join(dir, e.name), r, depth + 1);
      }
    };
    walk(imagesRoot, '', 0);
    return out.sort();
  });

  // Files of one folder (disk is the source of truth) + metadata + usage
  app.get('/media', { schema: { querystring: { type: 'object', required: ['folder'], properties: { folder: { type: 'string', maxLength: 120 } } } } }, async req => {
    const dir = safeDir(req.query.folder);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && IMAGE_EXT.test(e.name)).map(e => e.name).sort();
    const rels = files.map(f => `assets/images/${req.query.folder}/${f}`);
    const [{ rows: meta }, { rows: usage }] = await Promise.all([
      pool.query('select path, alt, alt_en, caption, caption_en, width, height, bytes, created_at, (uploaded_by is not null) as uploaded from media where path = any($1)', [rels]),
      pool.query(
        `select i as path, array_agg(distinct id) as packages from packages,
                lateral jsonb_array_elements_text(coalesce(content->'images','[]'::jsonb) || jsonb_build_array(coalesce(content->>'cover',''))) i
          group by i`),
    ]);
    const metaMap = new Map(meta.map(m => [m.path, m]));
    const useMap = new Map(usage.map(u => [fromAnyPath(u.path), u.packages]));
    return rels.map(rel => {
      const stat = fs.statSync(path.join(cfg.siteRoot, ...rel.split('/')));
      return { path: rel, content_path: toContentPath(rel), url: '/' + rel, bytes: stat.size, ...(metaMap.get(rel) || {}), used_by: useMap.get(rel) || [] };
    });
  });

  app.post('/media/upload', async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('multipart_required');
    let folder = null;
    const saved = [];
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'folder') folder = String(part.value);
        continue;
      }
      if (!folder) throw badRequest('folder_first', 'Send the "folder" field before the files');
      const dir = safeDir(folder);
      const buf = await part.toBuffer();
      if (part.file.truncated) throw badRequest('file_too_large', 'Maximum 12 MB per image');
      let meta;
      try { meta = await sharp(buf).metadata(); } catch { throw badRequest('invalid_image', `${part.filename}: not a valid image`); }
      if (!ACCEPTED_FORMATS.has(meta.format)) throw badRequest('invalid_image', `${part.filename}: unsupported format ${meta.format}`);
      if ((meta.width || 0) * (meta.height || 0) > 80e6) throw badRequest('invalid_image', 'Image dimensions too large');

      const out = await sharp(buf).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      await fsp.mkdir(dir, { recursive: true });
      const base = slugify(part.filename);
      let name = `${base}.webp`;
      for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}.webp`;
      await fsp.writeFile(path.join(dir, name), out.data, { flag: 'wx' });
      const rel = `assets/images/${folder}/${name}`;
      await pool.query(
        `insert into media (path, original_name, width, height, bytes, uploaded_by) values ($1,$2,$3,$4,$5,$6)
         on conflict (path) do nothing`, [rel, part.filename.slice(0, 200), out.info.width, out.info.height, out.info.size, req.user.id]);
      saved.push({ path: rel, content_path: toContentPath(rel), url: '/' + rel, width: out.info.width, height: out.info.height, bytes: out.info.size });
    }
    if (!saved.length) throw badRequest('no_files');
    await audit(pool, req.user, 'media', folder, 'uploaded', { files: saved.map(s => s.path) });
    reply.code(201);
    return saved;
  });

  app.patch('/media', {
    schema: { body: { type: 'object', required: ['path'], properties: {
      path: { type: 'string', maxLength: 300 }, alt: { type: ['string', 'null'], maxLength: 300 }, alt_en: { type: ['string', 'null'], maxLength: 300 },
      caption: { type: ['string', 'null'], maxLength: 300 }, caption_en: { type: ['string', 'null'], maxLength: 300 } } } },
  }, async req => {
    const { rel, abs } = safeFile(req.body.path);
    if (!fs.existsSync(abs)) throw notFound('file_not_found');
    const clean = v => (v === undefined ? undefined : v === null ? null : String(v).replace(/[<>]/g, ''));
    const b = { alt: clean(req.body.alt), alt_en: clean(req.body.alt_en), caption: clean(req.body.caption), caption_en: clean(req.body.caption_en) };
    const { rows: [m] } = await pool.query(
      `insert into media (path, alt, alt_en, caption, caption_en) values ($1,$2,$3,$4,$5)
       on conflict (path) do update set
         alt = coalesce($2, media.alt), alt_en = coalesce($3, media.alt_en),
         caption = coalesce($4, media.caption), caption_en = coalesce($5, media.caption_en)
       returning *`, [rel, b.alt ?? null, b.alt_en ?? null, b.caption ?? null, b.caption_en ?? null]);
    // Keep alt texts next to the package images so public pages can use them
    await pool.query(
      `update packages set content = jsonb_set(content, '{image_alts}', coalesce(content->'image_alts','{}'::jsonb) ||
              jsonb_build_object($1::text, jsonb_build_object('pt', $2::text, 'en', $3::text)))
        where content->'images' ? $1 or content->>'cover' = $1`, [toContentPath(rel), m.alt, m.alt_en]);
    return m;
  });

  // Replace every reference to one image with another (versioned package edits)
  app.post('/media/replace', {
    schema: { body: { type: 'object', required: ['old_path', 'new_path'], properties: {
      old_path: { type: 'string', maxLength: 300 }, new_path: { type: 'string', maxLength: 300 },
      package_ids: { type: 'array', items: { type: 'string', maxLength: 90 }, maxItems: 200 } } } },
  }, async req => {
    const oldF = safeFile(req.body.old_path), newF = safeFile(req.body.new_path);
    if (!fs.existsSync(newF.abs)) throw notFound('file_not_found', 'The new image does not exist');
    const from = toContentPath(oldF.rel), to = toContentPath(newF.rel);
    return tx(pool, async c => {
      const refs = await referencesOf(c, oldF.rel);
      const targets = refs.packages.map(p => p.id).filter(id => !req.body.package_ids || req.body.package_ids.includes(id));
      for (const id of targets) {
        const { rows: [p] } = await c.query('select content, seo from packages where id = $1 for update', [id]);
        const content = { ...p.content };
        if (Array.isArray(content.images)) content.images = content.images.map(i => (fromAnyPath(i) === oldF.rel ? to : i));
        if (content.cover && fromAnyPath(content.cover) === oldF.rel) content.cover = to;
        const seo = { ...p.seo };
        if (seo.og_image && fromAnyPath(seo.og_image) === oldF.rel) seo.og_image = to;
        await c.query('update packages set content=$2, seo=$3, version=version+1, updated_at=now(), updated_by=$4 where id=$1', [id, content, seo, req.user.id]);
        const { rows: [np] } = await c.query('select * from packages where id = $1', [id]);
        await c.query(`insert into package_revisions (package_id, version, snapshot, changed_by) values ($1,$2,$3,$4)`,
          [id, np.version, { via: `image replaced ${from} → ${to}`, status: np.status, category: np.category, featured: np.featured,
            promotional: np.promotional, sort_order: np.sort_order, content: np.content, pricing: np.pricing, availability: np.availability, seo: np.seo }, req.user.id]);
      }
      await audit(c, req.user, 'media', oldF.rel, 'replaced', { new_path: newF.rel, packages: targets });
      return { ok: true, packages: targets };
    });
  });

  // Delete only files uploaded through the dashboard that nothing references
  app.delete('/media', { schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', maxLength: 300 } } } } }, async req => {
    const { rel, abs } = safeFile(req.query.path);
    const { rows: [m] } = await pool.query('select * from media where path = $1', [rel]);
    if (!m || !m.uploaded_by) throw conflict('protected_file', 'Original site images cannot be deleted from the dashboard');
    const refs = await referencesOf(pool, rel);
    if (refs.packages.length || refs.gallery) throw conflict('file_in_use', 'This image is still used', refs);
    await fsp.unlink(abs).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await pool.query('delete from media where path = $1', [rel]);
    await audit(pool, req.user, 'media', rel, 'deleted', {});
    return { ok: true };
  });
}
