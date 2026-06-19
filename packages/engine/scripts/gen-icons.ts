// Dev-only PWA/notification icon generator (V8 Phase 1.5). Renders the GlaudeCode "G" mark to PNG with
// PURE node (zlib + hand-rolled PNG chunks + CRC32) — NO native rasterizer dependency, so it runs
// anywhere and is fully reproducible. Run once; the PNG outputs are committed under vendor/ and served
// by the engine. The polished brand icon is a design follow-up; this is a clean, valid v1.
//
//   bun run packages/engine/scripts/gen-icons.ts
//
// Outputs: vendor/icon-192.png, vendor/icon-512.png, vendor/icon-512-maskable.png

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** Draw the dark "G" mark. `padFrac` shrinks the glyph for the maskable safe-zone. Crisp geometry
 *  (a ring with a right-side opening + a centre tongue) — recognisable at icon sizes. */
function drawG(size: number, padFrac: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const bg = [13, 17, 23];
  const fg = [88, 166, 255];
  const cx = size / 2;
  const cy = size / 2;
  const R = size * (0.34 - padFrac);
  const T = size * 0.105;
  const Ri = R - T;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx); // 0 = right, +ve = down (y-down)
      const inRing = dist >= Ri && dist <= R && !(ang > -0.18 && ang < 0.62); // opening on the lower-right
      const inTongue = Math.abs(dy) <= T / 2 && dx >= 0 && dx <= Ri + 1; // the G crossbar
      const c = inRing || inTongue ? fg : bg;
      rgba[i] = c[0]!;
      rgba[i + 1] = c[1]!;
      rgba[i + 2] = c[2]!;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const vendor = join(import.meta.dir, "..", "vendor");
mkdirSync(vendor, { recursive: true });
writeFileSync(join(vendor, "icon-192.png"), encodePng(192, 192, drawG(192, 0)));
writeFileSync(join(vendor, "icon-512.png"), encodePng(512, 512, drawG(512, 0)));
writeFileSync(join(vendor, "icon-512-maskable.png"), encodePng(512, 512, drawG(512, 0.08))); // safe-zone padding
console.log("wrote icon-192.png, icon-512.png, icon-512-maskable.png to", vendor);
