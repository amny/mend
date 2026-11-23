import { defineConfig } from '@playwright/test'

const PORT = 5176

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Chrome/Edge are the only targets (requirements 2). Uses the installed Chrome.
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    // The test hooks (window.__mendTestHooks, AC-08) are compiled in only with this flag.
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    env: { VITE_MEND_TEST_HOOKS: '1' },
    url: `http://localhost:${PORT}/`,
    // A server started without the flag would lack the hooks, so never reuse one.
    reuseExistingServer: false,
  },
})
