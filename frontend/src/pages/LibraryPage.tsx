import { ClearOutlined, DeleteOutlined, EditOutlined, EyeOutlined, SendOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Empty, Input, Modal, Popconfirm, Skeleton, Space, Tabs, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clearArtifacts, deleteArtifact, listArtifacts, updateArtifact } from '../api/artifacts'
import type { Artifact } from '../api/types'
import ArtifactDetailModal from '../features/library/ArtifactDetailModal'
import {
  ARTIFACT_TYPE_META,
  artifactSummary,
  formatArtifactTime,
} from '../features/library/artifactMeta'

type LibraryTab = 'all' | 'script_meditation' | 'voice' | 'bgm' | 'mix'

const TAB_LABELS: Record<LibraryTab, string> = {
  all: '全部', script_meditation: '冥想脚本', voice: 'TTS 人声', bgm: '背景音', mix: '成品',
}

const EMPTY_ROUTES: Record<LibraryTab, string> = {
  all: '/meditation', script_meditation: '/meditation', voice: '/tts', bgm: '/bgm', mix: '/mixdown',
}

function downstreamOf(artifact: Artifact): { path: string; label: string } | null {
  if (artifact.type === 'script_meditation') return { path: `/tts?artifact_id=${artifact.id}`, label: '送去 TTS' }
  if (artifact.type === 'voice') return { path: `/mixdown?voice_id=${artifact.id}`, label: '送去混音' }
  if (artifact.type === 'bgm') return { path: `/mixdown?bgm_id=${artifact.id}`, label: '送去混音' }
  return null
}

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
    queryKey: ['artifacts', 'library'],
    queryFn: () => listArtifacts({ limit: 500 }).then((response) => response.items),
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

  const clearMutation = useMutation({
    mutationFn: clearArtifacts,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      setSelected(null)
      message.success(`已清空 ${result.deleted} 个产物`)
    },
    onError: () => message.error('清空产物库失败'),
  })

  const visibleArtifacts = useMemo(
    () => activeTab === 'all' ? artifacts : artifacts.filter((artifact) => artifact.type === activeTab),
    [activeTab, artifacts],
  )
  const countOf = (tab: LibraryTab) => tab === 'all'
    ? artifacts.length
    : artifacts.filter((artifact) => artifact.type === tab).length

  const closeDetail = () => {
    setSelected(null)
    if (requestedArtifactId) setSearchParams({}, { replace: true })
  }

  return (
    <div className="page-stack library-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">产物库</h2>
          <p className="page-desc">统一查看和管理脚本、人声、背景音与混音成品</p>
        </div>
        <Popconfirm title="清空全部产物？" description="脚本版本、音频文件和波形缓存都会删除，此操作无法恢复。" okText="确认清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => clearMutation.mutate()}>
          <Button danger icon={<ClearOutlined />} disabled={artifacts.length === 0} loading={clearMutation.isPending}>清空全部</Button>
        </Popconfirm>
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
      ) : visibleArtifacts.length === 0 ? (
        <Card>
          <Empty description={activeTab === 'all' ? '产物库为空' : `暂无${TAB_LABELS[activeTab]}产物`}>
            <Button type="primary" onClick={() => navigate(EMPTY_ROUTES[activeTab])}>
              {`去创建${activeTab === 'all' ? '产物' : TAB_LABELS[activeTab]}`}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="library-grid">
          {visibleArtifacts.map((artifact) => {
            const meta = ARTIFACT_TYPE_META[artifact.type]
            const downstream = downstreamOf(artifact)
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
                  {downstream && <Button size="small" icon={<SendOutlined />} onClick={() => navigate(downstream.path)}>{downstream.label}</Button>}
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
