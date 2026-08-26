import type { Artifact, Conversation, TtsEngine, TtsScenePreset } from '../../api/types'

export interface ScriptSourceOption {
  value: string
  label: string
  primary: string
  secondary: string
  searchText: string
  updatedAt: number
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
