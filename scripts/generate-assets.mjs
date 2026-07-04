import { access, mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 96, 128];
const generatedIconNotice = "Using checked-in LootCheck icon assets.";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function drawIcon(size) {
  const scale = size / 128;
  const width = size;
  const height = size;
  const pixels = Buffer.alloc(width * height * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  }

  function inRoundedRect(px, py, x, y, w, h, radius) {
    const cx = Math.max(x + radius, Math.min(px, x + w - radius));
    const cy = Math.max(y + radius, Math.min(py, y + h - radius));
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const sx = ax + t * dx;
    const sy = ay + t * dy;
    return Math.hypot(px - sx, py - sy);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;
      let color = [15, 20, 18, 255];
      const gold = [217, 145, 43, 255];
      const brightGold = [255, 217, 121, 255];
      const dark = [23, 33, 31, 255];
      const green = [35, 190, 141, 255];
      if (inRoundedRect(ux, uy, 25, 31, 78, 36, 28)) color = gold;
      if (inRoundedRect(ux, uy, 36, 41, 56, 28, 18)) color = dark;
      if (inRoundedRect(ux, uy, 25, 60, 78, 45, 8)) color = dark;
      if (ux >= 25 && ux <= 103 && uy >= 60 && uy <= 73) color = gold;
      if ((ux >= 29 && ux <= 43 && uy >= 60 && uy <= 104) || (ux >= 85 && ux <= 99 && uy >= 60 && uy <= 104)) {
        color = gold;
      }
      if (ux >= 56 && ux <= 72 && uy >= 33 && uy <= 75) color = brightGold;
      if (inRoundedRect(ux, uy, 51, 53, 26, 24, 8)) color = gold;
      if ((ux - 64) * (ux - 64) + (uy - 64) * (uy - 64) < 25 || (ux >= 60 && ux <= 68 && uy >= 67 && uy <= 77)) {
        color = [15, 20, 18, 255];
      }
      const circleDistance = Math.hypot(ux - 64, uy - 82);
      if (circleDistance <= 31 && circleDistance >= 25) color = brightGold;
      if (circleDistance < 25) color = [16, 21, 19, 255];
      if (distToSegment(ux, uy, 50, 82, 60, 92) < 5 || distToSegment(ux, uy, 60, 92, 82, 68) < 5) {
        color = green;
      }
      setPixel(x, y, ...color);
    }
  }

  const scanlines = [];
  for (let y = 0; y < height; y += 1) {
    scanlines.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

await mkdir("src/assets/icons", { recursive: true });
const checkedInIconsReady = (
  await Promise.all(sizes.map((size) => exists(`src/assets/icons/icon-${size}.png`)))
).every(Boolean);

if (checkedInIconsReady) {
  console.log(generatedIconNotice);
} else {
  for (const size of sizes) {
    await writeFile(`src/assets/icons/icon-${size}.png`, drawIcon(size));
  }
}
