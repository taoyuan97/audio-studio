import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppLayout from './AppLayout'

const mocks = vi.hoisted(() => ({ getStats: vi.fn() }))
vi.mock('../api/settings', () => ({ getStats: mocks.getStats }))

describe('AppLayout', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStats.mockResolvedValue({
      artifact_counts: {},
      conversation_count: 0,
      recent_artifacts: [],
      active_runs: [
        { run_id: 'run_tts_1', kind: 'tts', status: 'running' },
        { run_id: 'run_tts_2', kind: 'tts', status: 'queued' },
        { run_id: 'run_music_1', kind: 'music', status: 'queued' },
      ],
    })
  })

  it('separates the fixed sidebar from the scrollable page content', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="settings" element={<div>设置页内容</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(container.querySelector('.app-shell')).toBeInTheDocument()
    expect(container.querySelector('.app-sider')).toBeInTheDocument()
    expect(container.querySelector('.app-main')).toBeInTheDocument()
    expect(container.querySelector('.app-content')).toHaveTextContent('设置页内容')
  })

  it('shows queued/running badges and keeps the navigation clickable', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="settings" element={<div>设置页内容</div>} />
              <Route path="tts" element={<div>TTS 页面</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByLabelText('TTS：1 个运行中，1 个排队中')).toBeInTheDocument()
    expect(screen.getByLabelText('BGM：0 个运行中，1 个排队中')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /TTS/ }))
    expect(await screen.findByText('TTS 页面')).toBeInTheDocument()
  })
})
