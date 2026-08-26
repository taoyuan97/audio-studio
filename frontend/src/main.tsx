import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { queryClient } from './lib/queryClient'
import { themeTokens } from './styles/theme'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={themeTokens} locale={zhCN}>
        <AntdApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
)
