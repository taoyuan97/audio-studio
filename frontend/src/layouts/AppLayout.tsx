import {
  CloudOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  HomeOutlined,
  SettingOutlined,
  SlidersOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Badge, Layout, Menu } from 'antd'
import type { ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getStats } from '../api/settings'
import type { RunKind } from '../api/types'
import StatusBanner from '../components/StatusBanner'

type NavItem = { key: string; label: string; icon: ReactNode; runKind?: RunKind }

const NAV_ITEMS: NavItem[] = [
  { key: '/', label: '首页', icon: <HomeOutlined /> },
  { key: '/meditation', label: '冥想', icon: <CloudOutlined />, runKind: 'script' },
  { key: '/tts', label: 'TTS', icon: <SoundOutlined />, runKind: 'tts' },
  { key: '/bgm', label: 'BGM', icon: <CustomerServiceOutlined />, runKind: 'music' },
  { key: '/mixdown', label: '混音', icon: <SlidersOutlined />, runKind: 'mixdown' },
  { key: '/library', label: '产物库', icon: <FolderOutlined /> },
  { key: '/settings', label: '设置', icon: <SettingOutlined /> },
]

/** 当前路由对应的侧边栏高亮 key（/meditation/:id 也高亮"冥想"） */
function selectedKeyOf(pathname: string): string {
  const first = `/${pathname.split('/')[1] ?? ''}`
  return NAV_ITEMS.some((item) => item.key === first) ? first : '/'
}

/** 应用主框架：固定侧边导航 + 内容区（顶部挂全局 StatusBanner） */
export default function AppLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => getStats(signal), refetchInterval: 30_000 })
  const activeRuns = statsQuery.data?.active_runs ?? []
  const menuItems = NAV_ITEMS.map((item) => {
    if (!item.runKind) return item
    const queued = activeRuns.filter((run) => run.kind === item.runKind && run.status === 'queued').length
    const running = activeRuns.filter((run) => run.kind === item.runKind && run.status === 'running').length
    const statusLabel = `${item.label}：${running} 个运行中，${queued} 个排队中`
    return {
      ...item,
      label: (
        <span className="app-nav-label">
          <span>{item.label}</span>
          {(running > 0 || queued > 0) && (
            <span className="app-nav-run-badges" aria-label={statusLabel} title={statusLabel}>
              {running > 0 && <Badge count={running} color="#1677ff" overflowCount={9} />}
              {queued > 0 && <Badge count={queued} color="#d89614" overflowCount={9} />}
            </span>
          )}
        </span>
      ),
    }
  })

  return (
    <Layout className="app-shell">
      <Layout.Sider width={232} theme="dark" className="app-sider">
        <div className="app-brand">
          <span className="app-brand-logo">音</span>
          <span>
            AI 音频工作台
            <div className="app-brand-sub">AUDIO STUDIO</div>
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKeyOf(pathname)]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', paddingTop: 8 }}
        />
      </Layout.Sider>
      <Layout className="app-main">
        <Layout.Content className="app-content">
          <StatusBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
