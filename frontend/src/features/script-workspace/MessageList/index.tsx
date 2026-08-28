import { ReloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useEffect, useRef } from 'react'
import type { LlmModelInfo, Message } from '../../../api/types'
import { runErrorText } from '../errors'
import { formatFileSize } from '../attachments'

export interface RunFailure {
  code: string
  message: string
}

interface MessageListProps {
  messages: Message[]
  models: LlmModelInfo[]
  /** 流式增量气泡文本（运行中） */
  streamingText: string
  streaming: boolean
  /** 失败卡片（run.failed 后保留，直到重试/再次发送） */
  failure: RunFailure | null
  onRetry: () => void
}

/** 对话消息流：用户/助手气泡分型、流式增量气泡、失败卡片（重试）。 */
export default function MessageList({
  messages,
  models,
  streamingText,
  streaming,
  failure,
  onRetry,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamingText, failure])

  return (
    <div className="msg-list" role="log" aria-label="对话消息流">
      {messages.map((message, index) => {
        if (message.role === 'user') {
          return (
            <div key={message.id} className="msg user">
              <div className="msg-bubble">{message.content}</div>
              {message.attachments.length > 0 && (
                <div className="msg-attachments" aria-label="消息附件">
                  {message.attachments.map((attachment) => (
                    <span key={attachment.id} className="msg-attachment" title={attachment.name}>
                      <span className="msg-attachment-name">{attachment.name}</span>
                      <span>{formatFileSize(attachment.size)}</span>
                    </span>
                  ))}
                </div>
              )}
              {message.params && (
                <div className="msg-meta">
                  <span className="model-tag">{message.params.duration} 分钟</span>
                </div>
              )}
            </div>
          )
        }
        const userModel = userModelOf(messages, index, models)
        return (
          <div key={message.id} className="msg ai">
            <div className="msg-bubble">{message.content}</div>
            {userModel && (
              <div className="msg-meta">
                <span className="model-tag">{userModel}</span>
              </div>
            )}
          </div>
        )
      })}

      {streaming && streamingText && (
        <div className="msg ai">
          <div className="msg-bubble">
            {streamingText}
            <span className="cursor-blink" aria-hidden />
          </div>
        </div>
      )}
      {streaming && !streamingText && (
        <div className="msg ai">
          <div className="msg-bubble">
            <span className="typing" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}

      {failure && (
        <div className="msg ai">
          <div className="failure-card" role="alert">
            <div className="failure-title">生成失败</div>
            <div className="failure-desc">{runErrorText(failure.code, failure.message)}</div>
            <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
              重试
            </Button>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

/** assistant 气泡的模型徽标：取其前最近一条 user 消息的参数 */
function userModelOf(messages: Message[], index: number, models: LlmModelInfo[]): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const params = messages[i].params
    if (params) {
      const info = models.find((m) => m.model === params.model)
      return info ? info.name : params.model
    }
  }
  return null
}
