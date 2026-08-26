import { AudioOutlined, CloseOutlined, CustomerServiceOutlined, SendOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Empty, Input, Progress, Radio, Segmented, Select, Skeleton, Slider, Space, Tabs, Tag } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getArtifact, listArtifacts } from '../api/artifacts'
import { ApiError } from '../api/client'
import { listConversations } from '../api/conversations'
import { cancelRun } from '../api/runs'
import { getTtsDefaults, submitTtsJob, voicePreviewUrl } from '../api/tts'
import type { Artifact, AudioFormat, Scene, TtsProgressEvent } from '../api/types'
import AudioPlayer from '../components/AudioPlayer'
import WaveformView from '../components/WaveformView'
import { buildScriptSourceOptions, pickVoiceId } from '../features/tts/form'
import type { ScriptSourceOption } from '../features/tts/form'
import { useRunStream } from '../lib/sse'
import { useRunStore } from '../stores/runStore'

type SourceMode = 'artifact' | 'paste'
const STAGE_LABELS: Record<string, string> = { queued: '等待执行', synthesizing: '逐段合成人声', assembling: '拼接音频', encoding: '编码导出' }

export default function TtsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialArtifactId = searchParams.get('artifact_id')
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialArtifactId ? 'artifact' : 'paste')
  const [artifactId, setArtifactId] = useState<string | null>(initialArtifactId)
  const [text, setText] = useState('')
  const [scene, setScene] = useState<Scene>('meditation')
  const [engineId, setEngineId] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [speed, setSpeed] = useState(0.8)
  const [pitch, setPitch] = useState<number | null>(null)
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<TtsProgressEvent | null>(null)
  const [queuePosition, setQueuePosition] = useState(0)
  const [result, setResult] = useState<Artifact | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const initialized = useRef(false)
  const registerRun = useRunStore((state) => state.registerRun)
  const updateRunStatus = useRunStore((state) => state.updateRunStatus)
  const unregisterRun = useRunStore((state) => state.unregisterRun)

  const defaultsQuery = useQuery({ queryKey: ['tts-defaults'], queryFn: getTtsDefaults })
  const scriptsQuery = useQuery({ queryKey: ['artifacts', 'script_meditation', 500], queryFn: () => listArtifacts({ type: 'script_meditation', limit: 500 }) })
  const conversationsQuery = useQuery({ queryKey: ['conversations', 'meditation', 500], queryFn: () => listConversations({ scene: 'meditation', limit: 500 }) })
  const selectedArtifactQuery = useQuery({ queryKey: ['artifact', artifactId], queryFn: ({ signal }) => getArtifact(artifactId!, signal), enabled: Boolean(artifactId) })
  const engines = defaultsQuery.data?.engines ?? []
  const engine = engines.find((item) => item.id === engineId)
  const preset = defaultsQuery.data?.scene_presets[scene]
  const scriptOptions = useMemo(
    () => buildScriptSourceOptions(scriptsQuery.data?.items ?? [], conversationsQuery.data?.items ?? []),
    [conversationsQuery.data, scriptsQuery.data],
  )

  useEffect(() => {
    if (!defaultsQuery.data || initialized.current) return
    const first = defaultsQuery.data.engines[0]
    if (!first) return
    initialized.current = true
    setEngineId(first.id)
    setVoiceId(first.voices[0]?.id ?? '')
    setSpeed(defaultsQuery.data.scene_presets.meditation?.speed ?? 0.8)
  }, [defaultsQuery.data])

  useEffect(() => {
    if (selectedArtifactQuery.data?.type === 'script_meditation') setScene('meditation')
  }, [selectedArtifactQuery.data])

  const chooseScene = (next: Scene) => {
    setScene(next)
    const nextPreset = defaultsQuery.data?.scene_presets[next]
    if (nextPreset) {
      setSpeed(nextPreset.speed)
      setVoiceId(pickVoiceId(engine, nextPreset))
    }
  }

  const chooseEngine = (nextId: string) => {
    const next = engines.find((item) => item.id === nextId)
    setEngineId(nextId)
    setVoiceId(pickVoiceId(next, preset))
    if (!next?.supports_pitch) setPitch(null)
    setPreviewSrc(null)
  }

  const requestPayload = useMemo(() => ({
    script_artifact_id: sourceMode === 'artifact' ? artifactId : null,
    text: sourceMode === 'paste' ? text : null,
    scene, engine: engineId, voice_id: voiceId, speed,
    pitch: engine?.supports_pitch ? pitch : null, format,
  }), [artifactId, engine?.supports_pitch, engineId, format, pitch, scene, sourceMode, speed, text, voiceId])

  const submitMutation = useMutation({
    mutationFn: () => submitTtsJob(requestPayload),
    onSuccess: (run) => {
      setResult(null); setFailure(null); setProgress(null); setRunId(run.run_id)
      registerRun({ runId: run.run_id, kind: 'tts', status: run.status })
    },
    onError: (error) => {
      const detail = error instanceof ApiError ? error.message : '提交 TTS 任务失败'
      setFailure(detail); message.error(detail)
    },
  })
  const cancelMutation = useMutation({ mutationFn: () => cancelRun(runId!), onError: () => message.error('取消任务失败') })

  useRunStream(runId, {
    'run.status': (event) => {
      setQueuePosition(event.queue_position)
      if (event.progress) setProgress({ stage: event.progress.stage as TtsProgressEvent['stage'], segment: event.progress.completed, total_segments: event.progress.total })
    },
    'run.started': () => { if (runId) updateRunStatus(runId, 'running') },
    'tts.progress': setProgress,
    'run.completed': ({ artifact_id }) => {
      if (runId) { updateRunStatus(runId, 'completed'); unregisterRun(runId) }
      setRunId(null)
      if (artifact_id) getArtifact(artifact_id).then((artifact) => {
        setResult(artifact); queryClient.invalidateQueries({ queryKey: ['artifacts'] }); message.success('人声合成完成')
      }).catch(() => setFailure('合成完成，但加载产物失败'))
    },
    'run.failed': (error) => { if (runId) unregisterRun(runId); setRunId(null); setFailure(error.message || 'TTS 引擎调用失败') },
    'run.cancelled': () => { if (runId) unregisterRun(runId); setRunId(null); setProgress(null); message.info('任务已取消') },
  })

  const submitDisabled = !engineId || !voiceId || (sourceMode === 'artifact' ? !artifactId : text.trim().length === 0)
  const total = progress?.total_segments ?? 0
  const completed = progress?.segment ?? 0
  const percent = total > 0 ? Math.round((completed / total) * 85) : runId ? 5 : 0
  const stagePercent = progress?.stage === 'assembling' ? 90 : progress?.stage === 'encoding' ? 97 : percent
  if (defaultsQuery.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />

  return <div className="tts-page">
    <div className="tts-page-head"><h2>TTS 人声合成</h2><p>把带停顿、呼吸和情绪标记的脚本合成为可直接送去混音的人声干声。</p></div>
    <div className="tts-grid">
      <Card title="合成参数" className="tts-card">
        <Tabs activeKey={sourceMode} onChange={(key) => setSourceMode(key as SourceMode)} items={[
          { key: 'artifact', label: '产物库脚本', children: <Select value={artifactId} onChange={setArtifactId}
            options={scriptOptions} showSearch optionFilterProp="searchText"
            optionRender={(option) => { const source = option.data as ScriptSourceOption; return <div className="tts-script-option"><strong>{source.primary}</strong><span>{source.secondary} · {new Date(source.updatedAt).toLocaleString('zh-CN')}</span></div> }}
            placeholder="选择脚本产物" style={{ width: '100%' }} loading={scriptsQuery.isLoading || conversationsQuery.isLoading} /> },
          { key: 'paste', label: '粘贴文本', children: <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} rows={7} maxLength={20000} showCount
            placeholder="输入文本，可包含 [停顿 3s]、[吸气]、[呼气]、[情绪:温柔]、[语速:慢速] 等标记" /> },
        ]} />
        <div className="tts-field"><label>使用场景</label><Segmented block value={scene} disabled={sourceMode === 'artifact' && Boolean(artifactId)}
          options={[{ label: '冥想', value: 'meditation' }, { label: '播客', value: 'podcast' }]} onChange={(value) => chooseScene(value as Scene)} /><small>{preset?.note}</small></div>
        <div className="tts-field"><label>TTS 引擎</label><Select value={engineId} onChange={chooseEngine}
          options={engines.map((item) => ({ value: item.id, label: `${item.name} · ${item.model}` }))} style={{ width: '100%' }} /></div>
        <div className="tts-field"><label>音色</label><Space.Compact block><Select value={voiceId} onChange={(value) => { setVoiceId(value); setPreviewSrc(null) }}
          options={(engine?.voices ?? []).map((voice) => ({ value: voice.id, label: `${preset?.recommended_voice_ids.includes(voice.id) ? '★ ' : ''}${voice.name} · ${voice.tags.join('/')}` }))}
          style={{ width: '100%' }} /><Button icon={<AudioOutlined />} onClick={() => setPreviewSrc(voicePreviewUrl(engineId, voiceId))}>试听</Button></Space.Compact>
          {previewSrc && <audio className="tts-preview" controls autoPlay src={previewSrc} />}</div>
        <div className="tts-field"><label>语速 <b>{speed.toFixed(2)}x</b></label><Slider min={0.5} max={1.5} step={0.05} value={speed} onChange={setSpeed} /></div>
        <div className="tts-field"><label>音调 <b>{pitch === null ? '默认' : `${pitch > 0 ? '+' : ''}${pitch} 半音`}</b></label><Slider min={-12} max={12} step={1} value={pitch ?? 0}
          disabled={!engine?.supports_pitch} onChange={(value) => setPitch(value === 0 ? null : value)} />{!engine?.supports_pitch && <small>当前引擎不支持音调调节，将使用默认音调。</small>}</div>
        <div className="tts-field"><label>输出格式</label><Radio.Group value={format} onChange={(event) => setFormat(event.target.value as AudioFormat)}><Radio.Button value="mp3">MP3 · 320k</Radio.Button><Radio.Button value="wav">WAV · 48kHz/16bit</Radio.Button></Radio.Group></div>
        <Button type="primary" block size="large" icon={<CustomerServiceOutlined />} disabled={submitDisabled || Boolean(runId)} loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>开始合成人声</Button>
      </Card>
      <Card title="合成结果" className="tts-card tts-result-card">
        {runId ? <div className="tts-running"><CustomerServiceOutlined /><h3>{STAGE_LABELS[progress?.stage ?? 'queued']}</h3>
          <p>{progress?.stage === 'synthesizing' ? `${completed} / ${total} 段` : queuePosition > 0 ? `前方还有 ${queuePosition} 个任务` : '正在准备任务'}</p>
          <Progress percent={stagePercent} status="active" /><Button danger icon={<CloseOutlined />} loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>取消任务</Button></div>
        : failure ? <div className="tts-failure"><Alert type="error" showIcon message="合成失败" description={failure} /><Button type="primary" disabled={submitDisabled} onClick={() => submitMutation.mutate()}>重新提交</Button></div>
        : result?.audio ? <div className="tts-result"><div className="tts-result-tags"><Tag color="purple">人声干声</Tag><Tag>{String(result.params?.voice_name ?? voiceId)}</Tag><Tag>{result.audio.format.toUpperCase()}</Tag><Tag>{result.audio.duration.toFixed(1)} 秒</Tag></div>
          <WaveformView artifactId={result.id} /><AudioPlayer src={result.audio.url} label={result.name} /><Button type="primary" icon={<SendOutlined />} onClick={() => navigate(`/mixdown?voice_id=${result.id}`)}>送去混音</Button></div>
        : <Empty description="选择脚本和音色后开始合成，结果会自动存入产物库" />}
      </Card>
    </div>
  </div>
}
