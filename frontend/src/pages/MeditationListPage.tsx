import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EditOutlined, EnterOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button, Empty, Input, List, Modal, Skeleton, Tooltip } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createConversation,
  listConversations,
  renameConversation,
} from '../api/conversations'
import type { Conversation } from '../api/types'

function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString('zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** /meditation：会话列表（时间倒序）、新建、重命名、进入工作台 */
export default function MeditationListPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const conversationsQuery = useQuery({
    queryKey: ['conversations', 'meditation'],
    queryFn: () => listConversations({ scene: 'meditation' }),
  })

  const createMutation = useMutation({
    mutationFn: () => createConversation({ scene: 'meditation' }),
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/meditation/${conversation.id}`)
    },
    onError: () => message.error('创建会话失败'),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameConversation(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setRenaming(null)
      message.success('已重命名')
    },
    onError: () => message.error('重命名失败'),
  })

  const items = conversationsQuery.data?.items ?? []

  return (
    <div className="page-stack meditation-list-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">冥想会话</h2>
          <p className="page-desc">对话式生成带停顿与情绪标记的冥想引导脚本</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          新建会话
        </Button>
      </div>

      {conversationsQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : items.length === 0 ? (
        <Empty description="还没有冥想会话，点击右上角「新建会话」开始" />
      ) : (
        <List
          className="conv-list"
          dataSource={items}
          renderItem={(conversation) => (
            <List.Item
              key={conversation.id}
              className="conv-item"
              actions={[
                <Tooltip key="rename" title="重命名">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={`重命名 ${conversation.title}`}
                    onClick={() => {
                      setRenaming(conversation)
                      setRenameValue(conversation.title)
                    }}
                  />
                </Tooltip>,
                <Tooltip key="enter" title="进入工作台">
                  <Button
                    type="text"
                    size="small"
                    icon={<EnterOutlined />}
                    aria-label={`进入 ${conversation.title}`}
                    onClick={() => navigate(`/meditation/${conversation.id}`)}
                  />
                </Tooltip>,
              ]}
            >
              <List.Item.Meta
                title={
                  <button
                    type="button"
                    className="conv-title-link"
                    onClick={() => navigate(`/meditation/${conversation.id}`)}
                  >
                    {conversation.title}
                  </button>
                }
                description={`更新于 ${formatTime(conversation.updated_at)}`}
              />
            </List.Item>
          )}
        />
      )}

      <Modal
        title="重命名会话"
        open={renaming !== null}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ loading: renameMutation.isPending }}
        onOk={() => {
          const title = renameValue.trim()
          if (renaming && title) {
            renameMutation.mutate({ id: renaming.id, title })
          }
        }}
        onCancel={() => setRenaming(null)}
        destroyOnHidden
      >
        <Input
          value={renameValue}
          maxLength={100}
          placeholder="会话标题（1-100 字符）"
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => {
            const title = renameValue.trim()
            if (renaming && title) renameMutation.mutate({ id: renaming.id, title })
          }}
        />
      </Modal>
    </div>
  )
}
