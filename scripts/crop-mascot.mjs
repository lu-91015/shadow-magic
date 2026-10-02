import sharp from 'sharp';
await sharp('tmp-home.png')
  .extract({ left: 60, top: 140, width: 220, height: 210 })
  .resize(170 * 4, 160 * 4, { kernel: 'nearest' })
  .png()
  .toFile('tmp-mascot-face.png');
console.log('ok');
