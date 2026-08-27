import type { Artifact, ArtifactType } from '../../api/types'

export const SUPPORTED_ARTIFACT_TYPES = ['script_meditation', 'voice'] as const
export type SupportedArtifactType = (typeof SUPPORTED_ARTIFACT_TYPES)[number]

export const ARTIFACT_TYPE_META: Record<ArtifactType, { label: string; color: string }> = {
  script_meditation: { label: '冥想脚本', color: 'cyan' },
  voice: { label: 'TTS 人声', color: 'purple' },
  bgm: { label: '背景音', color: 'gold' },
  mix: { label: '成品', color: 'red' },
}

const PARAM_LABELS: Record<string, string> = {
  topic: '主题',
  matched_topic: '匹配主题',
  duration: '目标时长',
  model: '模型',
  scene: '场景',
  engine: '引擎',
  voice_id: '音色 ID',
  voice_name: '音色',
  speed: '语速',
  pitch: '音调',
  script_artifact_id: '来源脚本 ID',
  format: '格式',
}

export function isSupportedArtifact(artifact: Artifact): artifact is Artifact & { type: SupportedArtifactType } {
  return SUPPORTED_ARTIFACT_TYPES.some((type) => type === artifact.type)
}

export function formatArtifactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
}

function valueOf(params: Record<string, unknown> | null, key: string): string | null {
  const value = params?.[key]
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

export function artifactSummary(artifact: Artifact): string {
  if (artifact.type === 'script_meditation') {
    return [
      artifact.current_version_no ? `v${artifact.current_version_no}` : null,
      valueOf(artifact.params, 'duration') ? `${valueOf(artifact.params, 'duration')} 分钟` : null,
      valueOf(artifact.params, 'model'),
      artifact.content ? `预估 ${formatSeconds(artifact.content.est_duration)}` : null,
    ].filter(Boolean).join(' · ')
  }
  if (artifact.type === 'voice') {
    return [
      valueOf(artifact.params, 'engine'),
      valueOf(artifact.params, 'voice_name') ?? valueOf(artifact.params, 'voice_id'),
      valueOf(artifact.params, 'speed') ? `${valueOf(artifact.params, 'speed')}×` : null,
      artifact.audio?.format.toUpperCase(),
      artifact.audio ? formatSeconds(artifact.audio.duration) : null,
    ].filter(Boolean).join(' · ')
  }
  return ''
}

export function artifactParamRows(artifact: Artifact): Array<[string, string]> {
  return Object.entries(artifact.params ?? {}).flatMap(([key, rawValue]) => {
    if (rawValue === null || rawValue === undefined || rawValue === '') return []
    const value = Array.isArray(rawValue) ? rawValue.join(' / ') : String(rawValue)
    return [[PARAM_LABELS[key] ?? key, value]]
  })
}
