/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/pipeline", destination: "/data", permanent: true },
    ];
  },
};
export default nextConfig;
