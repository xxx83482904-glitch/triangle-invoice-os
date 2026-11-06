import { execFileSync } from "node:child_process";

function runGit(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    windowsHide: true,
  });
}

/**
 * @param {{ env?: Record<string, string | undefined>, run?: (command: string, args: string[]) => string }} [options]
 */
export function resolveBuildSha({ env = process.env, run = runGit } = {}) {
  let value = env.TRIANGLE_BUILD_SHA?.trim() || "";
  if (!value) {
    try {
      value = run("git", ["rev-parse", "HEAD"]);
    } catch {
      // Docker builds may have neither git nor a .git directory.
      return "";
    }
  }
  value = value.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(value) ? value : "";
}
