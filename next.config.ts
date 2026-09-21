import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The Agent SDK spawns the Claude Code CLI as a subprocess and resolves its
   * own native binaries at runtime. Bundling it breaks that resolution, so it
   * must stay external to the server build.
   */
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
