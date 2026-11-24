// Generates the app icons from Mochi's app icon art (public/art/empty/app-icon.webp) with sharp (installed with Next.js):
//   public/icons/icon-192.png, icon-512.png       rounded tile on transparent, purpose "any"
//   public/icons/maskable-512.png                 full bleed on #58C23A, art inside the 80% safe circle, purpose "maskable"
//   public/icons/apple-touch-icon.png (180)       full bleed on #58C23A (iOS rounds the corners itself)
//   app/icon.png (64)                             favicon
// Usage: node scripts/make-icons.mjs   (re-run if the art changes; the PNGs are committed)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const BG = '#58C23A';   // keep in sync with public/manifest.webmanifest (background_color) and the tile color of the art
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'public', 'art', 'empty', 'app-icon.webp');
const out = path.join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

// The art is a rounded green tile with a soft light rim and a little transparent margin. Trim the margin,
// and for the full bleed versions also shave the rim so the tile melts into the background.
const tile = await sharp(SRC).trim({ threshold: 1 }).toBuffer();
const { width: tw = 512 } = await sharp(tile).metadata();
const { height: th = 512 } = await sharp(tile).metadata();
// Cut a rounded rectangle just inside the tile's rim (corner radius of the art is about a quarter of its width).
const inset = Math.round(tw * 0.035), radius = Math.round(tw * 0.22);
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><rect x="${inset}" y="${inset}" width="${tw - 2 * inset}" height="${th - 2 * inset}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
const core = await sharp(tile).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

const plain = (size) => sharp(tile).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9, palette: true, quality: 92 });
async function bleed(size, scale) {
  const inner = Math.round(size * scale);
  const art = await sharp(core).resize(inner, inner, { fit: 'fill' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: art, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .flatten({ background: BG }).png({ compressionLevel: 9, palette: true, quality: 92 });
}

const files = [
  [path.join(out, 'icon-192.png'), plain(192)],
  [path.join(out, 'icon-512.png'), plain(512)],
  [path.join(out, 'maskable-512.png'), await bleed(512, 0.78)],   // Mochi stays inside the 80% safe circle
  [path.join(out, 'apple-touch-icon.png'), await bleed(180, 0.96)],
  [path.join(root, 'app', 'icon.png'), plain(64)],
];
for (const [file, img] of files) { const info = await img.toFile(file); console.log('wrote', path.relative(root, file), `${info.width}x${info.height}`, info.size, 'bytes'); }
