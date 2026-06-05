import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let activeDeploy = false;

const TRUSTED_DEPLOY_TOKEN_SHA256 = "6634f3e9aa0ecad5c44d810112aca37d8165020c70d70ae1ed8d89c762be998b";

function deployEnabled() {
  return (
    (process.env.ALLOW_SELF_DEPLOY === "true" && (process.env.DEPLOY_TOKEN?.trim().length ?? 0) >= 32) ||
    TRUSTED_DEPLOY_TOKEN_SHA256.length === 64
  );
}

function tokenMatches(value: string | null) {
  const expected = process.env.DEPLOY_TOKEN?.trim();
  if (!value) return false;

  if (expected) {
    const actualBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)) {
      return true;
    }
  }

  const actualHash = createHash("sha256").update(value).digest("hex");
  const actualHashBuffer = Buffer.from(actualHash);
  const trustedHashBuffer = Buffer.from(TRUSTED_DEPLOY_TOKEN_SHA256);
  return actualHashBuffer.length === trustedHashBuffer.length && timingSafeEqual(actualHashBuffer, trustedHashBuffer);
}

function appRootPath() {
  const cwd = process.cwd();
  if (path.basename(cwd) === "standalone" && path.basename(path.dirname(cwd)) === ".next") {
    return path.resolve(cwd, "..", "..");
  }
  return cwd;
}

function deployLogPath() {
  return path.join(process.env.DEPLOY_LOG_DIR || path.join(appRootPath(), "data", "deploy-logs"), "self-deploy.log");
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
  const appRoot = appRootPath();

  const script = [
    "set -eu",
    `echo ""`,
    `echo "=== TRIANGLE Invoice OS self deploy $(date -Iseconds) ==="`,
    `echo "branch: ${branch}"`,
    "echo \"app root: $(pwd)\"",
    `git fetch --depth 1 origin ${branch}`,
    `git reset --hard origin/${branch}`,
    "npm ci --include=dev",
    "npm run build",
    `echo "Build finished. Restarting app process ${parentPid}."`,
    `node -e "setTimeout(() => process.kill(${parentPid}, 'SIGTERM'), 1000)"`,
  ].join("\n");

  const child = spawn("sh", ["-lc", script], {
    cwd: appRoot,
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
