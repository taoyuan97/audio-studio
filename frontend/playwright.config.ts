import { defineConfig } from '@playwright/test'

// E2E 用例由后续任务补充；此处仅固化运行配置
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
