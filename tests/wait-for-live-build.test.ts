import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLiveBuild, createAncestorChecker, finalProbeFailures, parseBuildReport,
  parseCliOptions, remainingMs, waitForLiveBuild,
} from "../scripts/wait-for-live-build.mjs";

const expected = "0123456789abcdef0123456789abcdef01234567";
const other = "abcdef0123456789abcdef0123456789abcdef01";
const third = "1111111111111111111111111111111111111111";
const url = "http://127.0.0.1:3095";
const response = (status: number | null, bodyText = "") => ({ status, bodyText });
const version = (sha: string | null) => response(200, JSON.stringify({ build: sha }));
const goodProbes = {
  login: response(200), sectionExport: response(401),
  deploy: response(403, JSON.stringify({ error: "Invalid deploy token" })),
};
function finalResponse(path: string) {
  if (path.endsWith("/login")) return goodProbes.login;
  if (path.endsWith("/api/section-export")) return goodProbes.sectionExport;
  if (path.endsWith("/api/admin/deploy")) return goodProbes.deploy;
  throw new Error("Unexpected probe");
}
function clock() {
  let time = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => { sleeps.push(ms); time += ms; },
    log: (line: string) => { logs.push(line); },
    sleeps, logs,
  };
}

test("build report parsing handles HTML 502, network errors and malformed JSON", () => {
  assert.deepEqual(parseBuildReport(502, "<html>Bad gateway</html>"), { kind: "down", detail: "HTTP 502" });
  assert.deepEqual(parseBuildReport(null, ""), { kind: "down", detail: "network error" });
  assert.deepEqual(parseBuildReport(200, "{bad"), { kind: "down", detail: "invalid JSON" });
  assert.equal(parseBuildReport(302, JSON.stringify({ build: expected })).kind, "down");
});

test("build report parsing distinguishes unknown builds from valid and invalid SHAs", () => {
  for (const body of ['{"build":null}', "{}", "null"]) assert.deepEqual(parseBuildReport(200, body), { kind: "unknown" });
  assert.deepEqual(parseBuildReport(200, JSON.stringify({ build: expected })), { kind: "build", sha: expected });
  for (const build of ["", expected.slice(0, 7), expected.toUpperCase(), `${expected}x`, 42]) {
    assert.deepEqual(parseBuildReport(200, JSON.stringify({ build })), { kind: "down", detail: "invalid build SHA" });
  }
});

test("live classification requires an exact SHA or confirmed ancestry", () => {
  assert.equal(classifyLiveBuild({ report: { kind: "build", sha: expected }, expected }), "live");
  assert.equal(classifyLiveBuild({ report: { kind: "build", sha: other }, expected, isAncestor: true }), "newer");
  assert.equal(classifyLiveBuild({ report: { kind: "build", sha: other }, expected }), "waiting");
  assert.equal(classifyLiveBuild({ report: { kind: "unknown" }, expected, isAncestor: true }), "waiting");
  assert.equal(classifyLiveBuild({ report: { kind: "down", detail: "HTTP 502" }, expected }), "waiting");
  assert.equal(classifyLiveBuild({ report: { kind: "build", sha: "bad" }, expected, isAncestor: true }), "waiting");
});

test("all final probes pass only with the required statuses and deploy error", () => {
  assert.deepEqual(finalProbeFailures(goodProbes), []);
  assert.match(finalProbeFailures({ ...goodProbes, login: response(302) })[0], /\/login.*302/);
  assert.match(finalProbeFailures({ ...goodProbes, sectionExport: response(200) })[0], /\/api\/section-export.*200/);
  assert.match(finalProbeFailures({ ...goodProbes, login: response(null) })[0], /network error/);
  assert.equal(finalProbeFailures({ login: goodProbes.login, sectionExport: goodProbes.sectionExport }).length, 1);
});

test("deploy 429, disabled 404, wrong 403 body, non-JSON and network errors fail safely", () => {
  for (const deploy of [response(429), response(404), response(403, '{"error":"some-other-error"}'), response(403, "not-json"), response(null), response(200, goodProbes.deploy.bodyText)]) {
    const failures = finalProbeFailures({ ...goodProbes, deploy });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /\/api\/admin\/deploy/);
    assert.ok(!failures[0].includes("some-other-error"));
  }
});

test("deadline clamps elapsed time to zero", () => {
  assert.equal(remainingMs(100, 40), 60);
  assert.equal(remainingMs(100, 100), 0);
  assert.equal(remainingMs(100, 101), 0);
});

test("CLI options validate SHA, URL and positive bounded timeouts without needing a token", () => {
  assert.deepEqual(parseCliOptions(["--url", `${url}/`, "--expect", expected]), { url, expect: expected, timeoutSeconds: 900, intervalSeconds: 10 });
  assert.equal(parseCliOptions(["--url", url, "--expect", expected, "--timeout-seconds", "30", "--interval-seconds", "2"]).intervalSeconds, 2);
  for (const extra of [["--expect", "bad"], ["--url", "ftp://example.invalid"], ["--url", "http://user:password@example.invalid"], ["--url", `${url}?secret=ignored`], ["--timeout-seconds", "0"], ["--interval-seconds", "NaN"], ["--timeout-seconds", "9999999999"], ["--token", "fake-test-only-token-0123456789abcdef"]]) {
    assert.throws(() => parseCliOptions(["--url", url, "--expect", expected, ...extra]));
  }
});

test("ancestry checks known commits without fetching, once per reported SHA", async () => {
  const calls: string[][] = [];
  const check = createAncestorChecker(expected, async (args: string[]) => { calls.push(args); });
  assert.equal(await check(other), true);
  assert.equal(await check(other), true);
  assert.equal(await check(expected), true);
  assert.deepEqual(calls, [["cat-file", "-e", `${other}^{commit}`], ["merge-base", "--is-ancestor", expected, other]]);
});

test("missing reported commits cause one fetch per SHA, then verify ancestry", async () => {
  const calls: string[][] = [];
  let fetched = false;
  const check = createAncestorChecker(expected, async (args: string[]) => {
    calls.push(args);
    if (args[0] === "cat-file" && !fetched) throw new Error("missing");
    if (args[0] === "fetch") fetched = true;
  });
  assert.equal(await check(other), true);
  assert.equal(await check(other), true);
  assert.deepEqual(calls, [["cat-file", "-e", `${other}^{commit}`], ["fetch", "--quiet", "origin", "main"], ["cat-file", "-e", `${other}^{commit}`], ["merge-base", "--is-ancestor", expected, other]]);
});

test("Git failures never pass or repeatedly fetch; unvalidated SHAs never reach Git", async () => {
  const calls: string[][] = [];
  const check = createAncestorChecker(expected, async (args: string[]) => { calls.push(args); throw new Error("missing"); });
  assert.equal(await check(other), false);
  assert.equal(await check(other), false);
  assert.equal(await check(third), false);
  assert.equal(await check(other), false);
  assert.equal(await check("--help"), false);
  assert.equal(await createAncestorChecker("bad", async () => { assert.fail("Git must not run"); })(other), false);
  assert.equal(calls.filter((args) => args[0] === "fetch").length, 2);
  const unrelated = createAncestorChecker(expected, async (args: string[]) => { if (args[0] === "merge-base") throw new Error("not an ancestor"); });
  assert.equal(await unrelated(other), false);
});

test("polling waits through old, unknown and down reports before final probes", async () => {
  const timer = clock();
  const reports = [version(other), version(other), version(null), response(502), version(expected)];
  const ancestors: string[] = [];
  const paths: string[] = [];
  const code = await waitForLiveBuild({ url, expect: expected }, {
    ...timer,
    request: async (path, timeout) => {
      paths.push(path);
      assert.ok(timeout > 0 && timeout <= 15000);
      return path.includes("/api/version?ts=") ? reports.shift()! : finalResponse(path);
    },
    isAncestor: async (sha) => { ancestors.push(sha); return false; },
  });
  assert.equal(code, 0);
  assert.deepEqual(ancestors, [other]);
  assert.equal(paths.length, 8);
  assert.match(paths[7], /\/api\/admin\/deploy$/);
  assert.deepEqual(timer.sleeps, [10000, 10000, 10000, 10000]);
  assert.ok(timer.logs.some((line) => line.includes("state=unknown")));
  assert.ok(timer.logs.some((line) => line.includes("state=down")));
});

test("a confirmed newer live build warns and still runs final probes", async () => {
  const timer = clock();
  const code = await waitForLiveBuild({ url, expect: expected }, {
    ...timer, isAncestor: async () => true,
    request: async (path) => path.includes("/api/version?") ? version(other) : finalResponse(path),
  });
  assert.equal(code, 0);
  assert.equal(timer.logs.filter((line) => line.startsWith("::warning::")).length, 1);
});

test("failed login or section-export probes skip deploy in all three rounds", async () => {
  for (const failedPath of ["/login", "/api/section-export"]) {
    const timer = clock();
    const paths: string[] = [];
    const code = await waitForLiveBuild({ url, expect: expected }, {
      ...timer,
      request: async (path) => {
        paths.push(path);
        return path.includes("/api/version?") ? version(expected) : path.endsWith(failedPath) ? response(502) : finalResponse(path);
      },
    });
    assert.equal(code, 1);
    assert.equal(paths.filter((path) => path.endsWith("/api/admin/deploy")).length, 0);
    assert.equal(paths.filter((path) => path.endsWith("/login")).length, 3);
    assert.deepEqual(timer.sleeps, [10000, 10000]);
  }
});

test("deploy failures get at most three attempts, ten seconds apart", async () => {
  const timer = clock();
  let attempts = 0;
  const code = await waitForLiveBuild({ url, expect: expected }, {
    ...timer,
    request: async (path) => {
      if (path.includes("/api/version?")) return version(expected);
      if (path.endsWith("/api/admin/deploy")) { attempts++; return response(429); }
      return finalResponse(path);
    },
  });
  assert.equal(code, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(timer.sleeps, [10000, 10000]);
});

test("final probes can recover on a later round", async () => {
  const timer = clock();
  let loginAttempts = 0;
  let deployAttempts = 0;
  const code = await waitForLiveBuild({ url, expect: expected }, {
    ...timer,
    request: async (path) => {
      if (path.includes("/api/version?")) return version(expected);
      if (path.endsWith("/login") && ++loginAttempts === 1) return response(502);
      if (path.endsWith("/api/admin/deploy")) deployAttempts++;
      return finalResponse(path);
    },
  });
  assert.equal(code, 0);
  assert.equal(loginAttempts, 2);
  assert.equal(deployAttempts, 1);
  assert.deepEqual(timer.sleeps, [10000]);
});

test("unknown, unrelated and down builds time out with the last state and no final probes", async () => {
  for (const report of [version(null), version(other), response(null)]) {
    const timer = clock();
    let calls = 0;
    const code = await waitForLiveBuild({ url, expect: expected, timeoutSeconds: 30 }, {
      ...timer, isAncestor: async () => false,
      request: async (path) => { assert.match(path, /\/api\/version\?ts=/); calls++; return report; },
    });
    assert.equal(code, 1);
    assert.equal(calls, 3);
    assert.equal(timer.now(), 30000);
    assert.match(timer.logs.at(-1)!, /Timed out; last state:/);
  }
});

test("request, sleep and final-probe waits share the overall deadline", async () => {
  const timer = clock();
  const timeouts: number[] = [];
  const code = await waitForLiveBuild({ url, expect: expected, timeoutSeconds: 5 }, {
    ...timer,
    request: async (path, timeout) => {
      timeouts.push(timeout);
      return path.includes("/api/version?") ? version(expected) : response(502);
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(timeouts, [5000, 5000, 5000]);
  assert.deepEqual(timer.sleeps, [5000]);
  assert.match(timer.logs.at(-1)!, /Timed out/);
});
