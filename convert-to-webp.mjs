import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR  = path.join(__dirname, 'assets/images');
const LIXO_DIR    = path.join(IMAGES_DIR, 'lixo');
const SKIP_DIRS   = new Set(['lixo', 'trash']);
const IMG_EXTS    = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG', '.png', '.PNG']);

/* ── 1. Find all images ─────────────────────────────── */
function findImages(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) results.push(...findImages(path.join(dir, entry.name)));
    } else if (IMG_EXTS.has(path.extname(entry.name))) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

/* ── 2. Convert + move ──────────────────────────────── */
async function convertAndMove() {
  const images = findImages(IMAGES_DIR);
  console.log(`\nFound ${images.length} images to convert...\n`);

  for (const src of images) {
    const rel      = path.relative(IMAGES_DIR, src);
    const dir      = path.dirname(rel);
    const stem     = path.basename(src, path.extname(src));
    const webpDest = path.join(IMAGES_DIR, dir, stem + '.webp');
    const lixoDest = path.join(LIXO_DIR, rel);

    fs.mkdirSync(path.dirname(lixoDest), { recursive: true });

    await sharp(src).webp({ quality: 85 }).toFile(webpDest);
    fs.renameSync(src, lixoDest);
    console.log(`✓ ${rel}  →  ${stem}.webp`);
  }

  console.log('\nAll images converted. Updating code references...\n');
}

/* ── 3. Update file references ──────────────────────── */
function replaceExts(content) {
  return content
    .replace(/\.(jpg|jpeg|JPG|JPEG|png|PNG)(?=['" \t\n,)\]>])/g, '.webp');
}

function updateFile(filePath) {
  const orig = fs.readFileSync(filePath, 'utf8');
  const updated = replaceExts(orig);
  if (orig !== updated) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`  Updated refs: ${path.relative(__dirname, filePath)}`);
  }
}

function updateCodeRefs() {
  const targets = [
    ...['data/tours.json', 'data/accommodations.json', 'assets/css/main.css'].map(f => path.join(__dirname, f)),
    ...['index.html', 'en/index.html', 'en/tours.html', 'en/package.html',
        'pages/tours.html', 'pages/destinations.html', 'pages/accommodations.html',
        'pages/package.html', 'components/navbar.html', 'components/navbar-en.html',
        'components/footer.html', 'components/footer-en.html'].map(f => path.join(__dirname, f)),
    ...fs.readdirSync(path.join(__dirname, 'assets/js'))
        .map(f => path.join(__dirname, 'assets/js', f))
  ];

  for (const f of targets) {
    if (fs.existsSync(f)) updateFile(f);
  }
}

/* ── 4. Handle logo.png at root ─────────────────────── */
async function convertLogo() {
  const src  = path.join(__dirname, 'logo.png');
  const dest = path.join(__dirname, 'logo.webp');
  const lixo = path.join(__dirname, 'assets/images/lixo/logo.png');
  if (!fs.existsSync(src)) return;
  await sharp(src).webp({ quality: 90 }).toFile(dest);
  fs.renameSync(src, lixo);
  console.log('✓ logo.png  →  logo.webp');
}

/* ── Run ─────────────────────────────────────────────── */
await convertAndMove();
await convertLogo();
updateCodeRefs();

console.log('\n✅ Done! All images converted to .webp and originals moved to assets/images/lixo/\n');
