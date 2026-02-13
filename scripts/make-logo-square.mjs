/**
 * Center-crops an image to a square and overwrites the file.
 * Usage: node scripts/make-logo-square.mjs <path-to-image>
 * Tauri icon generator requires a square source image.
 */
import sharp from "sharp";
import { unlinkSync } from "fs";
import { join, dirname, extname } from "path";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/make-logo-square.mjs <path-to-image>");
  process.exit(1);
}

const image = sharp(path);
const { width, height } = await image.metadata();
const size = Math.min(width, height);
const left = Math.floor((width - size) / 2);
const top = Math.floor((height - size) / 2);

const tmpPath = join(dirname(path), "logo-square-tmp" + extname(path));

await image
  .extract({ left, top, width: size, height: size })
  .toFile(tmpPath);

// Replace original with square version
const buf = await sharp(tmpPath).toBuffer();
await sharp(buf).toFile(path);
unlinkSync(tmpPath);

console.log(`Cropped to ${size}x${size} square: ${path}`);
