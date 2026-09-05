import { apiFetch } from './client'
import type {
  RunPayload,
  SubmitTtsJobRequest,
  TtsCustomVoice,
  TtsCustomVoicesResponse,
  TtsCustomVoiceVerifyResponse,
  TtsDefaults,
} from './types'

export function getTtsDefaults() {
  return apiFetch<TtsDefaults>('/api/tts/defaults')
}

/** 音色试听地址（audio/wav，支持 Range） */
export function voicePreviewUrl(engineId: string, voiceId: string): string {
  return `/api/tts/voices/${encodeURIComponent(engineId)}/${encodeURIComponent(voiceId)}/preview`
}

export function listTtsCustomVoices(model?: string) {
  const params = model ? `?model=${encodeURIComponent(model)}` : ''
  return apiFetch<TtsCustomVoicesResponse>(`/api/tts/custom-voices${params}`)
}

export function createTtsCustomVoice(payload: { model: string; voice_id: string; name?: string | null }) {
  return apiFetch<TtsCustomVoice>('/api/tts/custom-voices', { method: 'POST', body: payload })
}

export function renameTtsCustomVoice(id: string, name: string | null) {
  return apiFetch<TtsCustomVoice>(`/api/tts/custom-voices/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: { name },
  })
}

export function deleteTtsCustomVoice(id: string) {
  return apiFetch<{ deleted: boolean }>(`/api/tts/custom-voices/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function verifyTtsCustomVoice(id: string, force = false) {
  return apiFetch<TtsCustomVoiceVerifyResponse>(`/api/tts/custom-voices/${encodeURIComponent(id)}/verify`, {
    method: 'POST', body: { force },
  })
}

export function customVoicePreviewUrl(id: string): string {
  return `/api/tts/custom-voices/${encodeURIComponent(id)}/preview`
}

export function submitTtsJob(payload: SubmitTtsJobRequest) {
  return apiFetch<RunPayload>('/api/tts/jobs', { method: 'POST', body: payload })
}
