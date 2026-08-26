import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ModelSelect from '.'

beforeAll(() => {
  // antd 组件依赖 matchMedia（jsdom 缺失）
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(cleanup)

describe('ModelSelect 只展示可用模型', () => {
  it('选中项只显示实际模型 ID，不显示供应商展示名', () => {
    render(
      <ModelSelect
        models={[
          { provider: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek Chat' },
          { provider: 'moonshot', model: 'kimi-k2-0905-preview', name: 'Kimi K2' },
        ]}
        value="kimi-k2-0905-preview"
      />,
    )
    expect(screen.getByText('kimi-k2-0905-preview')).toBeInTheDocument()
    expect(screen.queryByText('Kimi K2')).not.toBeInTheDocument()
  })

  it('空列表显示「无可用模型」占位', () => {
    render(<ModelSelect models={[]} />)
    expect(screen.getByText('无可用模型')).toBeInTheDocument()
  })
})
