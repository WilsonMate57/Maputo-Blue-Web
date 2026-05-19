import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GALLERY_DIR = path.join(__dirname, 'assets/images/gallery');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);

const maxWidth = Number(args.get('max-width') || 1920);
const quality = Number(args.get('quality') || 78);
const minSizeKb = Number(args.get('min-size-kb') || 500);
const dryRun = args.has('dry-run');

if (!Number.isFinite(maxWidth) || maxWidth < 320) {
  throw new Error('--max-width must be a number greater than or equal to 320');
}

if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  throw new Error('--quality must be a number between 1 and 100');
}

if (!Number.isFinite(minSizeKb) || minSizeKb < 0) {
  throw new Error('--min-size-kb must be a number greater than or equal to 0');
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getGalleryImages() {
  return fs
    .readdirSync(GALLERY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.webp')
    .map((entry) => path.join(GALLERY_DIR, entry.name));
}

async function optimizeImage(filePath) {
  const input = fs.readFileSync(filePath);
  const before = input.length;
  const minSizeBytes = minSizeKb * 1024;

  if (before <= minSizeBytes) {
    const metadata = await sharp(input, { animated: false }).metadata();
    return {
      name: path.basename(filePath),
      before,
      after: before,
      width: metadata.width || 0,
      height: metadata.height || 0,
      changed: false,
      reason: `<= ${minSizeKb}KB`
    };
  }

  const image = sharp(input, { animated: false });
  const metadata = await image.metadata();

  const pipeline = image.rotate();
  if ((metadata.width || 0) > maxWidth) {
    pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  const output = await pipeline.webp({ quality, effort: 5 }).toBuffer();
  const after = output.length;

  if (!dryRun && after < before) {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, output);
    fs.renameSync(tmpPath, filePath);
  }

  return {
    name: path.basename(filePath),
    before,
    after,
    width: metadata.width || 0,
    height: metadata.height || 0,
    changed: after < before,
    reason: after < before ? '' : 'not smaller'
  };
}

const images = getGalleryImages();
let totalBefore = 0;
let totalAfter = 0;
let changedCount = 0;

console.log(`\nOptimizing ${images.length} gallery images`);
console.log(`Mode: ${dryRun ? 'dry-run' : 'write'} | max width: ${maxWidth}px | quality: ${quality} | min size: ${minSizeKb}KB\n`);

for (const imagePath of images) {
  const result = await optimizeImage(imagePath);
  totalBefore += result.before;
  totalAfter += result.changed ? result.after : result.before;
  if (result.changed) changedCount += 1;

  const saving = result.before - result.after;
  const status = result.changed ? 'OK' : 'SKIP';
  console.log(
    `${status} ${result.name} ` +
    `${result.width}x${result.height} ` +
    `${formatBytes(result.before)} -> ${formatBytes(result.changed ? result.after : result.before)} ` +
    `saved ${formatBytes(Math.max(saving, 0))}` +
    `${result.reason ? ` (${result.reason})` : ''}`
  );
}

console.log('\nSummary');
console.log(`Images changed: ${changedCount}/${images.length}`);
console.log(`Before: ${formatBytes(totalBefore)}`);
console.log(`After:  ${formatBytes(totalAfter)}`);
console.log(`Saved:  ${formatBytes(totalBefore - totalAfter)}\n`);
