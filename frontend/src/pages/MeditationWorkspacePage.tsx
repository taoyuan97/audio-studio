import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightOutlined,
  CheckOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { App, Button, Input, List, Modal, Skeleton, Tag } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  getConversation,
  listConversationModels,
  listMessages,
  retryMessage,
  saveScriptVersion,
  sendMessage,
  updateScriptDraft,
} from '../api/conversations'
import { listArtifactVersions, restoreArtifactVersion } from '../api/artifacts'
import { cancelRun } from '../api/runs'
import type {
  ScriptContent,
  ScriptDuration,
  ScriptVersion,
  SendMessageAttachment,
} from '../api/types'
import { useRunStream } from '../lib/sse'
import { useUiStore } from '../stores/uiStore'
import DurationSelect from '../components/DurationSelect'
import ModelSelect from '../components/ModelSelect'
import MessageList, { type RunFailure } from '../features/script-workspace/MessageList'
import ScriptView from '../features/script-workspace/ScriptView'
import {
  formatFileSize,
  mergeSelectedFiles,
  type PendingAttachment,
} from '../features/script-workspace/attachments'

/** 生成步骤动画（结果区，对齐原型语义） */
const GEN_STEPS = ['解析主题与目标时长', '模型流式生成脚本', '标记解析与产物入库']

type RunPhase = 'queued' | 'streaming' | 'finalizing'

interface PendingSend {
  text: string
  duration: ScriptDuration
  model: string
  attachments: SendMessageAttachment[]
}

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
  const scriptDraft = detailQuery.data?.script_draft
  const artifact = detailQuery.data?.script_artifact
  const hasUnsavedChanges = detailQuery.data?.has_unsaved_changes ?? false
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
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  // 参数默认值：工作草稿（最近一次生成）优先，其次当前正式版本与模型列表首个
  useEffect(() => {
    const params = (scriptDraft?.params ?? artifact?.params) as {
      duration?: number
      model?: string
    } | null
    if (params?.duration && [5, 10, 15, 20, 25, 30].includes(params.duration)) {
      setDuration(params.duration as ScriptDuration)
    }
    if (params?.model) setModel(params.model)
  }, [scriptDraft?.revision, artifact?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    'script.draft.updated': () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
    'run.completed': () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
      exitRunState()
    },
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

  const [overwriteOpen, setOverwriteOpen] = useState(false)
  const [overwriteIsRetry, setOverwriteIsRetry] = useState(false)
  const [sendAfterSave, setSendAfterSave] = useState(false)
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)

  const createSendSnapshot = (): PendingSend => ({
    text: input.trim(),
    duration,
    model,
    attachments: attachments.map(({ name, content }) => ({ name, content })),
  })

  const submitMessage = async (
    allowDraftOverwrite = false,
    snapshot = createSendSnapshot(),
  ) => {
    if (!snapshot.text || running || !conversationId) return
    try {
      const run = await sendMessage(conversationId, {
        ...snapshot,
        allow_draft_overwrite: allowDraftOverwrite,
      })
      enterRunState(run.run_id)
      setInput('')
      setAttachments([])
      setPendingSend(null)
    } catch (error) {
      setPendingSend(null)
      handleActionError(error, '发送失败')
    }
  }

  const handleSend = () => {
    if (editing || editMutation.isPending) return
    const snapshot = createSendSnapshot()
    if (!snapshot.text || !snapshot.model) return
    const protectedDraft =
      hasUnsavedChanges &&
      (scriptDraft?.origin === 'manual' || scriptDraft?.origin === 'restored')
    if (protectedDraft) {
      setPendingSend(snapshot)
      setOverwriteIsRetry(false)
      setOverwriteOpen(true)
      return
    }
    void submitMessage(false, snapshot)
  }

  const handleAttachmentChange = async (files: FileList | null) => {
    if (!files) return
    const result = await mergeSelectedFiles(attachments, Array.from(files))
    setAttachments(result.accepted)
    if (result.errors.length > 0) message.warning(result.errors.join('；'))
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
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

  const submitRetry = async (allowDraftOverwrite = false) => {
    if (!conversationId || !lastUserMessage) return
    try {
      const run = await retryMessage(
        conversationId,
        lastUserMessage.id,
        allowDraftOverwrite,
      )
      enterRunState(run.run_id)
    } catch (error) {
      handleActionError(error, '重试失败')
    }
  }

  const handleRetry = () => {
    const protectedDraft =
      hasUnsavedChanges &&
      (scriptDraft?.origin === 'manual' || scriptDraft?.origin === 'restored')
    if (protectedDraft) {
      setOverwriteIsRetry(true)
      setOverwriteOpen(true)
      return
    }
    void submitRetry()
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

  // ---------------- 工作草稿编辑与版本保存 ----------------

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveNameOpen, setSaveNameOpen] = useState(false)
  const [scriptName, setScriptName] = useState('')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<ScriptVersion | null>(null)
  const [failedDraftText, setFailedDraftText] = useState<string | null>(null)

  const editMutation = useMutation({
    mutationFn: ({ text, revision }: { text: string; revision: number }) =>
      updateScriptDraft(conversationId, text, revision),
    onSuccess: (updatedDraft) => {
      setFailedDraftText(null)
      queryClient.setQueryData(
        ['conversation', conversationId],
        (current: typeof detailQuery.data) =>
          current
            ? { ...current, script_draft: updatedDraft, has_unsaved_changes: true }
            : current,
      )
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
    onError: (error, variables) => {
      setFailedDraftText(variables.text)
      if (error instanceof ApiError) message.error(error.message)
      else message.error('草稿自动保存失败')
    },
  })

  useEffect(() => {
    if (
      !editing ||
      !scriptDraft ||
      editMutation.isPending ||
      draft === failedDraftText ||
      draft === scriptDraft.content.text
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      editMutation.mutate({ text: draft, revision: scriptDraft.revision })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [draft, editing, scriptDraft, editMutation.isPending, failedDraftText]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveVersionMutation = useMutation({
    mutationFn: (name?: string) =>
      saveScriptVersion(conversationId, scriptDraft!.revision, name),
    onSuccess: async (result) => {
      setSaveNameOpen(false)
      setScriptName('')
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      queryClient.invalidateQueries({ queryKey: ['script-versions', result.artifact.id] })
      queryClient.invalidateQueries({ queryKey: ['artifacts'] })
      message.success(`已保存为 v${result.version.version_no}`)
      if (sendAfterSave) {
        setSendAfterSave(false)
        setOverwriteOpen(false)
        if (overwriteIsRetry) await submitRetry(true)
        else if (pendingSend) await submitMessage(true, pendingSend)
      }
    },
    onError: (error) => {
      setSendAfterSave(false)
      setPendingSend(null)
      if (error instanceof ApiError) {
        if (error.code === 'SCRIPT_DRAFT_REVISION_CONFLICT') {
          queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
        }
        message.error(error.message)
      }
      else message.error('保存版本失败')
    },
  })

  const versionsQuery = useQuery({
    queryKey: ['script-versions', artifact?.id],
    queryFn: () => listArtifactVersions(artifact!.id),
    enabled: versionsOpen && Boolean(artifact?.id),
  })

  const restoreMutation = useMutation({
    mutationFn: (version: ScriptVersion) =>
      restoreArtifactVersion(artifact!.id, version.id, scriptDraft!.revision),
    onSuccess: () => {
      setVersionsOpen(false)
      setSelectedVersion(null)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
      message.success('历史版本已恢复为工作草稿，保存后将产生新版本')
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.code === 'SCRIPT_DRAFT_REVISION_CONFLICT') {
          queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
        }
        message.error(error.message)
      }
      else message.error('恢复版本失败')
    },
  })

  const handleSaveVersion = (continueAfterSave = false) => {
    setSendAfterSave(continueAfterSave)
    if (!artifact) {
      setScriptName(`${conversation?.title ?? '未命名冥想'}·脚本`)
      setSaveNameOpen(true)
      return
    }
    saveVersionMutation.mutate()
  }

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
              disabled={running || editing || editMutation.isPending}
              placeholder="描述你想要的冥想主题，如：帮我生成一段缓解睡前焦虑的引导脚本"
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  handleSend()
                }
              }}
            />
          </div>
          {attachments.length > 0 && (
            <div className="composer-attachments" aria-label="待发送附件">
              {attachments.map((attachment) => (
                <span key={attachment.key} className="composer-attachment" title={attachment.name}>
                  <span className="composer-attachment-name">{attachment.name}</span>
                  <span>{formatFileSize(attachment.size)}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${attachment.name}`}
                    disabled={running || editing || editMutation.isPending}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.key !== attachment.key),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-foot">
            <div className="composer-tools">
              <input
                ref={attachmentInputRef}
                className="attachment-input"
                type="file"
                multiple
                accept=".md,.txt,text/markdown,text/plain"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void handleAttachmentChange(event.target.files)}
              />
              <Button
                className="attachment-trigger"
                type="text"
                shape="circle"
                icon={<PlusOutlined />}
                aria-label="添加参考资料"
                title={attachments.length >= 3 ? '单次最多 3 个附件' : '添加参考资料'}
                disabled={
                  attachments.length >= 3 || running || editing || editMutation.isPending
                }
                onClick={() => attachmentInputRef.current?.click()}
              />
              <DurationSelect
                value={duration}
                onChange={setDuration}
                disabled={running || editing || editMutation.isPending}
              />
              <ModelSelect
                models={models}
                value={model || undefined}
                onChange={setModel}
                loading={modelsQuery.isLoading}
                disabled={running || editing || editMutation.isPending}
              />
            </div>
            {!modelsQuery.isLoading && models.length === 0 && (
              <span className="composer-tip" role="note">
                未配置任何模型：请在服务端 .env 配置 LLM API Key（DEEPSEEK/DASHSCOPE/MOONSHOT）并重启
              </span>
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
                disabled={!input.trim() || !model || editing || editMutation.isPending}
                onClick={handleSend}
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
        ) : scriptDraft?.content ? (
          <ScriptResultCard
            targetDuration={(scriptDraft.params as { duration?: number }).duration ?? duration}
            content={scriptDraft.content}
            editing={editing}
            draft={draft}
            savingDraft={editMutation.isPending}
            draftSaveFailed={failedDraftText === draft}
            hasArtifact={Boolean(artifact)}
            hasUnsavedChanges={hasUnsavedChanges}
            currentVersionNo={artifact?.current_version_no ?? null}
            savingVersion={saveVersionMutation.isPending}
            onDraftChange={(value) => {
              setFailedDraftText(null)
              setDraft(value)
            }}
            onStartEdit={() => {
              setDraft(scriptDraft.content.text)
              setEditing(true)
            }}
            onFinishEdit={() => {
              if (
                scriptDraft &&
                draft.trim() &&
                draft !== scriptDraft.content.text &&
                !editMutation.isPending
              ) {
                editMutation.mutate(
                  { text: draft, revision: scriptDraft.revision },
                  { onSuccess: () => setEditing(false) },
                )
                return
              }
              setEditing(false)
            }}
            onSaveVersion={() => handleSaveVersion()}
            onSendToTts={() => artifact && navigate(`/tts?artifact_id=${artifact.id}`)}
            onOpenVersions={() => {
              setSelectedVersion(null)
              setVersionsOpen(true)
            }}
          />
        ) : (
          <EmptyScriptGuide />
        )}
      </section>

      <Modal
        title="保存脚本"
        open={saveNameOpen}
        okText="保存为 v1"
        cancelText="取消"
        confirmLoading={saveVersionMutation.isPending}
        okButtonProps={{ disabled: !scriptName.trim() }}
        onCancel={() => {
          setSaveNameOpen(false)
          setSendAfterSave(false)
          setPendingSend(null)
        }}
        onOk={() => saveVersionMutation.mutate(scriptName.trim())}
        destroyOnHidden
      >
        <div className="save-script-field">
          <label htmlFor="script-name">脚本名称</label>
          <Input
            id="script-name"
            value={scriptName}
            maxLength={100}
            autoFocus
            placeholder={conversation.title}
            onChange={(event) => setScriptName(event.target.value)}
            onPressEnter={() => {
              if (scriptName.trim() && !saveVersionMutation.isPending) {
                saveVersionMutation.mutate(scriptName.trim())
              }
            }}
          />
          <span>首次保存需要命名；后续保存将在同一脚本下追加版本。</span>
        </div>
      </Modal>

      <Modal
        title="未保存的人工草稿"
        open={overwriteOpen}
        closable={!saveVersionMutation.isPending}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setOverwriteOpen(false)
              setPendingSend(null)
            }}
          >
            取消
          </Button>,
          <Button
            key="overwrite"
            danger
            onClick={() => {
              setOverwriteOpen(false)
              if (overwriteIsRetry) void submitRetry(true)
              else if (pendingSend) void submitMessage(true, pendingSend)
            }}
          >
            覆盖草稿并继续
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saveVersionMutation.isPending}
            onClick={() => handleSaveVersion(true)}
          >
            先保存并继续
          </Button>,
        ]}
        onCancel={() => setOverwriteOpen(false)}
        destroyOnHidden
      >
        <p>当前草稿包含人工编辑或从历史版本恢复的内容。继续生成会在成功后替换这份草稿。</p>
      </Modal>

      <Modal
        title={artifact ? `${artifact.name} · 版本历史` : '版本历史'}
        open={versionsOpen}
        width={860}
        footer={null}
        onCancel={() => {
          setVersionsOpen(false)
          setSelectedVersion(null)
        }}
        destroyOnHidden
        getContainer={false}
      >
        <div className="version-history-layout">
          <List
            className="version-list"
            loading={versionsQuery.isLoading}
            dataSource={versionsQuery.data?.items ?? []}
            locale={{ emptyText: '暂无版本' }}
            renderItem={(version) => (
              <List.Item
                className={selectedVersion?.id === version.id ? 'active' : ''}
                onClick={() => setSelectedVersion(version)}
              >
                <List.Item.Meta
                  title={`v${version.version_no}`}
                  description={new Date(version.created_at).toLocaleString('zh-CN')}
                />
              </List.Item>
            )}
          />
          <div className="version-preview">
            {selectedVersion ? (
              <>
                <div className="version-preview-head">
                  <strong>v{selectedVersion.version_no}</strong>
                  <Button
                    type="primary"
                    size="small"
                    loading={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(selectedVersion)}
                  >
                    恢复为草稿
                  </Button>
                </div>
                <ScriptView content={selectedVersion.content} />
              </>
            ) : (
              <div className="version-empty">选择一个版本查看内容</div>
            )}
          </div>
        </div>
      </Modal>
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
  targetDuration: number
  content: ScriptContent
  editing: boolean
  draft: string
  savingDraft: boolean
  draftSaveFailed: boolean
  hasArtifact: boolean
  hasUnsavedChanges: boolean
  currentVersionNo: number | null
  savingVersion: boolean
  onDraftChange: (value: string) => void
  onStartEdit: () => void
  onFinishEdit: () => void
  onSaveVersion: () => void
  onSendToTts: () => void
  onOpenVersions: () => void
}

function ScriptResultCard({
  targetDuration,
  content,
  editing,
  draft,
  savingDraft,
  draftSaveFailed,
  hasArtifact,
  hasUnsavedChanges,
  currentVersionNo,
  savingVersion,
  onDraftChange,
  onStartEdit,
  onFinishEdit,
  onSaveVersion,
  onSendToTts,
  onOpenVersions,
}: ScriptResultCardProps) {
  return (
    <div className="script-result-card">
      <div className="card-title-row">
        <span className="card-title">生成结果</span>
        <Tag color="blue">冥想脚本</Tag>
        <span style={{ flex: 1 }} />
        {currentVersionNo ? (
          <Button size="small" type="text" icon={<HistoryOutlined />} onClick={onOpenVersions}>
            v{currentVersionNo} · 版本历史
          </Button>
        ) : (
          <Tag>未保存为脚本</Tag>
        )}
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
          <div className="field-hint">
            {savingDraft
              ? '草稿保存中…'
              : draftSaveFailed
                ? '草稿自动保存失败；修改内容或点击“完成编辑”重试。'
                : '草稿已自动保存，但尚未保存为版本。'}
          </div>
          <div className="btn-row">
            <Button
              size="small"
              type="primary"
              disabled={!draft.trim() || savingDraft}
              onClick={onFinishEdit}
            >
              完成编辑
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
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              loading={savingVersion}
              disabled={!hasUnsavedChanges || savingDraft}
              onClick={onSaveVersion}
            >
              {hasArtifact ? '保存新版本' : '保存脚本'}
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              type="primary"
              icon={<ArrowRightOutlined />}
              title="送 TTS 合成（T004 任务入口）"
              disabled={!hasArtifact || hasUnsavedChanges || savingDraft}
              onClick={onSendToTts}
            >
              送去 TTS
            </Button>
          </div>
          <div className="note">
            {hasUnsavedChanges
              ? '当前是未保存草稿；AI 生成和人工编辑不会覆盖已保存版本。'
              : `当前草稿已保存为 v${currentVersionNo ?? 1}。`}
          </div>
        </>
      )}
    </div>
  )
}

function EmptyScriptGuide() {
  return (
    <div className="empty-state">
      <div className="es-title">尚未生成脚本</div>
      <div className="es-desc">
        在左侧对话中描述你的主题并发送
        <br />
        生成结果可编辑，保存为版本后进入产物库
      </div>
    </div>
  )
}
