const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "assets", "app-icon.svg");
const outputPath = path.join(root, "assets", "app-icon.ico");
const previewPath = path.join(root, "assets", "app-icon.png");
const sizes = [16, 24, 32, 48, 64, 128, 256];

function buildIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

(async () => {
  const source = fs.readFileSync(sourcePath);
  const images = await Promise.all(sizes.map(async (size) => ({
    size,
    png: await sharp(source).resize(size, size).png().toBuffer()
  })));

  fs.writeFileSync(outputPath, buildIco(images));
  fs.writeFileSync(previewPath, images[images.length - 1].png);
  console.log(`Windows icon created: ${outputPath}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
