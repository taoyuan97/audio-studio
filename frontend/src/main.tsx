// antd v5 × React 19 兼容补丁（官方方案，升级 antd v6 时移除）
import '@ant-design/v5-patch-for-react-19'
import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { queryClient } from './lib/queryClient'
import { themeCssVariables, themeTokens } from './styles/theme'
import './styles/global.css'
import './styles/meditation.css'
import './styles/tts.css'
import './styles/bgm.css'
import './styles/mixdown.css'
import './styles/library-dashboard.css'

Object.entries(themeCssVariables).forEach(([name, value]) => {
  document.documentElement.style.setProperty(name, value)
})

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
