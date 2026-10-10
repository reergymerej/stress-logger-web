import { defineConfig, devices } from '@playwright/test';

const port = 3300;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    // For tests that fail only now and then: open with `npx playwright show-trace`.
    trace: 'retain-on-failure',
    // Nothing here should take long, so a stuck step fails fast and says which step it was,
    // instead of using up the whole test timeout.
    actionTimeout: 5_000,
    navigationTimeout: 5_000,
  },
  // Run through `npm test`, in Docker: Playwright's WebKit doesn't run on macOS 12.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'safari', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `serve -l ${port} .`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
