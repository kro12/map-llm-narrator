import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // // React Compiler + Zustand async > Feb 2026 known issue
  // reactCompiler: false, // DISABLE (breaks with Zustand abort)
  // reactStrictMode: false, // ADD THIS (Turbopack double-invoke)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        pathname: '/wikipedia/**',
      },
    ],
  },
}

export default nextConfig
