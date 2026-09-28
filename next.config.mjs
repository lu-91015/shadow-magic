/** @type {import('next').NextConfig} */
const nextConfig = {
  // 类型不一致问题已在代码层清理完毕，重新开启 build 期类型检查。
  // lint 仍暂时忽略（与本次类型清理无关）。
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
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
};

export default nextConfig;
