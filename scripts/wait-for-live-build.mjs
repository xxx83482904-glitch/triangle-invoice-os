import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

/** @typedef {{ kind: "down", detail: string } | { kind: "unknown" } | { kind: "build", sha: string }} BuildReport */
/** @typedef {{ status: number | null, bodyText: string, error?: string }} Probe */

/** @param {number | null} status @param {string} bodyText @returns {BuildReport} */
export function parseBuildReport(status, bodyText) {
  if (status === null) return { kind: "down", detail: "network error" };
  if (status !== 200) return { kind: "down", detail: `HTTP ${status}` };
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { kind: "down", detail: "invalid JSON" };
  }
  if (body?.build == null) return { kind: "unknown" };
  if (!isSha(body.build)) return { kind: "down", detail: "invalid build SHA" };
  return { kind: "build", sha: body.build };
}

/** @param {{ report: BuildReport, expected: string, isAncestor?: boolean }} input */
export function classifyLiveBuild({ report, expected, isAncestor = false }) {
  if (report.kind !== "build" || !isSha(report.sha) || !isSha(expected)) return "waiting";
  if (report.sha === expected) return "live";
  return isAncestor ? "newer" : "waiting";
}

/** @param {{ login: Probe, sectionExport: Probe, deploy?: Probe }} probes */
export function finalProbeFailures({ login, sectionExport, deploy }) {
  const failures = [];
  const status = (probe) => probe.status === null ? "network error" : `HTTP ${probe.status}`;
  if (login.status !== 200) failures.push(`/login: expected HTTP 200, got ${status(login)}`);
  if (sectionExport.status !== 401) failures.push(`/api/section-export: expected HTTP 401, got ${status(sectionExport)}`);
  if (deploy) {
    let correctBody = false;
    try {
      correctBody = JSON.parse(deploy.bodyText)?.error === "Invalid deploy token";
    } catch { /* A non-JSON response cannot verify the deploy endpoint. */ }
    if (deploy.status !== 403 || !correctBody) {
      failures.push(`/api/admin/deploy: expected HTTP 403 with error "Invalid deploy token", got ${status(deploy)}${correctBody ? "" : " with an unexpected body"}`);
    }
  } else if (failures.length === 0) {
    failures.push("/api/admin/deploy: not checked");
  }
  return failures;
}

export function remainingMs(deadline, now) {
  return Math.max(0, deadline - now);
}

async function runGit(args, timeoutMs = 15000) {
  if (timeoutMs <= 0) throw new Error("Deadline exceeded");
  await execFileAsync("git", args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
}

/**
 * Cache each reported SHA, including failures, so polling cannot repeatedly fetch.
 * @param {string} expected
 * @param {(args: string[]) => Promise<unknown>} executeGit
 */
export function createAncestorChecker(expected, executeGit = runGit) {
  const checks = new Map();
  return async (reported) => {
    if (!isSha(expected) || !isSha(reported)) return false;
    if (reported === expected) return true;
    if (!checks.has(reported)) {
      checks.set(reported, (async () => {
        try {
          try {
            await executeGit(["cat-file", "-e", `${reported}^{commit}`]);
          } catch {
            await executeGit(["fetch", "--quiet", "origin", "main"]);
            await executeGit(["cat-file", "-e", `${reported}^{commit}`]);
          }
          await executeGit(["merge-base", "--is-ancestor", expected, reported]);
          return true;
        } catch {
          // Missing commits, unrelated history and Git errors must never pass.
          return false;
        }
      })());
    }
    return checks.get(reported);
  };
}

/** @returns {Promise<Probe>} */
async function requestProbe(url, timeoutMs) {
  if (timeoutMs <= 0) return { status: null, bodyText: "", error: "deadline exceeded" };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "manual",
      credentials: "omit",
    });
    return { status: response.status, bodyText: await response.text() };
  } catch (error) {
    // Never log arbitrary error messages or response bodies: they may contain secrets.
    return { status: null, bodyText: "", error: error?.name === "TimeoutError" ? "request timeout" : "network error" };
  }
}

/**
 * @param {{ url: string, expect: string, timeoutSeconds?: number, intervalSeconds?: number }} options
 * @param {{ now?: () => number, sleep?: (ms: number) => Promise<unknown>, request?: (url: string, timeoutMs: number) => Promise<Probe>, isAncestor?: (reported: string) => Promise<boolean>, log?: (line: string) => void }} dependencies
 */
export async function waitForLiveBuild(
  { url, expect, timeoutSeconds = 900, intervalSeconds = 10 },
  { now = Date.now, sleep: pause = sleep, request = requestProbe, isAncestor, log = console.log } = {},
) {
  const deadline = now() + timeoutSeconds * 1000;
  const left = () => remainingMs(deadline, now());
  const requestTimeout = () => Math.min(15000, left());
  const checkAncestor = isAncestor ?? createAncestorChecker(expect, (args) => runGit(args, requestTimeout()));
  let lastSha = null;
  let ancestor = false;
  let attempt = 0;
  let lastState = "no response";

  while (left() > 0) {
    const probe = await request(`${url}/api/version?ts=${now()}`, requestTimeout());
    const report = parseBuildReport(probe.status, probe.bodyText);
    if (report.kind === "build" && report.sha !== lastSha) {
      lastSha = report.sha;
      ancestor = report.sha !== expect && left() > 0 ? await checkAncestor(report.sha) : false;
    }
    const state = classifyLiveBuild({ report, expected: expect, isAncestor: ancestor });
    lastState = `${probe.status === null ? probe.error || "network error" : `HTTP ${probe.status}`}, build=${report.kind === "build" ? report.sha.slice(0, 12) : "-"}, state=${report.kind === "build" ? state : report.kind}`;
    if (report.kind === "down") lastState += ` (${report.detail})`;
    log(`Attempt ${++attempt}: ${lastState}`);

    if ((state === "live" || state === "newer") && left() > 0) {
      if (state === "newer") log(`::warning::A newer build ${lastSha} is live and contains expected commit ${expect}.`);
      let failures = [];
      for (let round = 1; round <= 3 && left() > 0; round++) {
        const [login, sectionExport] = await Promise.all([
          request(`${url}/login`, requestTimeout()),
          request(`${url}/api/section-export`, requestTimeout()),
        ]);
        // Every unauthenticated deploy request uses one failure-brake allowance.
        const deploy = login.status === 200 && sectionExport.status === 401 && left() > 0
          ? await request(`${url}/api/admin/deploy`, requestTimeout()) : undefined;
        failures = finalProbeFailures({ login, sectionExport, deploy });
        if (failures.length === 0 && left() > 0) {
          log(`Final probes round ${round}: /login HTTP 200, /api/section-export HTTP 401, /api/admin/deploy HTTP 403 (Invalid deploy token).`);
          log("Expected build is serving; live check passed.");
          return 0;
        }
        log(`Final probes round ${round}: ${failures.join("; ") || "deadline exceeded"}`);
        if (round < 3 && left() > 0) await pause(Math.min(10000, left()));
      }
      log(left() === 0
        ? `Timed out; last state: ${lastState}; final probes: ${failures.join("; ") || "deadline exceeded"}`
        : `Final probes failed: ${failures.join("; ")}`);
      return 1;
    }
    if (left() > 0) await pause(Math.min(intervalSeconds * 1000, left()));
  }
  log(`Timed out; last state: ${lastState}`);
  return 1;
}

export function parseCliOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: "string" },
      expect: { type: "string" },
      "timeout-seconds": { type: "string", default: "900" },
      "interval-seconds": { type: "string", default: "10" },
    },
    strict: true,
    allowPositionals: false,
  });
  const url = new URL(values.url);
  const timeoutSeconds = Number(values["timeout-seconds"]);
  const intervalSeconds = Number(values["interval-seconds"]);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !isSha(values.expect)
    || ![timeoutSeconds, intervalSeconds].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 86400)) {
    throw new Error("Invalid live-check options");
  }
  return { url: url.href.replace(/\/+$/, ""), expect: values.expect, timeoutSeconds, intervalSeconds };
}

async function main() {
  let options;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch {
    console.error("Usage: node scripts/wait-for-live-build.mjs --url <base> --expect <40-lowercase-hex-sha> [--timeout-seconds 900] [--interval-seconds 10]");
    process.exitCode = 1;
  }
  if (options) {
    try {
      process.exitCode = await waitForLiveBuild(options);
    } catch {
      console.error("Live build check failed unexpectedly.");
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
