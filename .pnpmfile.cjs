/**
 * pnpm hook to provide zod@3 to tscircuit ecosystem packages,
 * while the root project keeps zod@4 for @anthropic-ai/claude-agent-sdk.
 *
 * circuit-json imports zod without declaring it — it needs zod@3 to be
 * compatible with @tscircuit/core schemas.
 */
function readPackage(pkg) {
  const forceZod3 =
    (pkg.name && pkg.name.startsWith("@tscircuit/")) ||
    pkg.name === "circuit-json";

  if (forceZod3) {
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies.zod = "3.24.3";
    if (pkg.peerDependencies) {
      delete pkg.peerDependencies.zod;
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
