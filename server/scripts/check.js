// ─────────────────────────────────────────────────────────────────────────────
// check.js — Pre-launch check (npm run check). Read-only: validates the
// configuration, database, folders and data the site needs, and prints what
// is missing. Exit code 1 when something blocks the launch.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, productionProblems } from '../src/config.js';
import { createPool } from '../src/db.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = m => console.log(`  ✓ ${m}`);
const warn = m => console.log(`  ! ${m}`);
const fail = m => { failed++; console.log(`  ✗ ${m}`); };

console.log('\nMaputo Blue — verificação antes de publicar\n');

const major = Number(process.versions.node.split('.')[0]);
major >= 22 ? ok(`Node.js ${process.versions.node}`) : fail(`Node.js ${process.versions.node}: é preciso a versão 22 ou superior`);

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  fail(e.message);
  process.exit(1);
}
if (cfg.env !== 'production') warn(`NODE_ENV=${cfg.env}: em produção use NODE_ENV=production`);
const problems = productionProblems(cfg);
problems.length ? problems.forEach(fail) : ok('Variáveis de produção (.env) preenchidas');
cfg.trustProxy ? ok('TRUST_PROXY activo (atrás de Caddy/IIS)') : warn('TRUST_PROXY=false: active-o se o site estiver atrás de Caddy ou IIS');
cfg.mail.resendApiKey ? ok('RESEND_API_KEY definido') : warn('RESEND_API_KEY vazio: os e-mails ficam na fila até ser configurado');
if (cfg.whatsapp.token || cfg.whatsapp.phoneNumberId) {
  cfg.whatsapp.token && cfg.whatsapp.phoneNumberId
    ? ok(`WhatsApp configurado (modelo ${cfg.whatsapp.template}, ${cfg.whatsapp.language})`)
    : fail('WhatsApp incompleto: defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID');
}
if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') warn(`HOST=${cfg.host}: em produção o Node deve escutar só em 127.0.0.1, atrás do proxy`);

// Folders the server writes to
for (const dir of [path.join(cfg.siteRoot, 'assets', 'images'), path.join(SERVER, '.cache'), path.join(cfg.siteRoot, 'backups')]) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    await fs.writeFile(probe, '');
    await fs.rm(probe);
    ok(`Escrita permitida em ${path.relative(cfg.siteRoot, dir)}`);
  } catch (e) {
    fail(`Sem permissão de escrita em ${dir} (${e.code})`);
  }
}
for (const f of ['DMSans-Regular.ttf', 'DMSans-Bold.ttf', 'DMSans-ExtraBold.ttf']) {
  try { await fs.access(path.join(SERVER, 'assets', 'fonts', f)); } catch { warn(`Fonte ${f} em falta: os PDFs usam Helvetica`); }
}

// Database
const pool = createPool(cfg.databaseUrl);
try {
  const enc = (await pool.query('show server_encoding')).rows[0].server_encoding;
  enc === 'UTF8' ? ok('PostgreSQL ligado (UTF8)') : fail(`A base de dados está em ${enc}; tem de ser UTF8`);

  const files = (await fs.readdir(path.join(SERVER, 'migrations'))).filter(f => /^\d+_.*\.sql$/.test(f));
  const applied = await pool.query('select version from schema_migrations').then(r => new Set(r.rows.map(x => x.version)), () => new Set());
  const pending = files.filter(f => !applied.has(f));
  pending.length ? warn(`Migrações pendentes (aplicam-se no arranque): ${pending.join(', ')}`) : ok('Migrações em dia');

  if (applied.size) {
    const one = async sql => (await pool.query(sql)).rows[0];
    const { n: admins } = await one(`select count(*)::int n from users where role = 'admin'`);
    admins ? ok(`${admins} administrador(es)`) : fail('Nenhum administrador: corra npm run create-admin');
    const { n: pkgs } = await one(`select count(*)::int n from packages`);
    pkgs ? ok(`${pkgs} pacotes no catálogo`) : fail('Catálogo vazio: corra npm run import:json');
    const { n: tests } = await one(`select count(*)::int n from users where email like '%@maputoblue.local' or email like '%@example.%'`);
    if (tests) warn(`${tests} conta(s) de teste (@maputoblue.local / @example) — remova-as antes de abrir ao público`);
  }
} catch (e) {
  fail(`Não foi possível ligar ao PostgreSQL: ${e.message}`);
} finally {
  await pool.end();
}

console.log(failed ? `\n${failed} problema(s) a resolver antes de publicar.\n` : '\nTudo pronto para arrancar.\n');
process.exit(failed ? 1 : 0);
