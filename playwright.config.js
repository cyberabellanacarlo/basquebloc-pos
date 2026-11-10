const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8877",
    headless: true,
    trace: "off",
    video: "off"
  },
  webServer: {
    command: "python3 -m http.server 8877",
    port: 8877,
    reuseExistingServer: true,
    cwd: __dirname
  }
});
