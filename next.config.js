/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }, // ürün görselleri, dış kaynaklardan (tedarikçi/bayi yüklemesi) geldiği için geniş bırakıldı
    ],
  },
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
