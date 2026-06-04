'use strict';

// Generates assets/icon.png — a rounded blue tile with a white envelope.
// No external deps: hand-rolled RGBA -> PNG (zlib + manual chunks/CRC).
// Run with: node scripts/make-icon.js

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const RADIUS = 56;
const BLUE = [0x00, 0x78, 0xd4];
const WHITE = [0xff, 0xff, 0xff];

function inRounded(x, y, w, h, r) {
  if (x >= r && x <= w - 1 - r) return true;
  if (y >= r && y <= h - 1 - r) return true;
  const cx = x < r ? r : w - 1 - r;
  const cy = y < r ? r : h - 1 - r;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Envelope: a rounded-ish body rectangle plus a "flap" (the two diagonals
// meeting at the centre top). Drawn as white pixels over the blue tile.
const L = 56, R = 200, T = 84, B = 172; // envelope bounds
const STROKE = 9;

function near(px, py, ax, ay, bx, by, w) {
  // distance from point (px,py) to segment (ax,ay)-(bx,by) <= w/2 ?
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy <= (w / 2) * (w / 2);
}

function isEnvelope(x, y) {
  const cx = (L + R) / 2;
  // Body outline (four edges).
  const onBody =
    near(x, y, L, T, R, T, STROKE) ||
    near(x, y, L, B, R, B, STROKE) ||
    near(x, y, L, T, L, B, STROKE) ||
    near(x, y, R, T, R, B, STROKE);
  // Flap: two diagonals from the top corners down to the centre.
  const onFlap =
    near(x, y, L, T, cx, T + 50, STROKE) ||
    near(x, y, R, T, cx, T + 50, STROKE);
  return onBody || onFlap;
}

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    if (!inRounded(x, y, SIZE, SIZE, RADIUS)) {
      px[i + 3] = 0; // transparent outside the tile
      continue;
    }
    const c = isEnvelope(x, y) ? WHITE : BLUE;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 0xff;
  }
}

// Raw image data: each scanline prefixed with a filter byte (0 = none).
const stride = SIZE * 4;
const raw = Buffer.alloc((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0;
  px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${SIZE}x${SIZE})`);
