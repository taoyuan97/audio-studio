import { apiFetch } from './client'
import type { RunPayload, SubmitTtsJobRequest, TtsDefaults } from './types'

export function getTtsDefaults() {
  return apiFetch<TtsDefaults>('/api/tts/defaults')
}

/** 音色试听地址（audio/wav，支持 Range） */
export function voicePreviewUrl(engineId: string, voiceId: string): string {
  return `/api/tts/voices/${engineId}/${voiceId}/preview`
}

export function submitTtsJob(payload: SubmitTtsJobRequest) {
  return apiFetch<RunPayload>('/api/tts/jobs', { method: 'POST', body: payload })
}
