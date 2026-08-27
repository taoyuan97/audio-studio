import { Card, Empty } from 'antd'

interface PagePlaceholderProps {
  title: string
  description?: string
}

/** 路由占位页：业务任务（T003–T007）在其上替换实现 */
export default function PagePlaceholder({ title, description = '页面建设中，由后续任务实现' }: PagePlaceholderProps) {
  return (
    <Card title={title}>
      <Empty description={description} />
    </Card>
  )
}
