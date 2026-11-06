export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { normalizeBuildSha, rememberRunningBuild } = await import("@/lib/build-info");
    rememberRunningBuild(normalizeBuildSha(process.env.TRIANGLE_BUILD_SHA));
    const { startBankScheduler } = await import("@/lib/banking-sync");
    startBankScheduler();
  }
}
