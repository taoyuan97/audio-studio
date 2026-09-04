import type { Artifact } from '../../api/types'

export function mixRuleText(voice: Artifact | null, bgm: Artifact | null): string {
  if (!voice && !bgm) return '请至少选择一条音轨。'
  if (voice && !bgm) return '仅人声：按所选格式透传重编码。'
  if (!voice && bgm) return '仅背景：格式一致时原样导出，否则按所选格式重编码。'
  const voiceDuration = voice?.audio?.duration ?? 0
  const bgmDuration = bgm?.audio?.duration ?? 0
  if (bgmDuration < voiceDuration) return '背景短于人声：将循环填充至人声结束。'
  if (bgmDuration > voiceDuration) return '背景长于人声：将截断至人声结束。'
  return '两轨等长：将直接合成并以人声长度导出。'
}

export function artifactSummary(artifact: Artifact): string {
  const duration = artifact.audio?.duration ?? 0
  const format = artifact.audio?.format?.toUpperCase() ?? '音频'
  return `${duration.toFixed(1)} 秒 · ${format}`
}
