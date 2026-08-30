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
  { path: '/bgm', icon: <CustomerServiceOutlined />, name: '背景音', description: '用自然语言生成可循环的纯音乐背景轨', available: true },
  { path: '/mixdown', icon: <SlidersOutlined />, name: '混音', description: '人声与背景音的最终合成', available: false },
  { path: '/library', icon: <FolderOutlined />, name: '产物库', description: '统一查看和管理脚本、人声、背景音与成品', available: true },
] as const

const RUN_LABELS: Record<RunKind, string> = {
  script: '冥想脚本生成中', tts: 'TTS 人声合成中', music: 'BGM 生成中', mixdown: '混音处理中',
}
const RUN_ROUTES: Record<RunKind, string> = { script: '/meditation', tts: '/tts', music: '/bgm', mixdown: '/mixdown' }

export default function DashboardPage() {
  const navigate = useNavigate()
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => getStats(signal), refetchInterval: 30_000 })
  const stats = statsQuery.data
  const recent = stats?.recent_artifacts ?? []
  const activeRuns = stats?.active_runs ?? []

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-hero">
        <h1>AI 音频工作台</h1>
        <p>从冥想脚本、TTS 人声到背景音乐，生成产物会自动汇入产物库。</p>
        {activeRuns.length > 0 && (
          <div className="dashboard-runs">
            {activeRuns.map((run) => <Tag className="dashboard-run-tag" color="processing" key={run.run_id} onClick={() => navigate(RUN_ROUTES[run.kind])}>{RUN_LABELS[run.kind]}</Tag>)}
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
              <div><strong>{stats?.artifact_counts.bgm ?? 0}</strong><span>背景音</span></div>
              <div><strong>{stats?.artifact_counts.mix ?? 0}</strong><span>混音成品</span></div>
            </div>
          </Card>

          <Card title="最近产物">
            {recent.length === 0 ? <Empty description="暂无产物" /> : (
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
          <Card title="快速开始">
            <div className="dashboard-quick-start">
              <button onClick={() => navigate('/meditation')}><strong>1</strong><span>生成冥想脚本</span></button>
              <ArrowRightOutlined />
              <button onClick={() => navigate('/tts')}><strong>2</strong><span>合成 TTS 人声</span></button>
              <ArrowRightOutlined />
              <button onClick={() => navigate('/bgm')}><strong>3</strong><span>可选：生成背景音</span></button>
              <ArrowRightOutlined />
              <button disabled><strong>4</strong><span>混音导出（待 T006）</span></button>
            </div>
          </Card>
        </>
      )}

    </div>
  )
}
