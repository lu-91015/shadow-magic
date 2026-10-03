// 生成熊猫耳贴片（两只黑耳 + 蓝白描边，底部对齐图像底边便于贴头顶）
import sharp from 'sharp';

const W = 220, H = 130;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="ear" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#454b58"/>
      <stop offset="70%" stop-color="#2b2f38"/>
      <stop offset="100%" stop-color="#23262e"/>
    </radialGradient>
  </defs>
  <g>
    <!-- 左耳 -->
    <g>
      <circle cx="58" cy="78" r="50" fill="url(#ear)"/>
      <circle cx="58" cy="78" r="50" fill="none" stroke="#dce8f8" stroke-width="5"/>
      <ellipse cx="58" cy="84" rx="24" ry="21" fill="#4e5566" opacity="0.75"/>
    </g>
    <!-- 右耳 -->
    <g>
      <circle cx="162" cy="78" r="50" fill="url(#ear)"/>
      <circle cx="162" cy="78" r="50" fill="none" stroke="#dce8f8" stroke-width="5"/>
      <ellipse cx="162" cy="84" rx="24" ry="21" fill="#4e5566" opacity="0.75"/>
    </g>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('public/live2d/lidousha/ears.png');
console.log('written ears.png');
