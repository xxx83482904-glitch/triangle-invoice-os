import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppData } from "../src/lib/types";

// Replace only fabricated banking rows in an existing disposable preview.
async function main() {
  const [source, target] = process.argv.slice(2).map((value) => path.resolve(value));
  for (const root of [source, target]) assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(source).startsWith("triangle-forecast-preview-"));
  assert.ok(path.basename(target).startsWith("triangle-banking-preview-"));
  const sourceData = JSON.parse(await readFile(path.join(source, "app-data.json"), "utf8")) as AppData;
  const targetFile = path.join(target, "app-data.json");
  const targetData = JSON.parse(await readFile(targetFile, "utf8")) as AppData;
  assert.ok(targetData.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(targetData.bankAccounts.every((row) => row.name.startsWith("テスト")));
  await copyFile(targetFile, path.join(target, `before-forecast-${Date.now()}.json`));
  targetData.bankAccounts = sourceData.bankAccounts;
  targetData.bankTransactions = sourceData.bankTransactions;
  targetData.bankSyncStates = sourceData.bankSyncStates;
  await writeFile(targetFile, JSON.stringify(targetData, null, 2));
  console.log("Synthetic forecast rows prepared; prior preview data backed up.");
}
void main();
