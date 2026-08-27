import {
  CloudOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  HomeOutlined,
  SettingOutlined,
  SlidersOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { Layout, Menu } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import StatusBanner from '../components/StatusBanner'

const NAV_ITEMS = [
  { key: '/', label: '首页', icon: <HomeOutlined /> },
  { key: '/meditation', label: '冥想', icon: <CloudOutlined /> },
  { key: '/tts', label: 'TTS', icon: <SoundOutlined /> },
  { key: '/bgm', label: 'BGM（后续开放）', icon: <CustomerServiceOutlined /> },
  { key: '/mixdown', label: '混音（后续开放）', icon: <SlidersOutlined /> },
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', paddingTop: 8 }}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Content style={{ padding: 24 }}>
          <StatusBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
