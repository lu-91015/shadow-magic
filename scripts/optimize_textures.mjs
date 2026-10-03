import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const dir = 'public/models/tex';
const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
let saved = 0;
for (const f of files) {
  const fp = path.join(dir, f);
  const before = fs.statSync(fp).size;
  const img = sharp(fp);
  const meta = await img.metadata();
  const long = Math.max(meta.width || 0, meta.height || 0);
  let pipe = img;
  if (long > 1024) {
    pipe = img.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true });
  }
  const buf = await pipe
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: long <= 256 })
    .toBuffer();
  if (buf.length < before) {
    fs.writeFileSync(fp, buf);
    saved += before - buf.length;
    console.log(`${f.padEnd(40)} ${(before / 1024).toFixed(0)}KB -> ${(buf.length / 1024).toFixed(0)}KB`);
  } else {
    console.log(`${f.padEnd(40)} unchanged (${(before / 1024).toFixed(0)}KB)`);
  }
}
console.log('TOTAL SAVED (MB):', (saved / 1e6).toFixed(2));
