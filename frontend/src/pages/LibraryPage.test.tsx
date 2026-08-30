import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artifact } from '../api/types'
import LibraryPage from './LibraryPage'

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), remove: vi.fn(), clear: vi.fn(), versions: vi.fn(), conversation: vi.fn() }))

vi.mock('../api/artifacts', () => ({
  listArtifacts: mocks.list,
  updateArtifact: mocks.update,
  deleteArtifact: mocks.remove,
  clearArtifacts: mocks.clear,
  listArtifactVersions: mocks.versions,
  restoreArtifactVersion: vi.fn(),
}))
vi.mock('../api/conversations', () => ({ getConversation: mocks.conversation }))
vi.mock('../components/WaveformView', () => ({ default: () => <div>测试波形</div> }))
vi.mock('../components/AudioPlayer', () => ({ default: () => <div>测试播放器</div> }))

const script: Artifact = {
  id: 'art_script', type: 'script_meditation', name: '深海放松', conversation_id: 'conv_1', source_run_id: 'run_1',
  params: { duration: 15, model: 'deepseek-chat', topic: '深海' },
  content: { text: '慢慢呼吸', segments: [{ kind: 'speech', text: '慢慢呼吸', emotion: '温柔', speed: null }], est_duration: 300 },
  audio: null, created_at: 2000, updated_at: 2000, current_version_id: 'ver_2', current_version_no: 2,
}
const voice: Artifact = {
  id: 'art_voice', type: 'voice', name: '深海放松·人声', conversation_id: null, source_run_id: 'run_2',
  params: { engine: 'aliyun', voice_name: '龙安聆心', speed: 0.8, format: 'mp3' }, content: null,
  audio: { format: 'mp3', duration: 301.5, url: '/api/artifacts/art_voice/audio', peaks_url: '/api/artifacts/art_voice/peaks' },
  created_at: 1000, updated_at: 1000, current_version_id: null, current_version_no: null,
}
const bgm: Artifact = {
  id: 'art_bgm', type: 'bgm', name: '深海背景音', conversation_id: null, source_run_id: 'run_3',
  params: { prompt: '深海环境氛围', target_duration: 300, format: 'mp3' }, content: null,
  audio: { format: 'mp3', duration: 300, url: '/api/artifacts/art_bgm/audio', peaks_url: '/api/artifacts/art_bgm/peaks' },
  created_at: 900, updated_at: 900, current_version_id: null, current_version_no: null,
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}{useLocation().search}</div>
}

function renderPage(initialEntry = '/library') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AntdApp><MemoryRouter initialEntries={[initialEntry]}><LibraryPage /><LocationProbe /></MemoryRouter></AntdApp>
    </QueryClientProvider>,
  )
}

describe('LibraryPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({ items: [script, voice, bgm] })
    mocks.update.mockResolvedValue({ ...script, name: '新名称' })
    mocks.remove.mockResolvedValue({ deleted: true })
    mocks.clear.mockResolvedValue({ deleted: 3 })
    mocks.versions.mockResolvedValue({ items: [] })
    mocks.conversation.mockResolvedValue({ script_draft: { revision: 1 } })
  })

  it('renders all artifact types and filters the BGM tab', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('深海放松')).toBeInTheDocument()
    expect(screen.getByText('深海放松·人声')).toBeInTheDocument()
    expect(screen.getByText('深海背景音')).toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith({ limit: 500 })

    await user.click(screen.getByRole('tab', { name: /背景音/ }))
    expect(screen.getByText('深海背景音')).toBeInTheDocument()
    expect(screen.queryByText('深海放松·人声')).not.toBeInTheDocument()
  })

  it('opens script detail and hands it off to TTS', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('深海放松')
    const detailButtons = screen.getAllByRole('button', { name: /详情/ })
    await user.click(detailButtons[0])
    expect(await screen.findByText('慢慢呼吸')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '送去 TTS' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tts?artifact_id=art_script')
  })

  it('renames a supported artifact', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('深海放松')
    await user.click(screen.getAllByRole('button', { name: /重命名/ })[0])
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '新名称')
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('art_script', { name: '新名称' }))
  })
})
