import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'

const mocks = vi.hoisted(() => ({ status: vi.fn(), probe: vi.fn(), reveal: vi.fn(), update: vi.fn(), clear: vi.fn(), runtime: vi.fn() }))
vi.mock('../api/settings', () => ({
  getSettingsStatus: mocks.status,
  probeProvider: mocks.probe,
  revealProviderCredential: mocks.reveal,
  updateProvider: mocks.update,
  clearProviderCredentials: mocks.clear,
  updateRuntime: mocks.runtime,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><AntdApp><SettingsPage /></AntdApp></QueryClientProvider>)
}

describe('SettingsPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    const editable = {
      configured: true,
      credential_masked: 'sk-***abcd',
      credential_source: 'runtime',
      editable: true,
      runtime_credential_fields: ['credential'],
    }
    mocks.reveal.mockImplementation((_provider: string, revision: number, field: string) => Promise.resolve({
      revision,
      field,
      value: field === 'app_id' ? 'browser-app-id' : field === 'access_token' ? 'browser-token-secret' : 'runtime-key-secret',
    }))
    mocks.status.mockResolvedValue({
      revision: 2,
      providers: {
        llm_deepseek: { ...editable, model_id: 'deepseek-chat' },
        llm_qwen: { ...editable, model_id: 'qwen-plus' },
        llm_moonshot: { ...editable, model_id: 'kimi-k2' },
        tts_aliyun: { ...editable, model_id: 'qwen-audio' },
        tts_volc: { ...editable, credential_masked: 'app***1234 / tok***5678', runtime_credential_fields: ['app_id', 'access_token'] },
        minimax: { ...editable, credential_masked: 'min***3456', model_id: 'music-3.0' },
      },
      runtime: { llm_timeout_seconds: 120, minimax_timeout_seconds: 600 },
      ffmpeg: { available: true, version: 'ffmpeg version 9', ffprobe_available: true },
      fake_mode: true,
    })
  })

  it('renders editable providers and masked credentials', async () => {
    renderPage()
    expect(await screen.findByText('DeepSeek')).toBeInTheDocument()
    expect(screen.getByText('MiniMax Music')).toBeInTheDocument()
    expect(screen.getByLabelText('MiniMax Music API Key')).toBeInTheDocument()
    expect(screen.getByDisplayValue('music-3.0')).toBeInTheDocument()
    expect(screen.getAllByText('API Key').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sk-***abcd').length).toBeGreaterThan(0)
    expect(screen.getByText('当前为 FAKE_MODE')).toBeInTheDocument()
    expect(screen.queryByText('runtime-key-secret')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('火山 TTS App ID')).toHaveValue('browser-app-id'))
    expect(mocks.reveal).toHaveBeenCalledWith('tts_volc', 2, 'app_id')
  })

  it('reveals a browser credential only after clicking the eye and saves edits', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = await screen.findByLabelText('DeepSeek API Key')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('')

    const eye = input.parentElement?.querySelector('.ant-input-password-icon')
    expect(eye).not.toBeNull()
    await user.click(eye as HTMLElement)
    await waitFor(() => expect(input).toHaveValue('runtime-key-secret'))
    expect(input).toHaveAttribute('type', 'text')

    await user.clear(input)
    await user.type(input, 'updated-browser-secret')
    const card = input.closest('.ant-card') as HTMLElement
    await user.click(Array.from(card.querySelectorAll('button')).find((button) => button.textContent === '保存') as HTMLElement)
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('llm_deepseek', {
      revision: 2,
      model_id: 'deepseek-chat',
      credential: 'updated-browser-secret',
    }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('keeps the Volc access token hidden until its own eye is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = await screen.findByLabelText('火山 TTS Access Token')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    expect(mocks.reveal).not.toHaveBeenCalledWith('tts_volc', 2, 'access_token')

    const eye = input.parentElement?.querySelector('.ant-input-password-icon')
    await user.click(eye as HTMLElement)
    await waitFor(() => expect(input).toHaveValue('browser-token-secret'))
    expect(mocks.reveal).toHaveBeenCalledWith('tts_volc', 2, 'access_token')
  })

  it('reveals and saves the MiniMax API key and model ID', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = await screen.findByLabelText('MiniMax Music API Key')
    const card = input.closest('.ant-card') as HTMLElement

    const eye = input.parentElement?.querySelector('.ant-input-password-icon')
    await user.click(eye as HTMLElement)
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('minimax', 2, 'credential'))

    await user.clear(input)
    await user.type(input, 'updated-minimax-key')
    const modelInput = within(card).getByLabelText('模型 ID')
    await user.clear(modelInput)
    await user.type(modelInput, 'music-custom')
    await user.click(within(card).getByRole('button', { name: /保存/ }))

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('minimax', {
      revision: 2,
      model_id: 'music-custom',
      credential: 'updated-minimax-key',
    }))
  })

  it('clears the MiniMax browser API key', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = await screen.findByLabelText('MiniMax Music API Key')
    const card = input.closest('.ant-card') as HTMLElement

    await user.click(within(card).getByRole('button', { name: '清除 API Key' }))
    const confirmation = await screen.findByText('清除浏览器 API Key？')
    const popup = confirmation.closest('.ant-popover-inner') as HTMLElement
    await user.click(within(popup).getByRole('button', { name: /^清\s*除$/ }))

    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('minimax', 2))
  })
})
