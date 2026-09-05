import type { Artifact, Conversation, TtsEngine, TtsScenePreset } from '../../api/types'

export interface ScriptSourceOption {
  value: string
  label: string
  primary: string
  secondary: string
  searchText: string
  updatedAt: number
}

const ALIYUN_BASIC_VOICE_MODELS = new Set([
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-tts-flash',
])

/**
 * 官方基础音色表常同时展示试听文件后缀和完整 voice。只给出候选值，
 * 不静默改写，以兼容命名规则不同的声音复刻音色。
 */
export function suggestAliyunBasicVoiceId(model: string, voiceId: string): string | null {
  const normalizedModel = model.trim()
  const normalizedVoiceId = voiceId.trim()
  if (
    !ALIYUN_BASIC_VOICE_MODELS.has(normalizedModel)
    || !normalizedVoiceId
    || normalizedVoiceId.startsWith(`${normalizedModel}-`)
  ) return null
  return `${normalizedModel}-${normalizedVoiceId}`
}

/**
 * 脚本产物名允许独立于会话名；TTS 选择来源时以当前会话标题为主标识，
 * 同时保留产物名/版本供辨认。孤立产物稳定回退自身名称。
 */
export function buildScriptSourceOptions(
  artifacts: Artifact[],
  conversations: Conversation[],
): ScriptSourceOption[] {
  const conversationTitles = new Map(conversations.map((item) => [item.id, item.title.trim()]))
  return artifacts.map((artifact) => {
    const currentTitle = artifact.conversation_id
      ? conversationTitles.get(artifact.conversation_id)
      : undefined
    const primary = currentTitle || artifact.name
    const version = artifact.current_version_no ? `v${artifact.current_version_no}` : '未标版本'
    return {
      value: artifact.id,
      label: primary,
      primary,
      secondary: `${artifact.name} · ${version}`,
      searchText: `${primary} ${artifact.name} ${version}`,
      updatedAt: artifact.updated_at,
    }
  })
}

/** 场景推荐优先；当前引擎没有推荐音色时稳定回退首项。 */
export function pickVoiceId(engine: TtsEngine | undefined, preset: TtsScenePreset | undefined): string {
  const recommended = engine?.voices.find((voice) => preset?.recommended_voice_ids.includes(voice.id))
  return recommended?.id ?? engine?.voices[0]?.id ?? ''
}

/** 自定义音色是用户显式选择，场景切换时保留；系统音色继续跟随推荐预设。 */
export function pickVoiceIdForScene(
  engine: TtsEngine | undefined,
  preset: TtsScenePreset | undefined,
  currentVoiceId: string,
): string {
  const current = engine?.voices.find((voice) => voice.id === currentVoiceId)
  return current?.source === 'custom' ? currentVoiceId : pickVoiceId(engine, preset)
}
