/** @type {import('next').NextConfig} */
const nextConfig = {
  // ponytail: standalone = bundel server.js + node_modules minimal, untuk cPanel Node.js App (lihat scripts/build-cpanel.mjs).
  output: "standalone",
};

export default nextConfig;
