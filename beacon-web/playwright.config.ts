import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // Keep frame-gap measurements independent of concurrent browser workloads.
  workers: 1,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          // CI has software rendering; Firefox can block WebGL despite Xvfb.
          // Allow the real map renderer in this test browser profile.
          firefoxUserPrefs: { 'webgl.force-enabled': true },
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    env: { VITE_API_BASE: '/api/v1', VITE_WS_URL: 'ws://127.0.0.1:4174/ws', VITE_DEV_PROXY: '' },
  },
});
