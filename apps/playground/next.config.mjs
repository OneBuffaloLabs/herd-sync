/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@onebuffalo/herd-sync"],
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        events: false,
        buffer: false,
        stream: false,
      };
    }
    return config;
  },
};

export default nextConfig;
