import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tscircuit/eval currently trips Turbopack server bundling in dev.
  // Keep it external so Node resolves and executes it directly.
  serverExternalPackages: ["@tscircuit/eval"],
  turbopack: {
    // Pin workspace root so Turbopack doesn't infer from ~/pnpm-lock.yaml
    root: __dirname,
  },
};

export default nextConfig;
