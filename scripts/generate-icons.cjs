/* Run with sharp installed: node scripts/generate-icons.cjs */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const directory = path.resolve(__dirname, '../assets/icons');
const source = path.join(directory, 'icon.svg');

async function generate() {
  const variants = [
    ['favicon-16.png', 16],
    ['favicon-32.png', 32],
    ['favicon-48.png', 48],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ];
  const images = new Map();
  for (const [name, size] of variants) {
    const png = await sharp(source).resize(size, size).flatten({ background: '#203c32' }).removeAlpha().png().toBuffer();
    await fs.writeFile(path.join(directory, name), png);
    images.set(size, png);
  }

  // ICO permits PNG frames; embed all three small sizes for legacy browsers.
  const sizes = [16, 32, 48];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  const frames = sizes.map((size, index) => {
    const png = images.get(size);
    const entry = 6 + index * 16;
    header[entry] = size;
    header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  await fs.writeFile(path.join(directory, 'favicon.ico'), Buffer.concat([header, ...frames]));
  console.log(`Generated ${variants.length} PNG icons and a 16/32/48px ICO.`);
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
