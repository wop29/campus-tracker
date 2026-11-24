// Generates the PWA icons (PNG, no dependencies): public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png.
// Usage: node scripts/make-icons.mjs   (re-run if you change the colors below; the PNGs are committed)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BG = [0x1a, 0x64, 0xb0], FG = [0xff, 0xf8, 0xe7];   // keep in sync with public/manifest.webmanifest
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) { const p = pixel(x, y); raw.set(p, y * (size * 4 + 1) + 1 + x * 4); }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inPoly = (poly, x, y) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r; } return r; };
// A mortarboard in unit coordinates
const CAP = [[[0.5, 0.26], [0.82, 0.42], [0.5, 0.58], [0.18, 0.42]], [[0.3, 0.52], [0.5, 0.62], [0.7, 0.52], [0.7, 0.68], [0.5, 0.78], [0.3, 0.68]]];
const SS = 3;
function icon(size, { maskable, rounded }) {
  const scale = maskable ? 0.78 : 1;                    // maskable icons keep the glyph inside the central safe zone
  const r = rounded ? 0.22 : 0;
  return png(size, (px, py) => {
    let fg = 0, inside = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
      if (dx * dx + dy * dy <= r * r) { inside++; const ux = (x - 0.5) / scale + 0.5, uy = (y - 0.5) / scale + 0.5; if (CAP.some((p) => inPoly(p, ux, uy))) fg++; }
    }
    const n = SS * SS, a = inside / n, f = inside ? fg / inside : 0;
    return [0, 1, 2].map((i) => Math.round(BG[i] * (1 - f) + FG[i] * f)).concat([Math.round(255 * a)]);
  });
}
const files = {
  'icon-192.png': icon(192, { rounded: true }), 'icon-512.png': icon(512, { rounded: true }),
  'maskable-512.png': icon(512, { maskable: true }), 'apple-touch-icon.png': icon(180, { maskable: true }),
};
for (const [name, buf] of Object.entries(files)) { writeFileSync(path.join(out, name), buf); console.log('wrote', name, buf.length, 'bytes'); }
