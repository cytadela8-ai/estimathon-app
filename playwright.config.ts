/** Run real mobile and desktop Chromium clients against isolated, file-backed contest servers. */
import { defineConfig } from '@playwright/test';
// Playwright colors worker output; avoid Node warnings when the parent also sets NO_COLOR.
delete process.env['NO_COLOR'];
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env['CI'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
