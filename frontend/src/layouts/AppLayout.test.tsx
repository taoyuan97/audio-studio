import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppLayout from './AppLayout'

describe('AppLayout', () => {
  it('separates the fixed sidebar from the scrollable page content', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="settings" element={<div>设置页内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(container.querySelector('.app-shell')).toBeInTheDocument()
    expect(container.querySelector('.app-sider')).toBeInTheDocument()
    expect(container.querySelector('.app-main')).toBeInTheDocument()
    expect(container.querySelector('.app-content')).toHaveTextContent('设置页内容')
  })
})
