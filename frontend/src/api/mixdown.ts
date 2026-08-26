import { apiFetch } from './client'
import type { RunPayload, SubmitMixdownJobRequest } from './types'

export function submitMixdownJob(payload: SubmitMixdownJobRequest) {
  return apiFetch<RunPayload>('/api/mixdown/jobs', { method: 'POST', body: payload })
}
