import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1, retries: 0, timeout: 30000,
  outputDir: "../test-results/browser", reporter: [["list"], ["json", {outputFile: "../test-results/browser-results.json"}]],
  use: { baseURL: "http://127.0.0.1:8877", headless: true, channel: "chrome", screenshot: "only-on-failure", trace: "off" },
  webServer: { command: process.platform === "win32" ? "..\\.venv\\Scripts\\python.exe ../backend/tests/serve_e2e.py" : "../.venv/bin/python ../backend/tests/serve_e2e.py", url: "http://127.0.0.1:8877/api/health", reuseExistingServer: false, timeout: 30000 },
});
