import { apiFetch } from './client'
import type { HealthResponse, ProbeResult, SettingsStatus, StatsResponse } from './types'

export function getHealth(signal?: AbortSignal) {
  return apiFetch<HealthResponse>('/api/health', { signal })
}

export function getStats(signal?: AbortSignal) {
  return apiFetch<StatsResponse>('/api/stats', { signal })
}

export function getSettingsStatus(signal?: AbortSignal) {
  return apiFetch<SettingsStatus>('/api/settings/status', { signal })
}

export function probeProvider(provider: 'llm' | 'aliyun_tts' | 'volc_tts' | 'minimax' | 'ffmpeg') {
  return apiFetch<ProbeResult>(`/api/settings/probe/${provider}`, { method: 'POST' })
}
