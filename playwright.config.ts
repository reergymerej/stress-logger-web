import { defineConfig, devices } from '@playwright/test';

const port = 3300;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  // Chromium only: Playwright's WebKit build doesn't run on macOS 12.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: `serve -l ${port} .`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
