import { apiFetch } from './client'
import type { MusicDefaults, RetryMusicJobRequest, RunPayload, SubmitMusicJobRequest } from './types'

export function getMusicDefaults() {
  return apiFetch<MusicDefaults>('/api/music/defaults')
}

export function submitMusicJob(payload: SubmitMusicJobRequest) {
  return apiFetch<RunPayload>('/api/music/jobs', { method: 'POST', body: payload })
}

export function retryMusicJob(runId: string, payload: RetryMusicJobRequest) {
  return apiFetch<RunPayload>(`/api/music/jobs/${runId}/retry`, { method: 'POST', body: payload })
}
