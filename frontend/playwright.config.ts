import { defineConfig } from '@playwright/test'

// 固定使用隔离端口与串行 worker，避免队列/清空类场景互相污染。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: '.venv\\Scripts\\python.exe scripts\\run_e2e_server.py',
      cwd: '../backend',
      url: 'http://127.0.0.1:8010/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite --mode e2e --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
