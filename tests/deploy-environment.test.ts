import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("self-deploy drops inherited build and Next runtime state without changing the parent", () => {
  // Execute the actual private helper without exporting extra Next route fields
  // or invoking POST, which can spawn a deployment and terminate its parent.
  const file = path.resolve("src/app/api/admin/deploy/route.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const helper = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "deployEnvironment");
  assert.ok(helper, "deployEnvironment must exist");
  const code = ts.transpileModule(helper.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const parent = {
    TRIANGLE_BUILD_SHA: "1111111111111111111111111111111111111111",
    __NEXT_PRIVATE_STANDALONE_CONFIG: "fake-config",
    __NEXT_PRIVATE_TEST: "fake-runtime-state",
    NEXT_DEPLOYMENT_ID: "fake-deployment",
    NEXT_OTEL_FETCH_DISABLED: "fake-otel-state",
    NEXT_TELEMETRY_DISABLED: "0",
    PATH: "fake-bin-path",
    DEPLOY_BRANCH: "test-branch",
  };
  const before = { ...parent };
  const child = runInNewContext(`${code}\ndeployEnvironment();`, { process: { env: parent } }) as NodeJS.ProcessEnv;
  assert.deepEqual({ ...child }, {
    NEXT_TELEMETRY_DISABLED: "1",
    PATH: "fake-bin-path",
    DEPLOY_BRANCH: "test-branch",
  });
  assert.deepEqual(parent, before);
});
