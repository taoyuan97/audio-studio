import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artifact } from '../api/types'
import MixdownPage from './MixdownPage'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), submit: vi.fn(), cancel: vi.fn(),
  handlers: {} as Record<string, (payload: never) => void>,
}))

vi.mock('../api/artifacts', () => ({ listArtifacts: mocks.list, getArtifact: mocks.get }))
vi.mock('../api/mixdown', () => ({ submitMixdownJob: mocks.submit }))
vi.mock('../api/runs', () => ({ cancelRun: mocks.cancel }))
vi.mock('../lib/sse', () => ({ useRunStream: (_id: string | null, handlers: typeof mocks.handlers) => { mocks.handlers = handlers } }))
vi.mock('../features/mixdown/DualTrackWaveform', () => ({ default: ({ bgmOffset, voiceSpeed, bgmSpeed }: { bgmOffset: number; voiceSpeed: number; bgmSpeed: number }) => <div>双轨波形 · 偏移 {bgmOffset} · 人声 {voiceSpeed}x · 背景 {bgmSpeed}x</div> }))
vi.mock('../components/WaveformView', () => ({ default: () => <div>成品波形</div> }))
vi.mock('../components/AudioPlayer', () => ({ default: () => <div>播放器</div> }))

function artifact(type: 'voice' | 'bgm' | 'mix', duration: number): Artifact {
  return {
    id: `art_${type}`,
    type,
    name: type === 'voice' ? '测试人声' : type === 'bgm' ? '测试背景' : '测试成品',
    conversation_id: null,
    source_run_id: null,
    params: type === 'mix' ? { voice_speed: 1, bgm_speed: 1, voice_gain: 80, bgm_gain: 45, bgm_offset: 0, ducking: true } : {},
    content: null,
    audio: { format: 'wav', duration, url: '/audio', peaks_url: '/peaks' },
    created_at: 1,
    updated_at: 1,
    current_version_id: null,
    current_version_no: null,
  }
}

function renderPage(initial = '/mixdown') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><AntdApp><MemoryRouter initialEntries={[initial]}><MixdownPage /></MemoryRouter></AntdApp></QueryClientProvider>)
}

describe('MixdownPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockImplementation(({ type }: { type: string }) => Promise.resolve({ items: type === 'voice' ? [artifact('voice', 60)] : [artifact('bgm', 20)] }))
    mocks.submit.mockResolvedValue({ run_id: 'run_mix', kind: 'mixdown', status: 'queued', events_url: '/events' })
    mocks.get.mockResolvedValue(artifact('mix', 60))
  })

  it('preselects query tracks, shows loop rule, and submits the complete payload', async () => {
    const user = userEvent.setup()
    renderPage('/mixdown?voice_id=art_voice&bgm_id=art_bgm')
    expect((await screen.findAllByText('变速后背景短于人声：将循环填充至人声结束。')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /开始混音/ }))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({
      voice_artifact_id: 'art_voice', bgm_artifact_id: 'art_bgm', voice_speed: 1,
      bgm_speed: 1, voice_gain: 80,
      bgm_gain: 45, bgm_offset: 0, ducking: true, format: 'mp3',
    }))
    act(() => mocks.handlers['mix.progress']?.({ phase: 'ducking' } as never))
    expect(await screen.findByText('闪避分析')).toBeInTheDocument()
  })

  it('disables submit with both tracks empty', async () => {
    renderPage()
    const button = await screen.findByRole('button', { name: /开始混音/ })
    expect(button).toBeDisabled()
    expect(screen.getByText('请至少选择一条音轨。')).toBeInTheDocument()
  })

  it('supports clearing both preselected tracks and disables submit', async () => {
    const user = userEvent.setup()
    const { container } = renderPage('/mixdown?voice_id=art_voice&bgm_id=art_bgm')
    await screen.findByText('测试人声')
    const clearButtons = container.querySelectorAll<HTMLElement>('.ant-select-clear')
    expect(clearButtons).toHaveLength(2)
    await user.click(clearButtons[0]!)
    expect((await screen.findAllByText(/仅背景：应用倍速与音量后导出/)).length).toBeGreaterThan(0)
    await user.click(clearButtons[1]!)
    expect(screen.getByRole('button', { name: /开始混音/ })).toBeDisabled()
  })

  it('enables both independent speed controls for selected tracks', async () => {
    renderPage('/mixdown?voice_id=art_voice&bgm_id=art_bgm')
    const voiceSpeed = await screen.findByRole('slider', { name: '人声倍速' })
    const bgmSpeed = screen.getByRole('slider', { name: '背景倍速' })
    expect(voiceSpeed).toHaveAttribute('aria-valuemin', '0.5')
    expect(voiceSpeed).toHaveAttribute('aria-valuemax', '2')
    expect(voiceSpeed).toHaveAttribute('aria-valuenow', '1')
    expect(bgmSpeed).toHaveAttribute('aria-valuenow', '1')
    expect(voiceSpeed).not.toHaveAttribute('aria-disabled', 'true')
    expect(bgmSpeed).not.toHaveAttribute('aria-disabled', 'true')
  })
})
