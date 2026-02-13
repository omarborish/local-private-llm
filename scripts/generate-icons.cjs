/**
 * Generates a minimal valid icon.ico for Tauri Windows build.
 * Creates a 16x16 single-color icon (BMP format inside ICO).
 */
const fs = require("fs");
const path = require("path");

const iconsDir = path.join(__dirname, "..", "src-tauri", "icons");
fs.mkdirSync(iconsDir, { recursive: true });

// ICO header (6 bytes): reserved 0, type 1 (ICO), count 1
const header = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

// Image size: BITMAPINFOHEADER(40) + pixels(16*16*4) + AND mask(32) = 1096
const imageSize = 40 + 16 * 16 * 4 + 32;
// Directory entry (16 bytes)
const entry = Buffer.alloc(16);
entry[0] = 16;   // width
entry[1] = 16;   // height
entry[2] = 0;    // color count
entry[3] = 0;    // reserved
entry[4] = 1; entry[5] = 0;  // color planes
entry[6] = 32; entry[7] = 0; // bits per pixel
entry.writeUInt32LE(imageSize, 8);
entry.writeUInt32LE(22, 12);  // offset to image data

// BITMAPINFOHEADER (40 bytes)
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);   // header size
dib.writeInt32LE(16, 4);   // width
dib.writeInt32LE(32, 8);   // height (16*2 for BMP in ICO)
dib.writeUInt16LE(1, 12);  // planes
dib.writeUInt16LE(32, 14); // bit count
dib.writeUInt32LE(0, 16); // compression

// Pixels: 16x16 BGRA, bottom-up
const pixels = Buffer.alloc(16 * 16 * 4);
for (let i = 0; i < 16 * 16 * 4; i += 4) {
  pixels[i] = 0x36;
  pixels[i + 1] = 0x6f;
  pixels[i + 2] = 0xd1;
  pixels[i + 3] = 255;
}

// AND mask: 16 rows, 2 bytes per row
const mask = Buffer.alloc(32);

const ico = Buffer.concat([header, entry, dib, pixels, mask]);
fs.writeFileSync(path.join(iconsDir, "icon.ico"), ico);

console.log("Generated src-tauri/icons/icon.ico");
