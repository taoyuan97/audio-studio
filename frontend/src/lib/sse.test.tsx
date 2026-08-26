import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRunStream } from './sse'
import type { RunEventHandlers } from './sse'

type Listener = (event: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: Listener): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(listener)
  }

  removeEventListener(name: string, listener: Listener): void {
    this.listeners.get(name)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(name: string, data: unknown): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event)
    }
  }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useRunStream 事件分发与连接生命周期', () => {
  it('runId 为 null 时不建立连接', () => {
    renderHook(() => useRunStream(null, {}))
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('按事件名分发载荷（含排队期 run.status 重复推送）', () => {
    const handlers: RunEventHandlers = {
      'run.status': vi.fn(),
      'run.started': vi.fn(),
      'script.draft.updated': vi.fn(),
      'tts.progress': vi.fn(),
    }
    renderHook(() => useRunStream('run_1', handlers))

    const es = MockEventSource.instances[0]
    expect(es.url).toBe('/api/runs/run_1/events')

    act(() => {
      es.emit('run.status', { status: 'queued', queue_position: 2, progress: null })
      es.emit('run.status', { status: 'queued', queue_position: 1, progress: null })
      es.emit('run.started', {})
      es.emit('script.draft.updated', {
        draft: {
          conversation_id: 'conv_1',
          source_run_id: 'run_1',
          params: { duration: 5, model: 'deepseek-chat' },
          content: { text: '草稿', segments: [], est_duration: 1 },
          origin: 'generated',
          revision: 1,
          updated_at: 1,
        },
      })
      es.emit('tts.progress', { segment: 1, total_segments: 12, stage: 'synthesizing' })
    })

    expect(handlers['run.status']).toHaveBeenCalledTimes(2)
    expect(handlers['run.status']).toHaveBeenNthCalledWith(1, {
      status: 'queued',
      queue_position: 2,
      progress: null,
    })
    expect(handlers['run.status']).toHaveBeenNthCalledWith(2, {
      status: 'queued',
      queue_position: 1,
      progress: null,
    })
    expect(handlers['run.started']).toHaveBeenCalledWith({})
    expect(handlers['script.draft.updated']).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ revision: 1 }) }),
    )
    expect(handlers['tts.progress']).toHaveBeenCalledWith({
      segment: 1,
      total_segments: 12,
      stage: 'synthesizing',
    })
    expect(es.closed).toBe(false)
  })

  it('run.completed 终态后自动关连接', () => {
    const handlers: RunEventHandlers = {
      'run.completed': vi.fn(),
    }
    renderHook(() => useRunStream('run_2', handlers))

    const es = MockEventSource.instances[0]
    act(() => {
      es.emit('run.completed', { artifact_id: 'art_1' })
    })

    expect(handlers['run.completed']).toHaveBeenCalledWith({ artifact_id: 'art_1' })
    expect(es.closed).toBe(true)
  })

  it('run.failed 携带 code/message 并关连接', () => {
    const handlers: RunEventHandlers = {
      'run.failed': vi.fn(),
    }
    renderHook(() => useRunStream('run_3', handlers))

    const es = MockEventSource.instances[0]
    act(() => {
      es.emit('run.failed', { code: 'TTS_PROVIDER_ERROR', message: '引擎调用失败' })
    })

    expect(handlers['run.failed']).toHaveBeenCalledWith({
      code: 'TTS_PROVIDER_ERROR',
      message: '引擎调用失败',
    })
    expect(es.closed).toBe(true)
  })

  it('组件卸载后关闭连接并移除监听', () => {
    const { unmount } = renderHook(() => useRunStream('run_4', {}))
    const es = MockEventSource.instances[0]

    unmount()

    expect(es.closed).toBe(true)
  })

  it('handlers 更新不重连（经 ref 转发新处理器）', () => {
    const first: RunEventHandlers = { 'run.status': vi.fn() }
    const second: RunEventHandlers = { 'run.status': vi.fn() }
    const { rerender } = renderHook(({ handlers }) => useRunStream('run_5', handlers), {
      initialProps: { handlers: first },
    })

    rerender({ handlers: second })

    expect(MockEventSource.instances).toHaveLength(1)
    const es = MockEventSource.instances[0]
    act(() => {
      es.emit('run.status', { status: 'running', queue_position: 0, progress: null })
    })
    expect(first['run.status']).not.toHaveBeenCalled()
    expect(second['run.status']).toHaveBeenCalledOnce()
  })
})
