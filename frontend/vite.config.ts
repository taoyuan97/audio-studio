/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    // 页面已按路由懒加载；共享 React/Ant Design vendor gzip 后约 225 kB。
    chunkSizeWarningLimit: 750,
  },
  server: {
    // 端口固定：被占用时直接报错而非自动换端口
    strictPort: true,
    proxy: {
      '/api': {
        target: mode === 'e2e' ? 'http://127.0.0.1:8010' : 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // 音频产物等媒体由后端提供，开发模式同样经代理转发
      '/media': {
        target: mode === 'e2e' ? 'http://127.0.0.1:8010' : 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 组件测试只收集 src/ 下的用例；e2e/ 为 Playwright 专用，须排除
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // 组件测试不涉及样式加载
    css: false,
  },
}))
