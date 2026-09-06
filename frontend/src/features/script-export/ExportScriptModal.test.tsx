import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntApp } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScriptVersion } from '../../api/types'

const exportScriptFileMock = vi.fn()

vi.mock('./exportFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exportFile')>()
  return {
    ...actual,
    exportScriptFile: (...args: unknown[]) => exportScriptFileMock(...args),
  }
})

import ExportScriptModal from './ExportScriptModal'

const VERSION: ScriptVersion = {
  id: 'ver-2',
  artifact_id: 'art-1',
  version_no: 2,
  source_run_id: 'run-1',
  params: {},
  content: {
    text: '[emotion:asmr]\n慢慢呼吸\n[停顿 5s]',
    segments: [{ kind: 'speech', text: '错误的反向拼接内容', emotion: null, speed: null }],
    est_duration: 30,
  },
  created_at: 1,
}

function Harness() {
  const [open, setOpen] = useState(true)
  const [renderCount, setRenderCount] = useState(0)
  return (
    <AntApp>
      <button onClick={() => setRenderCount((value) => value + 1)}>父组件重渲染 {renderCount}</button>
      <button onClick={() => setOpen(true)}>重新打开</button>
      <ExportScriptModal
        open={open}
        artifactName="睡前放松冥想"
        version={VERSION}
        onCancel={() => setOpen(false)}
        onExported={() => setOpen(false)}
      />
    </AntApp>
  )
}

function exportButton(): HTMLButtonElement {
  return screen.getByText('导 出').closest('button') as HTMLButtonElement
}

describe('ExportScriptModal', () => {
  beforeEach(() => {
    exportScriptFileMock.mockReset()
    exportScriptFileMock.mockResolvedValue('saved')
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('默认标题和格式正确，父组件重渲染不覆盖用户输入', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByRole('textbox', { name: '文件标题' })
    expect((input as HTMLInputElement).value).toMatch(/^睡前放松冥想-v2-\d{4}-\d{4}$/)
    expect(screen.getByRole('radio', { name: 'Markdown 文档（.md）' })).toBeChecked()
    await user.clear(input)
    await user.type(input, '我的导出')
    await user.click(screen.getByRole('button', { name: /父组件重渲染/ }))
    expect(input).toHaveValue('我的导出')
  })

  it('切换 TXT 后直接使用冻结版本的 content.text 导出并成功关闭', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'TXT 文本（.txt）' }))
    await user.click(exportButton())

    await waitFor(() => expect(exportScriptFileMock).toHaveBeenCalledOnce())
    expect(exportScriptFileMock.mock.calls[0][0]).toMatchObject({
      title: expect.stringMatching(/^睡前放松冥想-v2-\d{4}-\d{4}$/),
      scriptText: VERSION.content.text,
      format: 'txt',
    })
  })

  it('系统保存取消和导出异常均保留弹窗及输入', async () => {
    const user = userEvent.setup()
    exportScriptFileMock.mockResolvedValueOnce('cancelled').mockRejectedValueOnce(new Error('磁盘不可写'))
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: '文件标题' })
    await user.clear(input)
    await user.type(input, '保留标题')

    await user.click(exportButton())
    await waitFor(() => expect(exportScriptFileMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: '导出文件' })).toBeInTheDocument()
    expect(input).toHaveValue('保留标题')

    await waitFor(() => expect(exportButton()).not.toBeDisabled())
    await user.click(exportButton())
    expect(await screen.findByText('导出失败：磁盘不可写')).toBeInTheDocument()
    expect(input).toHaveValue('保留标题')
  })

  it('空标题在字段附近显示错误且不执行导出', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.clear(screen.getByRole('textbox', { name: '文件标题' }))
    await user.click(exportButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入文件标题')
    expect(exportScriptFileMock).not.toHaveBeenCalled()
  })

  it('每次重新打开时重新生成标题并恢复 Markdown', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'TXT 文本（.txt）' }))
    await user.click(screen.getByRole('button', { name: /^取\s*消$/ }))
    await user.click(screen.getByRole('button', { name: '重新打开' }))

    expect((screen.getByRole('textbox', { name: '文件标题' }) as HTMLInputElement).value).toMatch(
      /^睡前放松冥想-v2-\d{4}-\d{4}$/,
    )
    expect(screen.getByRole('radio', { name: 'Markdown 文档（.md）' })).toBeChecked()
  })
})
