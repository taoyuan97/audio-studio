import type { Artifact } from '../../api/types'

export function effectiveDuration(artifact: Artifact | null, speed: number): number {
  return (artifact?.audio?.duration ?? 0) / speed
}

export function mixRuleText(
  voice: Artifact | null,
  bgm: Artifact | null,
  voiceSpeed = 1,
  bgmSpeed = 1,
): string {
  if (!voice && !bgm) return '请至少选择一条音轨。'
  if (voice && !bgm) return `仅人声：应用倍速与音量后导出，预计 ${effectiveDuration(voice, voiceSpeed).toFixed(1)} 秒。`
  if (!voice && bgm) return `仅背景：应用倍速与音量后导出，预计 ${effectiveDuration(bgm, bgmSpeed).toFixed(1)} 秒。`
  const voiceDuration = effectiveDuration(voice, voiceSpeed)
  const bgmDuration = effectiveDuration(bgm, bgmSpeed)
  if (bgmDuration < voiceDuration) return '变速后背景短于人声：将循环填充至人声结束。'
  if (bgmDuration > voiceDuration) return '变速后背景长于人声：将截断至人声结束。'
  return '变速后两轨等长：将直接合成并以人声长度导出。'
}

export function artifactSummary(artifact: Artifact): string {
  const duration = artifact.audio?.duration ?? 0
  const format = artifact.audio?.format?.toUpperCase() ?? '音频'
  return `${duration.toFixed(1)} 秒 · ${format}`
}
