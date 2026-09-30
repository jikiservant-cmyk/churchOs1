import type {NextConfig} from 'next';

// Origins allowed to call Server Actions and to access the dev server.
// Covers local dev, Google Cloud Run / Studio previews, and Arena (e2b) previews.
const allowedOrigins = [
  'localhost:3000',
  '127.0.0.1:3000',
  '*.run.app',
  '*.google.com',
  '*.googleusercontent.com',
  '*.e2b.app',
];

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverActions: {
      allowedOrigins,
    },
  },
  // @ts-ignore Next.js 15+ allowedDevOrigins
  allowedDevOrigins: allowedOrigins,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', port: '', pathname: '/**' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/:church_slug',
        destination: '/c/:church_slug',
      },
      {
        source: '/:church_slug/:path*',
        destination: '/c/:church_slug/:path*',
      }
    ]
  },
  webpack: (config, {dev}) => {
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = { ignored: /.*/ };
    }
    return config;
  },
};

export default nextConfig;
