// CCBox app icon generator — SDF-rendered, anti-aliased, no deps.
// Design: a radial burst of 12 elongated capsule ("petal") shapes radiating
// from the center. The two brand colors ALTERNATE petal-by-petal around the
// circle: even-indexed petals use GLM/BigModel's brand blue (#134CFF),
// odd-indexed petals use DeepSeek's brand blue (#4D6BFE).
// Output: src-tauri/icon-source.png (1024×1024 RGBA).
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const S = 1024;
const raw = Buffer.alloc((S * 4 + 1) * S);

// Brand colors.
const BIGMODEL = [19, 76, 255]; // #134CFF (BigModel / 智谱 official brand blue)
const DEEPSEEK = [77, 107, 254]; // #4D6BFE (DeepSeek official brand blue)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- SDF primitives ---------------------------------------------------------

// Rounded box (capsule-capable) SDF in *local* (unrotated) frame. Negative
// inside. hx/hy are the half-extents; rx<=hy produces a stadium/capsule.
function rboxL(lx, ly, hx, hy, rx) {
  const qx = Math.abs(lx) - (hx - rx);
  const qy = Math.abs(ly) - (hy - rx);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - rx;
}

// --- petal layout -----------------------------------------------------------
//
// 12 petals, one every 30°, each a long capsule whose long axis points outward
// along its own radial. The capsule is built in a local frame where +y is the
// outward direction, then rotated into place. Geometry (measured from the
// source mark at 1024 scale): petals span from near the center out to ~0.46*S
// radius; each capsule is ~0.13*S wide and ~0.42*S long.
const NP = 12;
const cx = S / 2;
const cy = S / 2;
const halfW = S * 0.065; // capsule half-width  -> width ~0.13·S
const halfH = S * 0.21; // capsule half-length -> length ~0.42·S
const capR = halfW; // corner radius = half-width => stadium (rounded ends)
// Offset the capsule so its outer tip sits at outerR and its inner end sits
// near the center, leaving a small clear hub.
const outerR = S * 0.46;
const innerGap = S * 0.04; // leave a small empty hole in the very center
const centerOff = innerGap + halfH; // local-y position of capsule center, along its radial

const AA = 1.5; // anti-alias edge width in px

// alpha-over composite (src over dst), all channels 0..1
function over(d, srgb, sa) {
  const oa = sa + d[3] * (1 - sa);
  if (oa <= 0) return [0, 0, 0, 0];
  return [
    (srgb[0] * sa + d[0] * d[3] * (1 - sa)) / oa,
    (srgb[1] * sa + d[1] * d[3] * (1 - sa)) / oa,
    (srgb[2] * sa + d[2] * d[3] * (1 - sa)) / oa,
    oa,
  ];
}

for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < S; x++) {
    const i = row + 1 + x * 4;
    let px = [0, 0, 0, 0];

    // test every petal; the closest one (most-negative SDF) wins coverage.
    let bestCov = 0;
    let bestColor = null;
    for (let k = 0; k < NP; k++) {
      const ang = (k / NP) * Math.PI * 2; // 0..2π, measured CCW from +x
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // translate so the capsule center sits along the petal's outward radial:
      const dx = x - (cx + ca * centerOff);
      const dy = y - (cy + sa * centerOff);
      // rotate (dx,dy) into the petal's local frame (local +y = outward):
      // local x =  dx·(-sin) + dy·cos ; local y = dx·cos + dy·sin
      const lx = -sa * dx + ca * dy;
      const ly = ca * dx + sa * dy;
      const sdf = rboxL(lx, ly, halfW, halfH, capR);
      const cov = clamp01(0.5 - sdf / AA);
      if (cov > bestCov) {
        bestCov = cov;
        // Alternating two colors petal-by-petal around the circle: even
        // petals = GLM/BigModel blue, odd petals = DeepSeek blue.
        bestColor = k % 2 === 0 ? BIGMODEL : DEEPSEEK;
      }
    }
    if (bestCov > 0 && bestColor) {
      px = over(px, bestColor.map((c) => c / 255), bestCov);
    }

    raw[i] = Math.round(px[0] * 255);
    raw[i + 1] = Math.round(px[1] * 255);
    raw[i + 2] = Math.round(px[2] * 255);
    raw[i + 3] = Math.round(px[3] * 255);
  }
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function chunk(type, data) {
  const tb = Buffer.from(type, "ascii");
  const crc = u32(zlib.crc32(Buffer.concat([tb, data])));
  return Buffer.concat([u32(data.length), tb, data, crc]);
}
const ihdr = Buffer.concat([u32(S), u32(S), Buffer.from([8, 6, 0, 0, 0])]);
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.resolve("src-tauri/icon-source.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
