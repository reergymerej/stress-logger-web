import { defineConfig, devices } from '@playwright/test';

const port = 3300;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // The tests mostly wait on browsers, so a worker per CPU keeps the suite fast.
  workers: '100%',
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
  // The npm start tests check the script, not the page, so they run once, in the first.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testIgnore: 'start.spec.ts' },
    { name: 'safari', use: { ...devices['Desktop Safari'] }, testIgnore: 'start.spec.ts' },
    { name: 'iphone', use: { ...devices['iPhone 13'] }, testIgnore: 'start.spec.ts' },
  ],
  webServer: {
    command: `serve -l ${port} .`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
