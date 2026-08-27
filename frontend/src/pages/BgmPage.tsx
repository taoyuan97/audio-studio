import { CloseOutlined, SendOutlined, SoundOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Empty, Input, Popconfirm, Progress, Radio, Skeleton, Slider, Space, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getArtifact } from '../api/artifacts'
import { ApiError } from '../api/client'
import { getMusicDefaults, retryMusicJob, submitMusicJob } from '../api/music'
import { cancelRun, getRun } from '../api/runs'
import type { Artifact, AudioFormat, MusicProgressEvent, MusicRetryInfo, RetryMusicJobRequest } from '../api/types'
import AudioPlayer from '../components/AudioPlayer'
import WaveformView from '../components/WaveformView'
import RetryActions from '../features/bgm/RetryActions'
import { useRunStream } from '../lib/sse'
import { useRunStore } from '../stores/runStore'

const PHASE_LABELS: Record<string, string> = { queued: '等待执行', generating: 'MiniMax 生成中', downloading: '下载源音频', processing: '循环、淡化与编码' }
const STRUCTURE_LABELS: Record<string, string> = { intro: 'Intro 引子', build_up: 'Build Up 渐强', drop: 'Drop 释放', outro: 'Outro 收束' }
const ERROR_LABELS: Record<string, string> = {
  MUSIC_AUTH_FAILED: 'MiniMax API Key 无效或未配置', MUSIC_RATE_LIMITED: 'MiniMax 当前请求较多，请稍后重试',
  MUSIC_ACCESS_DENIED: 'MiniMax 模型权限、余额或额度不足', MUSIC_CONTENT_REJECTED: '音乐描述未通过内容审核，请调整后重试',
  MUSIC_TIMEOUT: 'MiniMax 生成等待超时', MUSIC_DOWNLOAD_FAILED: '源音频下载失败',
  MUSIC_FFMPEG_MISSING: '本机缺少可用的 FFmpeg/FFprobe', MUSIC_PROCESSING_ERROR: '音乐后处理失败',
}

function formatWait(seconds = 0): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

interface FailureState { code: string; message: string; runId: string; retry: MusicRetryInfo | null }

export default function BgmPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const [targetDuration, setTargetDuration] = useState(300)
  const [structureHints, setStructureHints] = useState<string[]>([])
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<MusicProgressEvent | null>(null)
  const [queuePosition, setQueuePosition] = useState(0)
  const [result, setResult] = useState<Artifact | null>(null)
  const [failure, setFailure] = useState<FailureState | null>(null)
  const registerRun = useRunStore((state) => state.registerRun)
  const updateRunStatus = useRunStore((state) => state.updateRunStatus)
  const unregisterRun = useRunStore((state) => state.unregisterRun)
  const defaultsQuery = useQuery({ queryKey: ['music-defaults'], queryFn: getMusicDefaults })
  const payload = useMemo(() => ({ prompt: prompt.trim(), target_duration: targetDuration, structure_hints: structureHints, format }), [format, prompt, structureHints, targetDuration])

  const startRun = (run: { run_id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' }) => {
    setResult(null); setFailure(null); setProgress(null); setRunId(run.run_id)
    registerRun({ runId: run.run_id, kind: 'music', status: run.status })
  }
  const submitMutation = useMutation({
    mutationFn: () => submitMusicJob(payload), onSuccess: startRun,
    onError: (error) => message.error(error instanceof ApiError ? error.message : '提交 BGM 任务失败'),
  })
  const retryMutation = useMutation({
    mutationFn: ({ failedRunId, request }: { failedRunId: string; request: RetryMusicJobRequest }) => retryMusicJob(failedRunId, request),
    onSuccess: startRun,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'MUSIC_URL_EXPIRED') setFailure((current) => current ? { ...current, retry: { download_available: false, expires_at: current.retry?.expires_at ?? null } } : current)
      message.error(error instanceof ApiError ? error.message : '重试失败')
    },
  })
  const cancelMutation = useMutation({ mutationFn: () => cancelRun(runId!), onError: () => message.error('取消任务失败') })

  useRunStream(runId, {
    'run.status': (event) => {
      setQueuePosition(event.queue_position)
      if (event.progress?.stage) setProgress((current) => ({ phase: event.progress!.stage as MusicProgressEvent['phase'], waited_s: current?.waited_s }))
    },
    'run.started': () => { if (runId) updateRunStatus(runId, 'running') },
    'music.progress': setProgress,
    'run.completed': ({ artifact_id }) => {
      const completedRunId = runId
      if (completedRunId) { updateRunStatus(completedRunId, 'completed'); unregisterRun(completedRunId) }
      setRunId(null)
      if (artifact_id) getArtifact(artifact_id).then((artifact) => {
        setResult(artifact); queryClient.invalidateQueries({ queryKey: ['artifacts'] }); message.success('BGM 已生成并自动存入产物库')
      }).catch(() => setFailure({ code: 'ARTIFACT_LOAD_FAILED', message: '生成完成，但加载产物失败', runId: completedRunId ?? '', retry: null }))
    },
    'run.failed': (error) => {
      const failedRunId = runId
      if (failedRunId) unregisterRun(failedRunId)
      setRunId(null)
      if (!failedRunId) return
      setFailure({ code: error.code, message: error.message, runId: failedRunId, retry: null })
      getRun(failedRunId).then((run) => setFailure((current) => current?.runId === failedRunId ? { ...current, retry: run.music_retry } : current)).catch(() => undefined)
    },
    'run.cancelled': () => { if (runId) unregisterRun(runId); setRunId(null); setProgress(null); message.info('本地任务已取消；服务商侧生成及计费可能已经发生') },
  })

  const appendSuggestion = (text: string) => setPrompt((current) => current.trim() ? `${current.trim()}，${text}`.slice(0, 2000) : text)
  const phase = progress?.phase ?? 'queued'
  const percent = phase === 'generating' ? 18 : phase === 'downloading' ? 58 : phase === 'processing' ? 86 : 5
  const submitDisabled = !prompt.trim() || prompt.trim().length > 2000 || Boolean(runId)
  const resultHints = (result?.params?.structure_hints as string[] | undefined) ?? structureHints

  if (defaultsQuery.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (defaultsQuery.isError || !defaultsQuery.data) return <Alert type="error" showIcon message="无法加载 BGM 配置" />
  const defaults = defaultsQuery.data

  return <div className="bgm-page">
    <div className="bgm-page-head"><h2>BGM 背景音乐</h2><p>用自然语言描述风格、情绪、场景和乐器，生成可循环的纯音乐背景轨。</p></div>
    <div className="bgm-grid">
      <Card title="音乐描述" className="bgm-card">
        <div className="bgm-provider"><Tag color="purple">{defaults.provider}</Tag><Tag>{defaults.model}</Tag><span>纯音乐 · Prompt 最长 {defaults.capabilities.prompt_max_length} 字</span></div>
        <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} maxLength={2000} showCount placeholder="例如：空灵缓慢的冥想背景音乐，以古琴和柔和电子 Pad 为主，无明显鼓点，动态平稳，结尾自然收束。" />
        <div className="bgm-suggestions"><small>灵感示例（只会填充描述，不限制可用风格）</small><Space wrap>
          {defaults.prompt_suggestions.map((item) => <Button key={item.id} size="small" onClick={() => appendSuggestion(item.prompt)}>{item.label}</Button>)}
        </Space></div>
        <div className="bgm-field"><label>目标时长 <b>{targetDuration / 60} 分钟</b></label><Slider min={defaults.duration_range.min} max={defaults.duration_range.max} step={60} value={targetDuration} tooltip={{ formatter: (value) => `${Number(value) / 60} 分钟` }} onChange={setTargetDuration} /><small>模型先生成源音乐，本地后处理会循环或截断到目标时长。</small></div>
        <div className="bgm-field"><label>结构倾向 <span>可选，非确定性提示</span></label><Checkbox.Group value={structureHints} onChange={(values) => setStructureHints(values as string[])}><Space wrap>{defaults.structure_hints.map((hint) => <Checkbox key={hint} value={hint}>{STRUCTURE_LABELS[hint] ?? hint}</Checkbox>)}</Space></Checkbox.Group></div>
        <div className="bgm-field"><label>输出格式</label><Radio.Group value={format} onChange={(event) => setFormat(event.target.value as AudioFormat)}><Radio.Button value="mp3">MP3 · 320k</Radio.Button><Radio.Button value="wav">WAV · 48kHz/16bit</Radio.Button></Radio.Group></div>
        <Button type="primary" block size="large" icon={<SoundOutlined />} disabled={submitDisabled} loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>生成纯音乐</Button>
      </Card>
      <Card title="生成结果" className="bgm-card bgm-result-card">
        {runId ? <div className="bgm-running"><SoundOutlined /><h3>{PHASE_LABELS[phase]}</h3><p>{phase === 'generating' ? `已等待 ${formatWait(progress?.waited_s)}` : queuePosition > 0 ? `前方还有 ${queuePosition} 个任务` : '正在处理，请稍候'}</p><Progress percent={percent} status="active" />
          <Popconfirm title="取消后将放弃本次结果" description="MiniMax 侧生成和计费可能已经发生，确定取消吗？" okText="确定取消" cancelText="继续等待" onConfirm={() => cancelMutation.mutate()}><Button danger icon={<CloseOutlined />} loading={cancelMutation.isPending}>取消任务</Button></Popconfirm></div>
        : failure ? <div className="bgm-failure"><Alert type="error" showIcon message={ERROR_LABELS[failure.code] ?? 'BGM 生成失败'} description={failure.message} />
          <RetryActions downloadAvailable={Boolean(failure.retry?.download_available)} loading={retryMutation.isPending}
            onDownload={() => retryMutation.mutate({ failedRunId: failure.runId, request: { mode: 'download' } })}
            onRegenerate={() => retryMutation.mutate({ failedRunId: failure.runId, request: { mode: 'regenerate', confirm_regenerate: true } })} /></div>
        : result?.audio ? <div className="bgm-result"><div className="bgm-result-tags"><Tag color="purple">背景音乐</Tag><Tag>{String(result.params?.model ?? defaults.model)}</Tag><Tag>{result.audio.format.toUpperCase()}</Tag><Tag>{(result.audio.duration / 60).toFixed(1)} 分钟</Tag></div>
          <WaveformView artifactId={result.id} structureHints={resultHints} /><AudioPlayer src={result.audio.url} label={result.name} /><div className="bgm-summary"><strong>创作描述</strong><p>{String(result.params?.prompt ?? prompt)}</p>{resultHints.length > 0 && <small>结构倾向：{resultHints.map((item) => STRUCTURE_LABELS[item] ?? item).join(' / ')}</small>}</div><Button type="primary" icon={<SendOutlined />} onClick={() => navigate(`/mixdown?bgm_id=${result.id}`)}>送去混音</Button></div>
        : <Empty description="输入音乐描述后开始生成，结果会自动存入产物库" />}
      </Card>
    </div>
  </div>
}
