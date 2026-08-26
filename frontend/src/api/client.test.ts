import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch 错误归一化', () => {
  it('网络不可达 → BACKEND_UNREACHABLE（status 0）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const err = await apiFetch('/api/health').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('BACKEND_UNREACHABLE')
    expect((err as ApiError).status).toBe(0)
    expect((err as ApiError).message).toContain('无法连接后端服务')
  })

  it('4xx 解析错误体 code/message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(409, {
      code: 'RUN_QUEUE_FULL',
      message: '任务队列已满（上限 8），请稍后再试',
    }))))

    const err = await apiFetch('/api/tts/jobs', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).code).toBe('RUN_QUEUE_FULL')
    expect((err as ApiError).message).toBe('任务队列已满（上限 8），请稍后再试')
  })

  it('5xx 非 JSON 响应体 → HTTP_500 兜底', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Internal Server Error', { status: 500 }))),
    )

    const err = await apiFetch('/api/stats').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).code).toBe('HTTP_500')
  })

  it('错误体缺 code 字段 → HTTP_ 前缀兜底', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(422, { detail: '无效' }))))

    const err = await apiFetch('/api/conversations').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('HTTP_422')
  })

  it('成功响应解析为 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { status: 'ok' }))))

    await expect(apiFetch<{ status: string }>('/api/health')).resolves.toEqual({ status: 'ok' })
  })

  it('POST 带 JSON 序列化请求体与查询参数拼接', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(201, { id: 'conv_1' })))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/conversations', {
      method: 'POST',
      body: { scene: 'meditation' },
      params: { scene: 'meditation', limit: undefined, before: null },
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations?scene=meditation')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ scene: 'meditation' }))
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('AbortError 透传，不归一化', async () => {
    const abort = new AbortController()
    abort.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))),
    )

    const err = await apiFetch('/api/health', { signal: abort.signal }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect(err).not.toBeInstanceOf(ApiError)
  })
})
