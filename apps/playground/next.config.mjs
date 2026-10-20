/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@onebuffalolabs/herd-sync", "@onebuffalolabs/adapter-webrtc"],
  images: {
    unoptimized: true
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        events: false,
        buffer: false,
        stream: false
      };
    }
    return config;
  }
};

export default nextConfig;
