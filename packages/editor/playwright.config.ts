import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174/',
    // Chrome/Edge are the only targets (requirements 2). Uses the installed Chrome.
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'pnpm exec vite --config harness/vite.config.ts',
    url: 'http://localhost:5174/',
    reuseExistingServer: true,
  },
})
