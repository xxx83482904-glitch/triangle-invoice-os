const runningBuildKey = Symbol.for("triangle.runningBuildSha");
const processBuild = globalThis as typeof globalThis & { [runningBuildKey]?: string | null };

export function normalizeBuildSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sha = value.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export function rememberRunningBuild(sha: string | null): void {
  // Even an unknown startup SHA is final. A lazily loaded replacement bundle
  // must never relabel the process that was already serving the old build.
  if (!Object.prototype.hasOwnProperty.call(processBuild, runningBuildKey)) {
    processBuild[runningBuildKey] = sha;
  }
}

export function runningBuildSha(): string | null {
  return processBuild[runningBuildKey] ?? null;
}
