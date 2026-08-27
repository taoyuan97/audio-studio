import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Space } from 'antd'

export interface RetryActionsProps {
  downloadAvailable: boolean
  loading?: boolean
  onDownload: () => void
  onRegenerate: () => void
}

export default function RetryActions({ downloadAvailable, loading, onDownload, onRegenerate }: RetryActionsProps) {
  return <Space wrap>
    {downloadAvailable && <Button type="primary" icon={<CloudDownloadOutlined />} loading={loading} onClick={onDownload}>重新下载（免计费）</Button>}
    <Popconfirm title="确认重新生成？" description="这会再次调用 MiniMax，并可能产生新的费用。" okText="确认并重新生成" cancelText="取消" onConfirm={onRegenerate}>
      <Button icon={<ReloadOutlined />} loading={loading}>重新生成</Button>
    </Popconfirm>
  </Space>
}
