import { App as AntdApp } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ScriptConfig } from '../../api/types'
import ScriptEditor, { type SelectionRange } from './ScriptEditor'

const config: ScriptConfig = {
  revision: 1,
  emotion_tags: [{ name: 'asmr', label: '轻柔耳语', enabled: true }],
  vocal_tags: [{ name: 'sighing', label: '叹息', enabled: true }],
  pause_presets: [1, 5],
  defaults: { emotion_tags: [], vocal_tags: [], pause_presets: [] },
}

function Harness({ onSave = vi.fn() }: { onSave?: () => void }) {
  const [value, setValue] = useState('前后')
  const [selection, setSelection] = useState<SelectionRange>({ start: 1, end: 1 })
  return <AntdApp><ScriptEditor value={value} dirty saving={false} saveFailed={false} config={config} selection={selection} onSelectionChange={setSelection} onChange={setValue} onSave={onSave} onFinish={vi.fn()} onDiscard={vi.fn()} onOpenSettings={vi.fn()} /></AntdApp>
}

describe('ScriptEditor', () => {
  afterEach(() => { cleanup(); localStorage.clear() })

  it('inserts a configured emotion at the saved caret and remembers it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    textarea.setSelectionRange(1, 1)
    fireEvent.select(textarea)
    await user.click(screen.getByRole('button', { name: /情绪/ }))
    await user.click(await screen.findByRole('button', { name: /轻柔耳语/ }))
    expect(textarea).toHaveValue('前[emotion:asmr]后')
    expect(localStorage.getItem('audio-studio:recent-script-emotions:v1')).toContain('asmr')
  })

  it('does not save while typing and only saves after the button is clicked', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    await user.type(screen.getByRole('textbox'), '新')
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
