import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import MessageList from '.'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  })
})

describe('MessageList attachments', () => {
  it('shows attachment metadata without content actions', () => {
    render(
      <MessageList
        messages={[
          {
            id: 'msg_1',
            role: 'user',
            content: '参考附件生成',
            params: { duration: 5, model: 'deepseek-chat' },
            attachments: [
              {
                id: 'att_1',
                name: '睡眠参考.md',
                size: 1536,
                media_type: 'text/markdown',
              },
            ],
            created_at: 1,
          },
        ]}
        models={[]}
        streamingText=""
        streaming={false}
        failure={null}
        onRetry={() => undefined}
      />,
    )

    expect(screen.getByText('睡眠参考.md')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /睡眠参考/ })).not.toBeInTheDocument()
  })
})
