import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ScriptView from '.'
import { formatEstDuration } from './format'
import type { ScriptContent } from '../../../api/types'

afterEach(cleanup)

function makeContent(overrides: Partial<ScriptContent> = {}): ScriptContent {
  return {
    text: '',
    segments: [],
    est_duration: 0,
    ...overrides,
  }
}

describe('formatEstDuration', () => {
  it('不足一分钟显示秒', () => {
    expect(formatEstDuration(45)).toBe('45 秒')
  })

  it('分钟 + 补零秒', () => {
    expect(formatEstDuration(125)).toBe('2 分 05 秒')
    expect(formatEstDuration(60)).toBe('1 分 00 秒')
  })
})

describe('ScriptView 标记徽章与时间轴渲染', () => {
  it('渲染语音段文本与停顿段', () => {
    render(
      <ScriptView
        content={makeContent({
          est_duration: 10,
          segments: [
            { kind: 'speech', text: '欢迎来到深海放松', emotion: null, speed: null },
            { kind: 'pause', seconds: 4 },
            { kind: 'speech', text: '让呼吸慢下来', emotion: null, speed: null },
          ],
        })}
      />,
    )

    const view = screen.getByTestId('script-view')
    expect(view).toHaveTextContent('欢迎来到深海放松')
    expect(view).toHaveTextContent('让呼吸慢下来')
    expect(screen.getByText('停顿 4s')).toBeInTheDocument()
  })

  it('语音段渲染情绪与语速徽章', () => {
    render(
      <ScriptView
        content={makeContent({
          est_duration: 30,
          segments: [
            { kind: 'speech', text: '温柔地说', emotion: '温柔', speed: '慢速' },
          ],
        })}
      />,
    )

    expect(screen.getByText('情绪·温柔')).toBeInTheDocument()
    expect(screen.getByText('语速·慢速')).toBeInTheDocument()
  })

  it('无标记语音段不渲染徽章', () => {
    render(
      <ScriptView
        content={makeContent({
          est_duration: 5,
          segments: [{ kind: 'speech', text: '普通段落', emotion: null, speed: null }],
        })}
      />,
    )

    expect(screen.queryByText(/情绪·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/语速·/)).not.toBeInTheDocument()
  })

  it('渲染时间轴分段与预估时长/字数', () => {
    const { container } = render(
      <ScriptView
        content={makeContent({
          est_duration: 92,
          segments: [
            { kind: 'speech', text: '第一段语音内容', emotion: null, speed: null },
            { kind: 'pause', seconds: 3 },
            { kind: 'speech', text: '第二段', emotion: null, speed: null },
          ],
        })}
      />,
    )

    // 时间轴：语音/停顿分段各按 kind 着色
    const segments = container.querySelectorAll('.tl-seg')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toHaveClass('tl-speech')
    expect(segments[1]).toHaveClass('tl-pause')
    expect(segments[2]).toHaveClass('tl-speech')

    // 汇总信息：预估口播 + 正文字数（去空白）
    expect(screen.getByText(/预估口播：约 1 分 32 秒/)).toBeInTheDocument()
    expect(screen.getByText(/正文：\s*10\s*字/)).toBeInTheDocument()
  })

  it('空 segments 不渲染时间轴分段也不崩溃', () => {
    const { container } = render(<ScriptView content={makeContent()} />)
    expect(container.querySelectorAll('.tl-seg')).toHaveLength(0)
    expect(screen.getByText(/预估口播：约 0 秒/)).toBeInTheDocument()
  })

  it('使用脚本配置显示英文情绪和语气词的中文名称', () => {
    render(
      <ScriptView
        content={{
          text: '[emotion:asmr]正文[vocal:sighing]',
          est_duration: 2,
          segments: [
            { kind: 'speech', text: '正文', emotion: 'asmr', speed: null },
            { kind: 'vocal', tag: 'sighing' },
          ],
        }}
        scriptConfig={{
          revision: 1,
          emotion_tags: [{ name: 'asmr', label: '轻柔耳语', enabled: true }],
          vocal_tags: [{ name: 'sighing', label: '叹息', enabled: true }],
          pause_presets: [1],
          defaults: { emotion_tags: [], vocal_tags: [], pause_presets: [] },
        }}
      />,
    )
    expect(screen.getByText('情绪·轻柔耳语')).toBeInTheDocument()
    expect(screen.getByText('语气词·叹息')).toBeInTheDocument()
  })

  it('正文字数统计去除空白字符', () => {
    render(
      <ScriptView
        content={makeContent({
          est_duration: 5,
          segments: [{ kind: 'speech', text: '深  海\n放松', emotion: null, speed: null }],
        })}
      />,
    )
    expect(screen.getByText(/正文：\s*4\s*字/)).toBeInTheDocument()
  })
})
