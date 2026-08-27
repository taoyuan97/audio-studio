import {
  ArrowRightOutlined,
  CloudOutlined,
  CustomerServiceOutlined,
  FolderOutlined,
  SlidersOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Card, Empty, Skeleton, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getStats } from '../api/settings'
import type { ArtifactType, RunKind } from '../api/types'
import { ARTIFACT_TYPE_META, formatArtifactTime } from '../features/library/artifactMeta'

const MODULES = [
  { path: '/meditation', icon: <CloudOutlined />, name: '冥想脚本', description: '对话式生成带停顿、情绪与语速标记的引导脚本', available: true },
  { path: '/tts', icon: <SoundOutlined />, name: 'TTS 人声', description: '从脚本产物或粘贴文本合成可播放的人声干声', available: true },
  { path: '/bgm', icon: <CustomerServiceOutlined />, name: '背景音', description: 'BGM 功能当前阻塞', available: false },
  { path: '/mixdown', icon: <SlidersOutlined />, name: '混音', description: '人声与背景音的最终合成', available: false },
  { path: '/library', icon: <FolderOutlined />, name: '产物库', description: '统一查看和管理冥想脚本与 TTS 人声', available: true },
] as const

const RUN_LABELS: Partial<Record<RunKind, string>> = { script: '冥想脚本生成中', tts: 'TTS 人声合成中' }

/** T007-A：首页仅呈现当前已开放的冥想、TTS 与产物库能力。 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => getStats(signal), refetchInterval: 30_000 })
  const stats = statsQuery.data
  const recent = (stats?.recent_artifacts ?? []).filter((artifact) => artifact.type === 'script_meditation' || artifact.type === 'voice')
  const activeRuns = (stats?.active_runs ?? []).filter((run) => run.kind === 'script' || run.kind === 'tts')

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-hero">
        <h1>AI 音频工作台</h1>
        <p>从冥想脚本生成到 TTS 人声合成，当前产物会自动汇入产物库。</p>
        {activeRuns.length > 0 && (
          <div className="dashboard-runs">
            {activeRuns.map((run) => <Tag color="processing" key={run.run_id}>{RUN_LABELS[run.kind] ?? run.kind}</Tag>)}
          </div>
        )}
      </section>

      <div className="dashboard-module-grid">
        {MODULES.map((module) => (
          <Card
            key={module.path}
            className={`dashboard-module-card${module.available ? '' : ' is-deferred'}`}
            hoverable={module.available}
            onClick={module.available ? () => navigate(module.path) : undefined}
          >
            <div className="dashboard-module-icon">{module.icon}</div>
            <div className="dashboard-module-title">
              <span>{module.name}</span>
              {module.available ? <ArrowRightOutlined /> : <Tag>后续开放</Tag>}
            </div>
            <p>{module.description}</p>
          </Card>
        ))}
      </div>

      {statsQuery.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
        <>
          <Card title="产物概览" extra={<button className="dashboard-text-link" onClick={() => navigate('/library')}>进入产物库 <ArrowRightOutlined /></button>}>
            <div className="dashboard-stats">
              <div><strong>{stats?.artifact_counts.script_meditation ?? 0}</strong><span>冥想脚本</span></div>
              <div><strong>{stats?.artifact_counts.voice ?? 0}</strong><span>TTS 人声</span></div>
              <div className="is-deferred"><strong>—</strong><span>背景音 · 后续开放</span></div>
              <div className="is-deferred"><strong>—</strong><span>成品 · 后续开放</span></div>
            </div>
          </Card>

          <Card title="最近产物">
            {recent.length === 0 ? <Empty description="暂无冥想脚本或 TTS 人声产物" /> : (
              <div className="dashboard-recent-list">
                {recent.map((artifact) => {
                  const meta = ARTIFACT_TYPE_META[artifact.type as ArtifactType]
                  return (
                    <button key={artifact.id} onClick={() => navigate(`/library?artifact_id=${artifact.id}`)}>
                      <Tag color={meta.color}>{meta.label}</Tag>
                      <span>{artifact.name}</span>
                      <time>{formatArtifactTime(artifact.created_at)}</time>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}

    </div>
  )
}
