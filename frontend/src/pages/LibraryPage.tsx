import { DeleteOutlined, EditOutlined, EyeOutlined, SendOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Empty, Input, Modal, Popconfirm, Skeleton, Space, Tabs, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { deleteArtifact, listArtifacts, updateArtifact } from '../api/artifacts'
import type { Artifact } from '../api/types'
import ArtifactDetailModal from '../features/library/ArtifactDetailModal'
import {
  ARTIFACT_TYPE_META,
  artifactSummary,
  formatArtifactTime,
  SUPPORTED_ARTIFACT_TYPES,
} from '../features/library/artifactMeta'

type LibraryTab = 'all' | 'script_meditation' | 'voice' | 'bgm' | 'mix'

const TAB_LABELS: Record<LibraryTab, string> = {
  all: '全部', script_meditation: '冥想脚本', voice: 'TTS 人声', bgm: '背景音', mix: '成品',
}

/** T007-A：只开放冥想脚本与 TTS 人声；BGM/混音保留显式后续开放状态。 */
export default function LibraryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<LibraryTab>('all')
  const [selected, setSelected] = useState<Artifact | null>(null)
  const [renaming, setRenaming] = useState<Artifact | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const artifactsQuery = useQuery({
    queryKey: ['artifacts', 'library-supported'],
    queryFn: async () => {
      const responses = await Promise.all(
        SUPPORTED_ARTIFACT_TYPES.map((type) => listArtifacts({ type, limit: 500 })),
      )
      return responses.flatMap((response) => response.items).sort((a, b) => b.created_at - a.created_at)
    },
  })

  const artifacts = useMemo(() => artifactsQuery.data ?? [], [artifactsQuery.data])
  const requestedArtifactId = searchParams.get('artifact_id')
  useEffect(() => {
    if (!requestedArtifactId || selected) return
    const artifact = artifacts.find((item) => item.id === requestedArtifactId)
    if (artifact) setSelected(artifact)
  }, [artifacts, requestedArtifactId, selected])

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateArtifact(id, { name }),
    onSuccess: (artifact) => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      setSelected((current) => current?.id === artifact.id ? artifact : current)
      setRenaming(null)
      message.success('已重命名')
    },
    onError: () => message.error('重命名失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteArtifact,
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      if (selected?.id === id) setSelected(null)
      message.success('已删除')
    },
    onError: () => message.error('删除失败'),
  })

  const visibleArtifacts = useMemo(
    () => activeTab === 'all' ? artifacts : artifacts.filter((artifact) => artifact.type === activeTab),
    [activeTab, artifacts],
  )
  const countOf = (tab: LibraryTab) => tab === 'all'
    ? artifacts.length
    : artifacts.filter((artifact) => artifact.type === tab).length
  const isDeferredTab = activeTab === 'bgm' || activeTab === 'mix'

  const closeDetail = () => {
    setSelected(null)
    if (requestedArtifactId) setSearchParams({}, { replace: true })
  }

  return (
    <div className="page-stack library-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">产物库</h2>
          <p className="page-desc">统一查看和管理冥想脚本与 TTS 人声产物</p>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as LibraryTab)}
        items={(Object.keys(TAB_LABELS) as LibraryTab[]).map((key) => ({
          key,
          label: <span>{TAB_LABELS[key]} <span className="library-tab-count">{countOf(key)}</span></span>,
        }))}
      />

      {artifactsQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : artifactsQuery.isError ? (
        <Card><Empty description="产物加载失败，请稍后重试"><Button onClick={() => artifactsQuery.refetch()}>重新加载</Button></Empty></Card>
      ) : isDeferredTab ? (
        <Card><Empty description={`${TAB_LABELS[activeTab]}功能后续开放`} /></Card>
      ) : visibleArtifacts.length === 0 ? (
        <Card>
          <Empty description={activeTab === 'voice' ? '暂无 TTS 人声产物' : activeTab === 'script_meditation' ? '暂无冥想脚本产物' : '产物库为空'}>
            <Button type="primary" onClick={() => navigate(activeTab === 'voice' ? '/tts' : '/meditation')}>
              {activeTab === 'voice' ? '去合成人声' : '去生成冥想脚本'}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="library-grid">
          {visibleArtifacts.map((artifact) => {
            const meta = ARTIFACT_TYPE_META[artifact.type]
            const isScript = artifact.type === 'script_meditation'
            return (
              <Card key={artifact.id} className="library-card">
                <div className="library-card-head">
                  <div className="library-card-name">{artifact.name}</div>
                  <span className="library-card-time">{formatArtifactTime(artifact.created_at)}</span>
                </div>
                <Tag color={meta.color}>{meta.label}</Tag>
                <p className="library-card-summary">{artifactSummary(artifact)}</p>
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setSelected(artifact)}>详情</Button>
                  <Button size="small" icon={<SendOutlined />} onClick={() => navigate(isScript ? `/tts?artifact_id=${artifact.id}` : `/mixdown?voice_id=${artifact.id}`)}>
                    {isScript ? '送去 TTS' : '送去混音'}
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => { setRenaming(artifact); setRenameValue(artifact.name) }}>重命名</Button>
                  <Popconfirm title="删除产物" description={`确定删除「${artifact.name}」吗？此操作无法恢复。`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(artifact.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} loading={deleteMutation.isPending}>删除</Button>
                  </Popconfirm>
                </Space>
              </Card>
            )
          })}
        </div>
      )}

      <ArtifactDetailModal artifact={selected} onClose={closeDetail} />
      <Modal
        title="重命名产物"
        open={renaming !== null}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !renameValue.trim(), loading: renameMutation.isPending }}
        onCancel={() => setRenaming(null)}
        onOk={() => renaming && renameValue.trim() && renameMutation.mutate({ id: renaming.id, name: renameValue.trim() })}
        destroyOnHidden
      >
        <Input value={renameValue} maxLength={100} onChange={(event) => setRenameValue(event.target.value)} />
      </Modal>
    </div>
  )
}
