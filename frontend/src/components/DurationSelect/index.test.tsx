import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import DurationSelect from '.'

beforeAll(() => {
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

describe('DurationSelect', () => {
  it('提供六个目标时长档位', async () => {
    render(<DurationSelect value={15} />)
    fireEvent.click(screen.getByRole('button', { name: '时长 · 15 分钟' }))

    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '5 分钟',
      '10 分钟',
      '15 分钟',
      '20 分钟',
      '25 分钟',
      '30 分钟',
    ])
  })
})
