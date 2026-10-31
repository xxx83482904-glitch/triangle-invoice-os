import { timingSafeEqual } from "node:crypto";

// Self deploy is reachable only when the host opts in and holds a long shared token. No token is built into the code.
export const DEPLOY_TOKEN_MIN_LENGTH = 32;
export const DEPLOY_FAILURE_LIMIT = 5;
export const DEPLOY_FAILURE_WINDOW_MS = 10 * 60 * 1000;

export function deployEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ALLOW_SELF_DEPLOY === "true" && (env.DEPLOY_TOKEN?.trim().length ?? 0) >= DEPLOY_TOKEN_MIN_LENGTH;
}

export function deployTokenMatches(value: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const expected = env.DEPLOY_TOKEN?.trim();
  if (!value || !expected || expected.length < DEPLOY_TOKEN_MIN_LENGTH) return false;
  const actual = Buffer.from(value), wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

// Per-process brake on guessing: after `limit` failures within the window every attempt is refused until it passes.
export class DeployFailureLimiter {
  private failures: number[] = [];
  constructor(private readonly limit = DEPLOY_FAILURE_LIMIT, private readonly windowMs = DEPLOY_FAILURE_WINDOW_MS) {}
  locked(now = Date.now()) {
    this.failures = this.failures.filter((at) => now - at < this.windowMs);
    return this.failures.length >= this.limit;
  }
  record(now = Date.now()) { this.failures.push(now); }
  reset() { this.failures = []; }
  get count() { return this.failures.length; }
}
