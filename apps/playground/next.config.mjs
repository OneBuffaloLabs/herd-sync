/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@onebuffalo/herd-sync"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
