import { apiFetch } from './client'
import type { CancelRunResponse, RunStatusResponse } from './types'

export function getRun(runId: string, signal?: AbortSignal) {
  return apiFetch<RunStatusResponse>(`/api/runs/${runId}`, { signal })
}

export function cancelRun(runId: string) {
  return apiFetch<CancelRunResponse>(`/api/runs/${runId}/cancel`, { method: 'POST' })
}

/** SSE 事件流地址（useRunStream 内部使用；导出便于测试与手动连接） */
export function runEventsUrl(runId: string): string {
  return `/api/runs/${runId}/events`
}
