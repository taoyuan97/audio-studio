import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import MeditationWorkspacePage from './MeditationWorkspacePage'

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  listConversationModels: vi.fn(),
  retryMessage: vi.fn(),
  sendMessage: vi.fn(),
  updateScriptDraft: vi.fn(),
  saveScriptVersion: vi.fn(),
  listArtifactVersions: vi.fn(),
  restoreArtifactVersion: vi.fn(),
  cancelRun: vi.fn(),
  getScriptConfig: vi.fn(),
  handlers: {} as Record<string, (payload: never) => void>,
  setNavigationBlocked: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useParams: () => ({ conversationId: 'conv_1' }),
    useOutletContext: () => ({ setNavigationBlocked: mocks.setNavigationBlocked }),
  }
})

vi.mock('../api/conversations', () => ({
  getConversation: mocks.getConversation,
  listMessages: mocks.listMessages,
  listConversationModels: mocks.listConversationModels,
  retryMessage: mocks.retryMessage,
  sendMessage: mocks.sendMessage,
  updateScriptDraft: mocks.updateScriptDraft,
  saveScriptVersion: mocks.saveScriptVersion,
}))
vi.mock('../api/artifacts', () => ({
  listArtifactVersions: mocks.listArtifactVersions,
  restoreArtifactVersion: mocks.restoreArtifactVersion,
}))
vi.mock('../api/runs', () => ({ cancelRun: mocks.cancelRun }))
vi.mock('../api/settings', () => ({ getScriptConfig: mocks.getScriptConfig }))
vi.mock('../lib/sse', () => ({
  useRunStream: (_runId: string | null, handlers: typeof mocks.handlers) => {
    mocks.handlers = handlers
  },
}))

const staleMessage = {
  id: 'msg_old',
  role: 'user' as const,
  content: '旧消息',
  params: { duration: 15 as const, model: 'kimi-k2.6' },
  attachments: [],
  created_at: 1,
}

const latestMessage = {
  ...staleMessage,
  id: 'msg_latest',
  content: '本次失败的最新消息',
  created_at: 2,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AntdApp>
        <MemoryRouter>
          <MeditationWorkspacePage />
        </MemoryRouter>
      </AntdApp>
    </QueryClientProvider>,
  )
}

describe('MeditationWorkspacePage retry', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    })
  })

  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConversation.mockResolvedValue({
      conversation: {
        id: 'conv_1',
        scene: 'meditation',
        title: '睡前冥想',
        created_at: 1,
        updated_at: 1,
      },
      script_draft: null,
      script_artifact: null,
      has_unsaved_changes: false,
      active_run_id: null,
    })
    mocks.listMessages
      .mockResolvedValueOnce({ items: [staleMessage], has_more: false })
      .mockResolvedValue({ items: [staleMessage, latestMessage], has_more: false })
    mocks.listConversationModels.mockResolvedValue({
      models: [{ provider: 'moonshot', model: 'kimi-k2.6', name: 'Kimi K2.6' }],
    })
    mocks.getScriptConfig.mockResolvedValue({
      revision: 1,
      emotion_tags: [],
      vocal_tags: [],
      pause_presets: [500],
      defaults: { emotion_tags: [], vocal_tags: [], pause_presets: [500] },
    })
    mocks.retryMessage.mockResolvedValue({
      run_id: 'run_retry',
      kind: 'script',
      status: 'queued',
      events_url: '/api/runs/run_retry/events',
    })
  })

  it('失败后重试会重新拉取消息，并使用服务端最新 user message id', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('旧消息')).toBeInTheDocument()
    act(() => {
      mocks.handlers['run.failed']?.({
        code: 'LLM_REQUEST_INVALID',
        message: '模型请求参数不合法',
      } as never)
    })

    await user.click(await screen.findByRole('button', { name: /重试/ }))

    await waitFor(() => {
      expect(mocks.listMessages.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(mocks.retryMessage).toHaveBeenCalledWith('conv_1', 'msg_latest', false)
    })
  })
})
