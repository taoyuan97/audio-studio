import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Outlet, useNavigate } from 'react-router-dom'

/**
 * 专注模式布局（冥想工作台等对话页）：无侧边栏，顶部返回列表。
 */
export default function FocusLayout() {
  const navigate = useNavigate()

  return (
    <div className="focus-layout">
      <header className="focus-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/meditation')}
          aria-label="返回列表"
        >
          返回列表
        </Button>
      </header>
      <main className="focus-content">
        <Outlet />
      </main>
    </div>
  )
}
