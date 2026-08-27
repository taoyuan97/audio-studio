import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BgmPage from './BgmPage'
import RetryActions from '../features/bgm/RetryActions'

const mocks = vi.hoisted(() => ({
  getDefaults: vi.fn(), submit: vi.fn(), retry: vi.fn(), cancel: vi.fn(), getRun: vi.fn(), getArtifact: vi.fn(),
  handlers: {} as Record<string, (payload: never) => void>,
}))

vi.mock('../api/music', () => ({
  getMusicDefaults: mocks.getDefaults,
  submitMusicJob: mocks.submit,
  retryMusicJob: mocks.retry,
}))
vi.mock('../api/runs', () => ({ cancelRun: mocks.cancel, getRun: mocks.getRun }))
vi.mock('../api/artifacts', () => ({ getArtifact: mocks.getArtifact }))
vi.mock('../lib/sse', () => ({ useRunStream: (_runId: string | null, handlers: typeof mocks.handlers) => { mocks.handlers = handlers } }))
vi.mock('../components/WaveformView', () => ({ default: () => <div>波形</div> }))
vi.mock('../components/AudioPlayer', () => ({ default: () => <div>播放器</div> }))

const defaults = {
  provider: 'minimax', model: 'music-3.0',
  capabilities: { instrumental: true, prompt_max_length: 2000, native_duration: false, structure_control: 'prompt_hint', remote_url: true },
  prompt_suggestions: [{ id: 'zen', label: '古琴与空灵氛围', prompt: '空灵古琴' }],
  structure_hints: ['intro', 'outro'], duration_range: { min: 60, max: 600 },
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><AntdApp><MemoryRouter><BgmPage /></MemoryRouter></AntdApp></QueryClientProvider>)
}

describe('BgmPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDefaults.mockResolvedValue(defaults)
    mocks.submit.mockResolvedValue({ run_id: 'run_music', kind: 'music', status: 'queued', events_url: '/events' })
    mocks.retry.mockResolvedValue({ run_id: 'run_retry', kind: 'music', status: 'queued', events_url: '/events' })
    mocks.getRun.mockResolvedValue({ music_retry: { download_available: true, expires_at: Date.now() + 60_000 } })
  })

  it('uses free prompt and displays heartbeat time', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: '古琴与空灵氛围' }))
    await user.click(screen.getByRole('checkbox', { name: /Intro/ }))
    await user.click(screen.getByRole('button', { name: /生成纯音乐/ }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '空灵古琴', structure_hints: ['intro'], target_duration: 300, format: 'mp3',
    })))
    act(() => mocks.handlers['music.progress']?.({ phase: 'generating', waited_s: 65 } as never))
    expect(await screen.findByText('已等待 01:05')).toBeInTheDocument()
  })

  it('offers free download when the remote URL is valid', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: '古琴与空灵氛围' }))
    await user.click(screen.getByRole('button', { name: /生成纯音乐/ }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled())
    await screen.findByText('等待执行')
    const runningHandlers = mocks.handlers
    await act(async () => runningHandlers['run.failed']?.({ code: 'MUSIC_DOWNLOAD_FAILED', message: '下载失败' } as never))
    const download = await screen.findByRole('button', { name: /重新下载/ })
    await user.click(download)
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('run_music', { mode: 'download' }))
  })

  it('requires confirmation before paid regeneration', async () => {
    const user = userEvent.setup()
    const regenerateAction = vi.fn()
    render(<AntdApp><RetryActions downloadAvailable={false} onDownload={vi.fn()} onRegenerate={regenerateAction} /></AntdApp>)
    const regenerate = screen.getByRole('button', { name: /重新生成/ })
    await user.click(regenerate)
    expect(regenerateAction).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: '确认并重新生成' }))
    expect(regenerateAction).toHaveBeenCalledTimes(1)
  })
})
