/** 归一化 API 错误：所有非 2xx 与网络异常统一抛出 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** 查询参数；undefined/null/空串 会被剔除 */
  params?: Record<string, string | number | undefined | null>
}

function buildUrl(path: string, params?: ApiRequestOptions['params']): string {
  if (!params) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

interface ErrorBody {
  code: string
  message: string
}

async function parseErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const data: unknown = await res.json()
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as ErrorBody).code === 'string' &&
      typeof (data as ErrorBody).message === 'string'
    ) {
      return data as ErrorBody
    }
  } catch {
    // 非 JSON 响应体，走兜底
  }
  return { code: `HTTP_${res.status}`, message: `请求失败（HTTP ${res.status}）` }
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, params } = options

  let res: Response
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    // 主动中断透传，不归一化
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'BACKEND_UNREACHABLE', '无法连接后端服务，请确认服务已启动')
  }

  if (!res.ok) {
    const { code, message } = await parseErrorBody(res)
    throw new ApiError(res.status, code, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
