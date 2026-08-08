import { defineConfig, devices } from '@playwright/test';

// Getestet wird der gebaute Stand, nicht die Quellen: dist/main.js ist das, was
// ausgeliefert wird. Vor dem Lauf also `npm run build`.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8799',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14 Pro'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8799 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8799/index.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
