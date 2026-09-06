import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'

export interface FocusLayoutContext {
  setNavigationBlocked: (blocked: boolean) => void
}

/**
 * 专注模式布局（冥想工作台等对话页）：无侧边栏，顶部返回列表。
 */
export default function FocusLayout() {
  const navigate = useNavigate()
  const [navigationBlocked, setNavigationBlocked] = useState(false)

  return (
    <div className="focus-layout">
      <header className="focus-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => {
            if (navigationBlocked && !window.confirm('草稿有未保存的本地修改，确定离开吗？')) return
            navigate('/meditation')
          }}
          aria-label="返回列表"
        >
          返回列表
        </Button>
      </header>
      <main className="focus-content">
        <Outlet context={{ setNavigationBlocked } satisfies FocusLayoutContext} />
      </main>
    </div>
  )
}
