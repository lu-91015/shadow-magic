import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 类型不一致问题已在代码层清理完毕，重新开启 build 期类型检查。
  // lint 仍暂时忽略（与本次类型清理无关）。
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // 显式声明 @/* 别名，避免生产构建时 Next 未从 tsconfig 读取 paths 导致模块解析失败
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, '.');
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i0.hdslb.com' },
      { protocol: 'https', hostname: 'i1.hdslb.com' },
      { protocol: 'https', hostname: 'i2.hdslb.com' },
      { protocol: 'https', hostname: '*.hdslb.com' },
    ],
  },
  // 3D 模型与贴图体积较大，缓存一年（immutable）。后续若替换模型，请改文件名以突破缓存。
  async headers() {
    return [
      {
        source: '/models/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
