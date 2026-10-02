// 裁剪立绘脸部放大，供确认细节
import sharp from 'sharp';

const src = process.argv[2] || 'public/characters/dousha-1.png';
const img = sharp(src);
const meta = await img.metadata();
// 脸部大约在立绘上部中间
const left = Math.round(meta.width * 0.32);
const top = Math.round(meta.height * 0.08);
const w = Math.round(meta.width * 0.36);
const h = Math.round(meta.height * 0.20);
await img.extract({ left, top, width: w, height: h })
  .resize(w * 4, h * 4, { kernel: 'nearest' })
  .png()
  .toFile('tmp-face.png');
console.log('written tmp-face.png', { left, top, w, h });
