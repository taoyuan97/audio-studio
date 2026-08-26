import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightOutlined,
  CheckOutlined,
  EditOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { App, Button, Input, Skeleton, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  getConversation,
  listConversationModels,
  listMessages,
  retryMessage,
  sendMessage,
} from '../api/conversations'
import { updateArtifact } from '../api/artifacts'
import { cancelRun } from '../api/runs'
import type { ScriptContent, ScriptDuration } from '../api/types'
import { useRunStream } from '../lib/sse'
import { useUiStore } from '../stores/uiStore'
import DurationSelect from '../components/DurationSelect'
import ModelSelect from '../components/ModelSelect'
import MessageList, { type RunFailure } from '../features/script-workspace/MessageList'
import ScriptView from '../features/script-workspace/ScriptView'

/** 生成步骤动画（结果区，对齐原型语义） */
const GEN_STEPS = ['解析主题与目标时长', '模型流式生成脚本', '标记解析与产物入库']

const SUGGESTIONS = [
  '帮我生成一段深海放松的引导脚本',
  '最近睡前容易焦虑，想要一段睡眠引导冥想',
  '来一份清晨唤醒的正念练习',
]

type RunPhase = 'queued' | 'streaming' | 'finalizing'

/** /meditation/:conversationId 工作台（专注模式）：对话 + 脚本结果区 + 编辑闭环 */
export default function MeditationWorkspacePage() {
  const { conversationId = '' } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const pushBanner = useUiStore((state) => state.pushBanner)

  // ---------------- 数据查询 ----------------

  const detailQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    retry: false,
  })

  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => listMessages(conversationId),
  })

  const modelsQuery = useQuery({
    queryKey: ['models', conversationId],
    queryFn: () => listConversationModels(conversationId),
    staleTime: 60_000,
  })

  const conversation = detailQuery.data?.conversation
  const artifact = detailQuery.data?.script_artifact
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data])
  const messages = useMemo(() => messagesQuery.data?.items ?? [], [messagesQuery.data])

  // ---------------- 运行态（Zustand 外置为局部 state：单页消费） ----------------

  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [runPhase, setRunPhase] = useState<RunPhase | null>(null)
  const [queuePosition, setQueuePosition] = useState(0)
  const [failure, setFailure] = useState<RunFailure | null>(null)
  const running = activeRunId !== null

  // ---------------- 参数与输入 ----------------

  const [duration, setDuration] = useState<ScriptDuration>(15)
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')

  // 参数默认值：产物 params（最近一次生成）优先，其次可用模型列表首个
  useEffect(() => {
    const params = artifact?.params as { duration?: number; model?: string } | null
    if (params?.duration && [5, 15, 30].includes(params.duration)) {
      setDuration(params.duration as ScriptDuration)
    }
    if (params?.model) setModel(params.model)
  }, [artifact?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 模型选择：默认取可用列表首个；历史产物/参数中的 model 不在当前可用列表时回退
  // （如后续移除了对应 Key），避免 Select 显示一个不可用的裸 model id
  useEffect(() => {
    if (models.length === 0) return
    if (!model || !models.some((item) => item.model === model)) {
      setModel(models[0].model)
    }
  }, [models, model])

  // 刷新恢复：聚合接口的 active_run_id → 重连 SSE 恢复运行态
  const recoveredRunId = detailQuery.data?.active_run_id
  useEffect(() => {
    if (recoveredRunId) {
      setActiveRunId((current) => current ?? recoveredRunId)
      setRunPhase((current) => current ?? 'streaming')
    }
  }, [recoveredRunId])

  // ---------------- SSE 事件分发 ----------------

  const exitRunState = () => {
    setActiveRunId(null)
    setStreamingText('')
    setRunPhase(null)
    setQueuePosition(0)
  }

  useRunStream(activeRunId, {
    'run.status': (payload) => {
      if (payload.status === 'queued') {
        setRunPhase('queued')
        setQueuePosition(payload.queue_position)
      }
    },
    'run.started': () => setRunPhase('streaming'),
    'assistant.delta': (payload) => {
      setRunPhase('streaming')
      setStreamingText((prev) => prev + payload.delta)
    },
    'message.completed': () => {
      setRunPhase('finalizing')
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
    'artifact.updated': () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
    'run.completed': exitRunState,
    'run.failed': (payload) => {
      setFailure({ code: payload.code, message: payload.message })
      exitRunState()
    },
    'run.cancelled': exitRunState,
  })

  // ---------------- 动作 ----------------

  const enterRunState = (runId: string) => {
    setFailure(null)
    setStreamingText('')
    setQueuePosition(0)
    setRunPhase('queued')
    setActiveRunId(runId)
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || running || !conversationId) return
    try {
      const run = await sendMessage(conversationId, { text, duration, model })
      enterRunState(run.run_id)
      setInput('')
    } catch (error) {
      handleActionError(error, '发送失败')
    }
  }

  const handleCancel = async () => {
    if (!activeRunId) return
    try {
      await cancelRun(activeRunId)
    } catch (error) {
      handleActionError(error, '取消失败')
    }
  }

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((item) => item.role === 'user'),
    [messages],
  )

  const handleRetry = async () => {
    if (!conversationId || !lastUserMessage) return
    try {
      const run = await retryMessage(conversationId, lastUserMessage.id)
      enterRunState(run.run_id)
    } catch (error) {
      handleActionError(error, '重试失败')
    }
  }

  function handleActionError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.code === 'CONVERSATION_RUN_ACTIVE') {
        pushBanner('warning', '该会话已有生成任务进行中')
        queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
        return
      }
      pushBanner('error', error.message)
      return
    }
    pushBanner('error', fallback)
  }

  // ---------------- 脚本编辑闭环 ----------------

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const editMutation = useMutation({
    mutationFn: (text: string) =>
      updateArtifact(artifact!.id, { content: { text } }),
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      message.success('脚本已保存并重新解析')
    },
    onError: (error) => {
      if (error instanceof ApiError) message.error(error.message)
      else message.error('保存失败')
    },
  })

  // ---------------- 渲染 ----------------

  if (detailQuery.isError) {
    return (
      <div className="workspace-error">
        <p>会话不存在或已删除</p>
        <Button type="primary" onClick={() => navigate('/meditation')}>
          返回列表
        </Button>
      </div>
    )
  }

  if (!conversation) {
    return <Skeleton active paragraph={{ rows: 8 }} />
  }

  return (
    <div className="workspace-grid">
      {/* 左栏：对话生成 */}
      <section className="card chat-card" aria-label="对话生成">
        <div className="card-title-row">
          <span className="card-title">{conversation.title}</span>
          <Tag color="purple">冥想</Tag>
        </div>

        <MessageList
          messages={messages}
          models={models}
          streamingText={streamingText}
          streaming={running}
          failure={failure}
          onRetry={handleRetry}
        />

        <div className="chat-composer">
          <div className="composer-box">
            <Input.TextArea
              className="chat-input"
              value={input}
              rows={2}
              maxLength={20000}
              disabled={running}
              placeholder="描述你想要的冥想主题，如：帮我生成一段缓解睡前焦虑的引导脚本"
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />
          </div>
          <div className="composer-foot">
            <div className="composer-tools">
              <DurationSelect value={duration} onChange={setDuration} disabled={running} />
              <ModelSelect
                models={models}
                value={model || undefined}
                onChange={setModel}
                loading={modelsQuery.isLoading}
                disabled={running}
              />
            </div>
            {!modelsQuery.isLoading && models.length === 0 ? (
              <span className="composer-tip" role="note">
                未配置任何模型：请在服务端 .env 配置 LLM API Key（DEEPSEEK/DASHSCOPE/MOONSHOT）并重启
              </span>
            ) : (
              <span className="composer-tip">Enter 发送 · Shift+Enter 换行</span>
            )}
            {running ? (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={() => void handleCancel()}
                title="取消生成（丢弃临时内容）"
              >
                取消
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={!input.trim() || !model}
                onClick={() => void handleSend()}
                aria-label="发送"
              >
                发送
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* 右栏：脚本结果区 */}
      <section className="card result-card" aria-label="脚本结果区">
        {running ? (
          <GeneratingPanel phase={runPhase} queuePosition={queuePosition} streamingText={streamingText} />
        ) : artifact?.content ? (
          <ScriptResultCard
            artifactId={artifact.id}
            targetDuration={(artifact.params as { duration?: number } | null)?.duration ?? duration}
            content={artifact.content}
            editing={editing}
            draft={draft}
            saving={editMutation.isPending}
            onDraftChange={setDraft}
            onStartEdit={() => {
              setDraft(artifact.content!.text)
              setEditing(true)
            }}
            onCancelEdit={() => setEditing(false)}
            onSaveEdit={() => editMutation.mutate(draft)}
          />
        ) : (
          <EmptyScriptGuide onPick={(text) => setInput(text)} />
        )}
      </section>
    </div>
  )
}

// ---------------- 子组件 ----------------

function GeneratingPanel({
  phase,
  queuePosition,
  streamingText,
}: {
  phase: RunPhase | null
  queuePosition: number
  streamingText: string
}) {
  const activeStep = phase === 'queued' ? 0 : phase === 'streaming' ? 1 : 2
  return (
    <div className="gen-panel" data-testid="generating-panel">
      <div className="card-title-row">
        <span className="card-title">生成中</span>
      </div>
      {GEN_STEPS.map((step, index) => (
        <div key={step} className={`gen-step ${index < activeStep ? 'done' : index === activeStep ? 'active' : ''}`}>
          <span className="gs-icon">{index < activeStep ? <CheckOutlined /> : null}</span>
          {index === 0 && phase === 'queued' && queuePosition > 0 ? `${step}（前面还有 ${queuePosition} 个任务）` : step}
        </div>
      ))}
      <div className="progress">
        <div className="bar" style={{ width: `${(activeStep + 1) * 33}%` }} />
      </div>
      {streamingText && (
        <div className="gen-stream-preview">
          <span className="composer-tip">流式输出预览</span>
          <div className="gen-stream-text">{streamingText}</div>
        </div>
      )}
    </div>
  )
}

interface ScriptResultCardProps {
  artifactId: string
  targetDuration: number
  content: ScriptContent
  editing: boolean
  draft: string
  saving: boolean
  onDraftChange: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
}

function ScriptResultCard({
  targetDuration,
  content,
  editing,
  draft,
  saving,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: ScriptResultCardProps) {
  return (
    <div className="script-result-card">
      <div className="card-title-row">
        <span className="card-title">生成结果</span>
        <Tag color="blue">冥想脚本</Tag>
      </div>
      <div className="param-chips">
        <span className="param-chip">目标时长：{targetDuration} 分钟</span>
      </div>

      {editing ? (
        <>
          <Input.TextArea
            className="script-edit"
            value={draft}
            rows={14}
            maxLength={20000}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="编辑脚本文本，支持标记：[停顿 5s] [情绪:温柔] [吸气] [呼气] [语速:慢速]"
          />
          <div className="field-hint">保存后后端将重新解析标记，徽章与时间轴按最新文本刷新。</div>
          <div className="btn-row">
            <Button size="small" onClick={onCancelEdit}>
              取消
            </Button>
            <Button size="small" type="primary" loading={saving} onClick={onSaveEdit}>
              保存并重新解析
            </Button>
          </div>
        </>
      ) : (
        <>
          <ScriptView content={content} />
          <div className="btn-row">
            <Button size="small" icon={<EditOutlined />} onClick={onStartEdit}>
              编辑脚本
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              type="primary"
              icon={<ArrowRightOutlined />}
              title="送 TTS 合成（T004 任务入口）"
              disabled
            >
              送去 TTS
            </Button>
          </div>
          <div className="note">产物已自动入库（会话 1:1 原地更新）；「送去 TTS」将在 T004 任务中开放。</div>
        </>
      )}
    </div>
  )
}

function EmptyScriptGuide({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="empty-state">
      <div className="es-title">尚未生成脚本</div>
      <div className="es-desc">
        在左侧对话中描述你的主题并发送
        <br />
        生成结果可编辑并自动存入产物库
      </div>
      <div className="suggest-list">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="suggest-item" onClick={() => onPick(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
