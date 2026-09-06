import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Input, InputNumber, Popconfirm, Popover } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import type { ScriptConfig, ScriptTagConfig } from '../../api/types'
import { insertAtSelection, type SelectionRange } from './markerInsertion'
export type { SelectionRange } from './markerInsertion'

const RECENT_EMOTIONS_KEY = 'audio-studio:recent-script-emotions:v1'

function readRecentEmotions(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_EMOTIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

function TagButtons({ items, onSelect }: { items: ScriptTagConfig[]; onSelect: (item: ScriptTagConfig) => void }) {
  return (
    <div className="script-marker-options">
      {items.map((item) => <Button key={item.name} size="small" onClick={() => onSelect(item)}>{item.label}<small>{item.name}</small></Button>)}
    </div>
  )
}

export default function ScriptEditor({
  value,
  dirty,
  saving,
  saveFailed,
  config,
  selection,
  onSelectionChange,
  onChange,
  onSave,
  onFinish,
  onDiscard,
  onOpenSettings,
}: {
  value: string
  dirty: boolean
  saving: boolean
  saveFailed: boolean
  config?: ScriptConfig
  selection: SelectionRange
  onSelectionChange: (selection: SelectionRange) => void
  onChange: (value: string) => void
  onSave: () => void
  onFinish: () => void
  onDiscard: () => void
  onOpenSettings: () => void
}) {
  const { message } = App.useApp()
  const textAreaRef = useRef<TextAreaRef>(null)
  const [recentNames, setRecentNames] = useState(readRecentEmotions)
  const [pauseValue, setPauseValue] = useState<number | null>(null)
  const [openMarker, setOpenMarker] = useState<'emotion' | 'vocal' | 'pause' | null>(null)
  const emotions = useMemo(() => config?.emotion_tags.filter((item) => item.enabled) ?? [], [config])
  const vocals = useMemo(() => config?.vocal_tags.filter((item) => item.enabled) ?? [], [config])
  const recentEmotions = useMemo(() => {
    const byName = new Map(emotions.map((item) => [item.name, item]))
    return recentNames.map((name) => byName.get(name)).filter((item): item is ScriptTagConfig => Boolean(item))
  }, [emotions, recentNames])

  useEffect(() => {
    const valid = recentNames.filter((name) => emotions.some((item) => item.name === name)).slice(0, 10)
    if (valid.join('\0') === recentNames.join('\0')) return
    setRecentNames(valid)
    localStorage.setItem(RECENT_EMOTIONS_KEY, JSON.stringify(valid))
  }, [emotions, recentNames])

  useEffect(() => {
    if (saving) setOpenMarker(null)
  }, [saving])

  const nativeTextArea = () => textAreaRef.current?.resizableTextArea?.textArea
  const restoreSelection = (next: SelectionRange) => {
    window.requestAnimationFrame(() => {
      const textarea = nativeTextArea()
      textarea?.focus()
      textarea?.setSelectionRange(next.start, next.end)
    })
  }
  const insert = (marker: string) => {
    const result = insertAtSelection(value, selection, marker)
    if (result.text.length > 20_000) {
      message.warning('插入后将超过 20,000 字符限制')
      return false
    }
    onChange(result.text)
    onSelectionChange(result.selection)
    restoreSelection(result.selection)
    return true
  }
  const useEmotion = (item: ScriptTagConfig) => {
    if (!insert(`[emotion:${item.name}]`)) return
    const next = [item.name, ...recentNames.filter((name) => name !== item.name)].slice(0, 10)
    setRecentNames(next)
    localStorage.setItem(RECENT_EMOTIONS_KEY, JSON.stringify(next))
    setOpenMarker(null)
  }
  const useVocal = (item: ScriptTagConfig) => {
    if (insert(`[vocal:${item.name}]`)) setOpenMarker(null)
  }
  const insertPause = (seconds: number) => {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) return
    if (insert(`[停顿 ${seconds}s]`)) {
      setPauseValue(null)
      setOpenMarker(null)
    }
  }
  const empty = (label: string) => <div className="script-marker-empty">暂无启用的{label}<Button type="link" size="small" onClick={onOpenSettings}>前往设置</Button></div>

  const emotionPanel = (
    <div className="script-marker-panel">
      {recentEmotions.length > 0 && <><strong>最近使用</strong><TagButtons items={recentEmotions} onSelect={useEmotion} /></>}
      <strong>全部情绪</strong>
      {emotions.length > 0 ? <TagButtons items={emotions} onSelect={useEmotion} /> : empty('情绪')}
    </div>
  )
  const vocalPanel = <div className="script-marker-panel"><strong>语气词</strong>{vocals.length > 0 ? <TagButtons items={vocals} onSelect={useVocal} /> : empty('语气词')}</div>
  const pausePanel = (
    <div className="script-marker-panel">
      <strong>停顿时长</strong>
      <div className="script-marker-options pause-options">
        {(config?.pause_presets ?? []).map((seconds) => <Button key={seconds} size="small" onClick={() => insertPause(seconds)}>{seconds}s</Button>)}
      </div>
      <div className="custom-pause-row">
        <InputNumber aria-label="自定义停顿秒数" min={1} max={300} precision={0} value={pauseValue} placeholder="1–300 秒" onChange={setPauseValue} onPressEnter={() => { if (pauseValue !== null) insertPause(pauseValue) }} />
        <Button type="primary" disabled={!Number.isInteger(pauseValue) || pauseValue! < 1 || pauseValue! > 300} onClick={() => { if (pauseValue !== null) insertPause(pauseValue) }}>插入</Button>
      </div>
    </div>
  )

  return (
    <div className="script-editor">
      <Input.TextArea
        ref={textAreaRef}
        className="script-edit"
        value={value}
        disabled={saving}
        rows={14}
        maxLength={20_000}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => onSelectionChange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
        placeholder="编辑脚本文本，支持 [emotion:asmr] [vocal:sighing] [停顿 5s] [吸气] [呼气] [语速:慢速]"
      />
      <div className="script-marker-toolbar" aria-label="脚本标签工具栏">
        <Popover trigger="click" placement="topLeft" content={emotionPanel} open={openMarker === 'emotion'} onOpenChange={(open) => setOpenMarker(open ? 'emotion' : null)}><Button disabled={saving} icon={<PlusOutlined />}>情绪</Button></Popover>
        <Popover trigger="click" placement="topLeft" content={vocalPanel} open={openMarker === 'vocal'} onOpenChange={(open) => setOpenMarker(open ? 'vocal' : null)}><Button disabled={saving}>语气词</Button></Popover>
        <Popover trigger="click" placement="topLeft" content={pausePanel} open={openMarker === 'pause'} onOpenChange={(open) => setOpenMarker(open ? 'pause' : null)}><Button disabled={saving}>停顿</Button></Popover>
        <span className={`script-draft-status ${saveFailed ? 'error' : ''}`}>{saving ? '草稿保存中…' : saveFailed ? '草稿保存失败，本地内容已保留' : dirty ? '有未保存的本地修改' : '草稿已保存'}</span>
      </div>
      <div className="btn-row script-edit-actions">
        <Popconfirm title="放弃未保存修改？" description="将恢复到最近一次已保存的草稿。" okText="放弃修改" cancelText="继续编辑" disabled={!dirty} onConfirm={onDiscard}>
          <Button size="small" danger disabled={saving} onClick={() => { if (!dirty) onDiscard() }}>放弃修改</Button>
        </Popconfirm>
        <span style={{ flex: 1 }} />
        <Button size="small" disabled={!dirty || saving} onClick={onSave}>保存草稿</Button>
        <Button size="small" type="primary" disabled={!value.trim() || saving} onClick={onFinish}>完成编辑</Button>
      </div>
    </div>
  )
}
