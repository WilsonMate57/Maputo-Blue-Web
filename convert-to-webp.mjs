import sharp from 'sharp';
import heicConvert from 'heic-convert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, 'assets/images');
const LIXO_DIR = path.join(IMAGES_DIR, 'lixo');
const IMAGE_SKIP_DIRS = new Set(['lixo', 'trash']);
const CODE_SKIP_DIRS = new Set(['.git', 'node_modules']);
const CODE_SKIP_FILES = new Set(['convert-to-webp.mjs', 'serve.mjs']);
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic']);
const TEXT_EXTS = new Set(['.html', '.css', '.js', '.json']);

function findImages(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IMAGE_SKIP_DIRS.has(entry.name)) results.push(...findImages(fullPath));
      continue;
    }

    if (IMG_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

function moveOriginal(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  fs.renameSync(src, dest);
}

async function convertToWebp(src, webpDest) {
  const ext = path.extname(src).toLowerCase();

  try {
    await sharp(src).rotate().webp({ quality: 85 }).toFile(webpDest);
    return;
  } catch (err) {
    if (ext !== '.heic') throw err;
  }

  const inputBuffer = fs.readFileSync(src);
  const jpegBuffer = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.9
  });

  await sharp(Buffer.from(jpegBuffer)).rotate().webp({ quality: 85 }).toFile(webpDest);
}

async function convertAndMove() {
  const images = findImages(IMAGES_DIR);
  console.log(`\nFound ${images.length} images to convert...\n`);

  for (const src of images) {
    const rel = path.relative(IMAGES_DIR, src);
    const dir = path.dirname(rel);
    const stem = path.basename(src, path.extname(src));
    const webpDest = path.join(IMAGES_DIR, dir, `${stem}.webp`);
    const lixoDest = path.join(LIXO_DIR, rel);

    if (!fs.existsSync(webpDest)) {
      await convertToWebp(src, webpDest);
      console.log(`OK ${rel} -> ${stem}.webp`);
    } else {
      console.log(`SKIP ${rel} -> ${stem}.webp already exists`);
    }

    moveOriginal(src, lixoDest);
  }

  console.log('\nAll images converted. Updating code references...\n');
}

function replaceExts(content) {
  return content.replace(/\.(jpg|jpeg|png|heic)(?=['" \t\n,)\]>])/gi, '.webp');
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
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!CODE_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }

      if (
        !CODE_SKIP_FILES.has(entry.name) &&
        TEXT_EXTS.has(path.extname(entry.name).toLowerCase())
      ) {
        updateFile(fullPath);
      }
    }
  }

  walk(__dirname);
}

async function convertLogo() {
  const src = path.join(__dirname, 'logo.png');
  const dest = path.join(__dirname, 'logo.webp');
  const lixo = path.join(LIXO_DIR, 'logo.png');

  if (!fs.existsSync(src)) return;

  await sharp(src).webp({ quality: 90 }).toFile(dest);
  moveOriginal(src, lixo);
  console.log('OK logo.png -> logo.webp');
}

await convertAndMove();
await convertLogo();
updateCodeRefs();

console.log('\nDone. All supported images converted to .webp and originals moved to assets/images/lixo/\n');
