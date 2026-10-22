// ─────────────────────────────────────────────────────────────────────────────
// app.js — Builds the Fastify application (API + static site).
// ─────────────────────────────────────────────────────────────────────────────
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { AppError } from './lib/errors.js';
import { sessionHook } from './lib/auth.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import adminRoutes from './routes/admin/index.js';
import seoRoutes from './routes/seo.js';
import ticketRoutes from './routes/tickets.js';

// Only these top-level paths of the site folder are ever served.
const STATIC_ALLOW = /^\/(index\.html|logo\.webp|robots\.txt|sitemap\.xml|favicon\.ico|(assets|components|data|pages|en|admin)\/.*)?$/;
const NOINDEX = /^\/(api|admin)\/|^\/(pages|en)\/(account|booking-status|quote|ticket|verify)\.html/;

/**
 * Make every object schema that declares `properties` strip unknown keys
 * (unless it explicitly allows them). Clients therefore cannot smuggle extra
 * fields such as prices, totals or statuses into the API.
 */
function strict(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(strict);
  const out = { ...schema };
  if (out.properties) {
    if (out.additionalProperties === undefined) out.additionalProperties = false;
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, strict(v)]));
  }
  if (out.items) out.items = strict(out.items);
  return out;
}

export async function buildApp({ cfg, pool, mailTransport, logger = false }) {
  const app = Fastify({
    logger,
    trustProxy: cfg.trustProxy,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: false, allErrors: true } },
  });

  app.addHook('onRoute', route => {
    if (!route.schema) return;
    for (const part of ['body', 'querystring', 'params']) {
      if (route.schema[part]) route.schema[part] = strict(route.schema[part]);
    }
  });

  app.decorate('pool', pool);
  app.decorate('cfg', cfg);
  app.decorate('mailTransport', mailTransport);

  await app.register(cookie);
  // Per-route limits (see route configs); can be disabled for automated tests only
  await app.register(rateLimit, { global: false, allowList: () => !!cfg.disableRateLimit });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 20 } });

  app.addHook('onRequest', sessionHook(pool));

  // CSRF defence for cookie-authenticated API calls: state-changing requests
  // must come from our own origin and use JSON or multipart bodies
  // (cross-site HTML forms can do neither without a CORS preflight).
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin) {
      const allowed = new URL(cfg.publicBaseUrl).origin;
      const self = `${request.protocol}://${request.headers.host}`;
      if (origin !== allowed && origin !== self) {
        return reply.code(403).send({ error: 'bad_origin', message: 'Cross-origin request rejected' });
      }
    }
  });
  // Only JSON (built in) and multipart are accepted; dropping text/plain means a
  // cross-site "simple" form POST is answered with 415.
  app.removeContentTypeParser('text/plain');

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    const url = request.url.split('?')[0];
    if (NOINDEX.test(url)) reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (url.startsWith('/api/') || url.startsWith('/admin/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err.validation) {
      return reply.code(400).send({ error: 'validation', message: 'Invalid request', details: err.validation.map(v => `${v.instancePath || v.params?.missingProperty || ''} ${v.message}`.trim()) });
    }
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests, please try again later.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'bad_request', message: err.message });
    request.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Unexpected error. Please try again.' });
  });

  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(ticketRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(seoRoutes);

  app.all('/api/*', async (request, reply) => reply.code(404).send({ error: 'not_found' }));

  if (cfg.serveStatic) {
    await app.register(fastifyStatic, {
      root: cfg.siteRoot,
      index: ['index.html'],
      allowedPath: pathName => STATIC_ALLOW.test(pathName.replace(/\\/g, '/')) && !pathName.includes('..'),
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        const p = filePath.replace(/\\/g, '/');
        if (/\/assets\/images\//.test(p)) reply.header('Cache-Control', 'public, max-age=604800');
        else reply.header('Cache-Control', 'no-cache');
      },
    });
    app.get('/admin', (req, reply) => reply.redirect('/admin/'));
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      reply.code(404).type('text/html').send('<h1>404 — Página não encontrada</h1><p><a href="/">Maputo Blue</a></p>');
    });
  }
  return app;
}
