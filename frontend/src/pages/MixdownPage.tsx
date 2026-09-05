import { CloseOutlined, ExportOutlined, SettingOutlined, SlidersOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Empty, Progress, Radio, Select, Skeleton, Slider, Space, Switch, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getArtifact, listArtifacts } from '../api/artifacts'
import { ApiError } from '../api/client'
import { submitMixdownJob } from '../api/mixdown'
import { cancelRun } from '../api/runs'
import type { Artifact, AudioFormat, MixProgressEvent } from '../api/types'
import AudioPlayer from '../components/AudioPlayer'
import WaveformView from '../components/WaveformView'
import DualTrackWaveform from '../features/mixdown/DualTrackWaveform'
import { artifactSummary, effectiveDuration, mixRuleText } from '../features/mixdown/rules'
import { useRunStream } from '../lib/sse'
import { useRunStore } from '../stores/runStore'

const PHASE_LABELS: Record<string, string> = { queued: '等待执行', prep: '准备音轨', ducking: '闪避分析', encode: '编码导出' }
const ERROR_LABELS: Record<string, string> = {
  MIX_FFMPEG_MISSING: '本机缺少可用的 FFmpeg/FFprobe',
  MIX_FFMPEG_ERROR: '混音执行失败',
  MIX_INPUT_INVALID: '所选音轨已失效',
}

interface FailureState { code: string; message: string }

export default function MixdownPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [voiceId, setVoiceId] = useState<string | null>(searchParams.get('voice_id'))
  const [bgmId, setBgmId] = useState<string | null>(searchParams.get('bgm_id'))
  const [voiceSpeed, setVoiceSpeed] = useState(1)
  const [bgmSpeed, setBgmSpeed] = useState(1)
  const [voiceGain, setVoiceGain] = useState(80)
  const [bgmGain, setBgmGain] = useState(45)
  const [bgmOffset, setBgmOffset] = useState(0)
  const [ducking, setDucking] = useState(true)
  const [format, setFormat] = useState<AudioFormat>('mp3')
  const [runId, setRunId] = useState<string | null>(null)
  const [phase, setPhase] = useState<MixProgressEvent['phase'] | 'queued'>('queued')
  const [queuePosition, setQueuePosition] = useState(0)
  const [result, setResult] = useState<Artifact | null>(null)
  const [failure, setFailure] = useState<FailureState | null>(null)
  const registerRun = useRunStore((state) => state.registerRun)
  const updateRunStatus = useRunStore((state) => state.updateRunStatus)
  const unregisterRun = useRunStore((state) => state.unregisterRun)

  const voicesQuery = useQuery({ queryKey: ['artifacts', 'voice', 500], queryFn: () => listArtifacts({ type: 'voice', limit: 500 }) })
  const bgmsQuery = useQuery({ queryKey: ['artifacts', 'bgm', 500], queryFn: () => listArtifacts({ type: 'bgm', limit: 500 }) })
  const voices = voicesQuery.data?.items ?? []
  const bgms = bgmsQuery.data?.items ?? []
  const voice = voices.find((item) => item.id === voiceId) ?? null
  const bgm = bgms.find((item) => item.id === bgmId) ?? null
  useEffect(() => {
    if (voicesQuery.isSuccess && voiceId && !voice) setVoiceId(null)
    if (bgmsQuery.isSuccess && bgmId && !bgm) setBgmId(null)
  }, [bgm, bgmId, bgmsQuery.isSuccess, voice, voiceId, voicesQuery.isSuccess])
  const payload = useMemo(() => ({
    voice_artifact_id: voice?.id ?? null,
    bgm_artifact_id: bgm?.id ?? null,
    voice_speed: voice ? voiceSpeed : 1,
    bgm_speed: bgm ? bgmSpeed : 1,
    voice_gain: voiceGain,
    bgm_gain: bgmGain,
    bgm_offset: voice && bgm ? bgmOffset : 0,
    ducking: Boolean(voice && bgm && ducking),
    format,
  }), [bgm, bgmGain, bgmOffset, bgmSpeed, ducking, format, voice, voiceGain, voiceSpeed])

  const submitMutation = useMutation({
    mutationFn: () => submitMixdownJob(payload),
    onSuccess: (run) => {
      setResult(null); setFailure(null); setPhase('queued'); setRunId(run.run_id)
      registerRun({ runId: run.run_id, kind: 'mixdown', status: run.status })
    },
    onError: (error) => {
      const detail = error instanceof ApiError ? error.message : '提交混音任务失败'
      const code = error instanceof ApiError ? error.code : 'MIX_SUBMIT_FAILED'
      setFailure({ code, message: detail }); message.error(detail)
    },
  })
  const cancelMutation = useMutation({ mutationFn: () => cancelRun(runId!), onError: () => message.error('取消任务失败') })

  useRunStream(runId, {
    'run.status': (event) => {
      setQueuePosition(event.queue_position)
      if (event.progress?.stage) setPhase(event.progress.stage as MixProgressEvent['phase'])
    },
    'run.started': () => { if (runId) updateRunStatus(runId, 'running') },
    'mix.progress': (event) => setPhase(event.phase),
    'run.completed': ({ artifact_id }) => {
      const completedRunId = runId
      if (completedRunId) { updateRunStatus(completedRunId, 'completed'); unregisterRun(completedRunId) }
      setRunId(null)
      if (artifact_id) getArtifact(artifact_id).then((artifact) => {
        setResult(artifact); queryClient.invalidateQueries({ queryKey: ['artifacts'] }); message.success('混音完成并自动存入产物库')
      }).catch(() => setFailure({ code: 'ARTIFACT_LOAD_FAILED', message: '混音完成，但加载成品失败' }))
    },
    'run.failed': (error) => { if (runId) unregisterRun(runId); setRunId(null); setFailure(error) },
    'run.cancelled': () => { if (runId) unregisterRun(runId); setRunId(null); setPhase('queued'); message.info('混音任务已取消') },
  })

  const renderOption = (artifact: Artifact) => <div className="mix-track-option"><strong>{artifact.name}</strong><span>{artifactSummary(artifact)}</span></div>
  const percent = phase === 'prep' ? 20 : phase === 'ducking' ? 55 : phase === 'encode' ? 88 : 5
  const disabled = (!voice && !bgm) || Boolean(runId)
  if (voicesQuery.isLoading || bgmsQuery.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (voicesQuery.isError || bgmsQuery.isError) return <Alert type="error" showIcon message="无法加载音轨产物" />

  return <div className="mix-page">
    <div className="mix-page-head"><h2>最终混音</h2><p>组合人声与背景音乐，分别设置倍速、音量、偏移和人声闪避后导出成品。</p></div>
    <div className="mix-grid">
      <Card title="轨道与参数" className="mix-card">
        <div className="mix-field"><label>人声轨 <span>可为空</span></label><Select allowClear value={voiceId} onChange={(value) => setVoiceId(value ?? null)} placeholder="选择人声产物" style={{ width: '100%' }}
          options={voices.map((item) => ({ value: item.id, label: item.name, artifact: item }))}
          optionRender={(option) => renderOption(option.data.artifact as Artifact)} /></div>
        <div className="mix-field"><label>背景音轨 <span>可为空</span></label><Select allowClear value={bgmId} onChange={(value) => setBgmId(value ?? null)} placeholder="选择背景音乐产物" style={{ width: '100%' }}
          options={bgms.map((item) => ({ value: item.id, label: item.name, artifact: item }))}
          optionRender={(option) => renderOption(option.data.artifact as Artifact)} /></div>
        <Alert className="mix-rule" type={voiceId || bgmId ? 'info' : 'warning'} showIcon message="组合规则" description={mixRuleText(voice, bgm, voiceSpeed, bgmSpeed)} />
        <div className="mix-field"><label>人声倍速 <b>{voiceSpeed.toFixed(2)}x</b></label><Slider ariaLabelForHandle="人声倍速" min={0.5} max={2} step={0.05} value={voiceSpeed} disabled={!voiceId} tooltip={{ formatter: (value) => `${Number(value).toFixed(2)}x` }} onChange={setVoiceSpeed} />{voice && <small>调整后预计 {effectiveDuration(voice, voiceSpeed).toFixed(1)} 秒，保持原音调</small>}</div>
        <div className="mix-field"><label>人声音量 <b>{voiceGain}%</b></label><Slider ariaLabelForHandle="人声音量" min={0} max={100} value={voiceGain} disabled={!voiceId} onChange={setVoiceGain} /></div>
        <div className="mix-field"><label>背景倍速 <b>{bgmSpeed.toFixed(2)}x</b></label><Slider ariaLabelForHandle="背景倍速" min={0.5} max={2} step={0.05} value={bgmSpeed} disabled={!bgmId} tooltip={{ formatter: (value) => `${Number(value).toFixed(2)}x` }} onChange={setBgmSpeed} />{bgm && <small>调整后预计 {effectiveDuration(bgm, bgmSpeed).toFixed(1)} 秒，保持原音调</small>}</div>
        <div className="mix-field"><label>背景音量 <b>{bgmGain}%</b></label><Slider ariaLabelForHandle="背景音量" min={0} max={100} value={bgmGain} disabled={!bgmId} onChange={setBgmGain} /></div>
        <div className="mix-field"><label>背景起始偏移 <b>{bgmOffset} 秒</b></label><Slider ariaLabelForHandle="背景起始偏移" min={0} max={60} value={bgmOffset} disabled={!bgmId || !voiceId} onChange={setBgmOffset} /></div>
        <div className="mix-switch-row"><div><label>人声闪避 · 模式 B</label><small>检测到人声时压低背景，停顿处自然恢复。</small></div><Tooltip title="使用 sidechaincompress：人声作为侧链信号，背景音被动态压缩。"><Switch checked={ducking} disabled={!voiceId || !bgmId} onChange={setDucking} aria-label="人声闪避" /></Tooltip></div>
        <div className="mix-field"><label>导出格式</label><Radio.Group value={format} onChange={(event) => setFormat(event.target.value as AudioFormat)}><Radio.Button value="mp3">MP3 · 320k</Radio.Button><Radio.Button value="wav">WAV · 48kHz/16bit</Radio.Button></Radio.Group></div>
        <Button type="primary" block size="large" icon={<SlidersOutlined />} disabled={disabled} loading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>开始混音</Button>
      </Card>
      <Card title="预览与成品" className="mix-card mix-preview-card">
        {runId ? <div className="mix-running"><SlidersOutlined /><h3>{PHASE_LABELS[phase]}</h3><p>{queuePosition > 0 && phase === 'queued' ? `前方还有 ${queuePosition} 个任务` : '正在处理音频，请稍候'}</p><Progress percent={percent} status="active" /><Button danger icon={<CloseOutlined />} loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>取消任务</Button></div>
        : failure ? <div className="mix-failure"><Alert type="error" showIcon message={ERROR_LABELS[failure.code] ?? '混音失败'} description={failure.message} /><Space>
          {failure.code === 'MIX_FFMPEG_MISSING' && <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>前往设置</Button>}
          <Button type="primary" disabled={!voiceId && !bgmId} onClick={() => submitMutation.mutate()}>重新提交</Button>
        </Space></div>
        : result?.audio ? <div className="mix-result"><div className="mix-result-tags"><Tag color="purple">混音成品</Tag><Tag>{result.audio.format.toUpperCase()}</Tag><Tag>{result.audio.duration.toFixed(1)} 秒</Tag><Tag>{result.params?.ducking ? '闪避开启' : '闪避关闭'}</Tag></div><WaveformView artifactId={result.id} /><AudioPlayer src={result.audio.url} label={result.name} /><div className="mix-summary"><strong>混音参数</strong><span>人声 {String(result.params?.voice_speed ?? 1)}x / {String(result.params?.voice_gain ?? voiceGain)}% · 背景 {String(result.params?.bgm_speed ?? 1)}x / {String(result.params?.bgm_gain ?? bgmGain)}% · 偏移 {String(result.params?.bgm_offset ?? bgmOffset)} 秒</span></div><Button icon={<ExportOutlined />} onClick={() => navigate('/library')}>在产物库中查看</Button></div>
        : <div className="mix-preview"><DualTrackWaveform voice={voice?.audio ? { id: voice.id, label: '人声', duration: voice.audio.duration } : null} bgm={bgm?.audio ? { id: bgm.id, label: '背景', duration: bgm.audio.duration } : null} bgmOffset={bgmOffset} voiceSpeed={voiceSpeed} bgmSpeed={bgmSpeed} />{(voiceId || bgmId) && <p>{mixRuleText(voice, bgm, voiceSpeed, bgmSpeed)}</p>}{!voiceId && !bgmId && <Empty description="从左侧选择至少一条音轨" />}</div>}
      </Card>
    </div>
  </div>
}
