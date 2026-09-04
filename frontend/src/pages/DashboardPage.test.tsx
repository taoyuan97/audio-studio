import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'

const mocks = vi.hoisted(() => ({ getStats: vi.fn() }))
vi.mock('../api/settings', () => ({ getStats: mocks.getStats }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><DashboardPage /><LocationProbe /></MemoryRouter></QueryClientProvider>)
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

describe('DashboardPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    mocks.getStats.mockResolvedValue({
      artifact_counts: { script_meditation: 2, voice: 3, bgm: 8, mix: 4 },
      conversation_count: 2,
      recent_artifacts: [
        { id: 'voice_1', type: 'voice', name: '最近人声', created_at: 2000 },
        { id: 'bgm_1', type: 'bgm', name: '不应展示的 BGM', created_at: 1900 },
        { id: 'script_1', type: 'script_meditation', name: '最近脚本', created_at: 1800 },
      ],
      active_runs: [
        { run_id: 'run_tts', kind: 'tts', status: 'running' },
        { run_id: 'run_music', kind: 'music', status: 'running' },
      ],
    })
  })

  it('shows complete stats, recent artifacts and active runs', async () => {
    renderPage()
    expect(await screen.findByText('最近人声')).toBeInTheDocument()
    expect(screen.getByText('最近脚本')).toBeInTheDocument()
    expect(screen.getByText('不应展示的 BGM')).toBeInTheDocument()
    expect(screen.getByText('TTS 人声合成中')).toBeInTheDocument()
    expect(screen.getByText('BGM 生成中')).toBeInTheDocument()
    expect(screen.getByText('用自然语言生成可循环的纯音乐背景轨')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.queryByText('快速开始')).not.toBeInTheDocument()
  })

  it('opens the available mixdown module', async () => {
    const user = userEvent.setup()
    renderPage()

    const mixdownCard = screen.getByText('混音').closest('.ant-card')
    expect(mixdownCard).not.toHaveClass('is-deferred')
    expect(screen.queryByText('后续开放')).not.toBeInTheDocument()

    await user.click(mixdownCard!)
    expect(screen.getByTestId('location')).toHaveTextContent('/mixdown')
  })
})
