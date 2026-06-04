import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeDeploy = false;

function deployEnabled() {
  return process.env.ALLOW_SELF_DEPLOY === "true" && (process.env.DEPLOY_TOKEN?.trim().length ?? 0) >= 32;
}

function tokenMatches(value: string | null) {
  const expected = process.env.DEPLOY_TOKEN?.trim();
  if (!expected || !value) return false;

  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function deployLogPath() {
  return path.join(process.env.DEPLOY_LOG_DIR || path.join(process.cwd(), "data", "deploy-logs"), "self-deploy.log");
}

function normalizedBranch() {
  const branch = process.env.DEPLOY_BRANCH?.trim() || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    return "main";
  }
  return branch;
}

function requireDeployToken(request: Request) {
  if (!deployEnabled()) {
    return NextResponse.json({ error: "Self deploy is disabled" }, { status: 404 });
  }

  if (!tokenMatches(request.headers.get("x-deploy-token"))) {
    return NextResponse.json({ error: "Invalid deploy token" }, { status: 403 });
  }

  return null;
}

export async function GET(request: Request) {
  const denied = requireDeployToken(request);
  if (denied) return denied;

  try {
    const log = readFileSync(deployLogPath(), "utf8");
    return NextResponse.json({
      active: activeDeploy,
      log: log.split(/\r?\n/).slice(-180).join("\n"),
    });
  } catch {
    return NextResponse.json({ active: activeDeploy, log: "" });
  }
}

export async function POST(request: Request) {
  const denied = requireDeployToken(request);
  if (denied) return denied;

  if (process.platform === "win32") {
    return NextResponse.json({ error: "Self deploy is intended for Linux containers" }, { status: 400 });
  }

  if (activeDeploy) {
    return NextResponse.json({ error: "Deploy is already running" }, { status: 409 });
  }

  activeDeploy = true;

  const logFile = deployLogPath();
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile, { flags: "a" });
  const branch = normalizedBranch();
  const parentPid = process.pid;

  const script = [
    "set -eu",
    `echo ""`,
    `echo "=== TRIANGLE Invoice OS self deploy $(date -Iseconds) ==="`,
    `echo "branch: ${branch}"`,
    `git fetch --depth 1 origin ${branch}`,
    `git reset --hard origin/${branch}`,
    "npm ci --include=dev",
    "npm run build",
    `echo "Build finished. Restarting app process ${parentPid}."`,
    `node -e "setTimeout(() => process.kill(${parentPid}, 'SIGTERM'), 1000)"`,
  ].join("\n");

  const child = spawn("sh", ["-lc", script], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });

  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("exit", (code, signal) => {
    log.write(`\nself deploy child exited: code=${code ?? ""} signal=${signal ?? ""}\n`);
    log.end();
    activeDeploy = false;
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    active: true,
    branch,
    message: "Deploy started. The app process will restart after the build finishes.",
  });
}
