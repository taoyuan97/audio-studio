import { useEffect, useRef } from 'react'
import type {
  ArtifactUpdatedEvent,
  AssistantDeltaEvent,
  MessageCompletedEvent,
  MixProgressEvent,
  MusicProgressEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunStatusEvent,
  TtsProgressEvent,
} from '../api/types'

/** SSE 事件全表（契约第 11 节，事件名为锁定项） */
export const RUN_EVENT_NAMES = [
  'run.status',
  'run.started',
  'assistant.delta',
  'message.completed',
  'artifact.updated',
  'tts.progress',
  'music.progress',
  'mix.progress',
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const

export type RunEventName = (typeof RUN_EVENT_NAMES)[number]

/** 终态事件：收到后服务端关闭连接，客户端同步关闭 */
export const TERMINAL_RUN_EVENTS: ReadonlySet<string> = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
])

export interface RunEventPayloads {
  'run.status': RunStatusEvent
  'run.started': Record<string, never>
  'assistant.delta': AssistantDeltaEvent
  'message.completed': MessageCompletedEvent
  'artifact.updated': ArtifactUpdatedEvent
  'tts.progress': TtsProgressEvent
  'music.progress': MusicProgressEvent
  'mix.progress': MixProgressEvent
  'run.completed': RunCompletedEvent
  'run.failed': RunFailedEvent
  'run.cancelled': Record<string, never>
}

export type RunEventHandlers = {
  [K in RunEventName]?: (payload: RunEventPayloads[K]) => void
}

function parsePayload(data: string | null): unknown {
  if (typeof data !== 'string' || data === '') return undefined
  try {
    return JSON.parse(data) as unknown
  } catch {
    return undefined
  }
}

/**
 * 订阅 run 的 SSE 事件流。
 * - runId 为 null 时不建连（组件卸载 / 无活动任务）
 * - 终态事件（run.completed/failed/cancelled）后自动关连接
 * - 排队期 run.status 重复推送（队列位置更新）直接分发
 * - handlers 变化不重连（经 ref 转发），组件卸载清理连接
 */
export function useRunStream(runId: string | null, handlers: RunEventHandlers): void {
  const handlersRef = useRef<RunEventHandlers>(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!runId) return

    const source = new EventSource(`/api/runs/${runId}/events`)
    const cleanups: Array<() => void> = []

    for (const name of RUN_EVENT_NAMES) {
      const listener = (event: MessageEvent): void => {
        const payload = parsePayload(event.data)
        handlersRef.current[name]?.(payload as never)
        if (TERMINAL_RUN_EVENTS.has(name)) source.close()
      }
      source.addEventListener(name, listener as EventListener)
      cleanups.push(() => source.removeEventListener(name, listener as EventListener))
    }

    return () => {
      for (const cleanup of cleanups) cleanup()
      source.close()
    }
  }, [runId])
}
