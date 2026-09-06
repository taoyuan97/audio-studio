import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Input, InputNumber, Popconfirm, Skeleton, Space, Switch, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { getScriptConfig, updateScriptConfig } from '../../api/settings'
import type { ScriptConfig, ScriptTagConfig } from '../../api/types'

type TagCategory = 'emotion_tags' | 'vocal_tags'

function cloneConfig(config: ScriptConfig) {
  return {
    emotion_tags: config.emotion_tags.map((item) => ({ ...item })),
    vocal_tags: config.vocal_tags.map((item) => ({ ...item })),
    pause_presets: [...config.pause_presets],
  }
}

function tagError(items: ScriptTagConfig[], label: string): string | null {
  if (items.length > 20) return `${label}最多 20 个`
  const names = new Set<string>()
  const labels = new Set<string>()
  for (const item of items) {
    const name = item.name.trim().toLowerCase().replace(/\s+/g, ' ')
    const display = item.label.trim()
    if (!/^[A-Za-z][A-Za-z0-9 -]{0,63}$/.test(name)) return `${label}英文名仅支持英文字母、数字、空格和连字符，最长 64 个字符`
    if (!display || display.length > 20 || display.includes('[') || display.includes(']') || [...display].some((character) => character.charCodeAt(0) < 32)) return `${label}中文显示名须为 1～20 个字符且不能包含方括号`
    if (names.has(name)) return `${label}英文名不能重复`
    if (labels.has(display)) return `${label}中文显示名不能重复`
    names.add(name)
    labels.add(display)
  }
  return null
}

function TagListCard({
  title,
  description,
  items,
  onChange,
}: {
  title: string
  description: string
  items: ScriptTagConfig[]
  onChange: (items: ScriptTagConfig[]) => void
}) {
  const update = (index: number, patch: Partial<ScriptTagConfig>) =>
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const move = (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  return (
    <Card title={title} extra={<Tag>{items.length} / 20</Tag>}>
      <p className="settings-script-description">{description}</p>
      <div className="settings-script-list">
        {items.map((item, index) => (
          <div className="settings-script-row" key={`${index}-${item.name}`}>
            <Input aria-label={`${title}英文名 ${index + 1}`} value={item.name} placeholder="英文模型标签，不含 []" onChange={(event) => update(index, { name: event.target.value })} />
            <Input aria-label={`${title}中文名 ${index + 1}`} value={item.label} placeholder="中文显示名" maxLength={20} onChange={(event) => update(index, { label: event.target.value })} />
            <Switch aria-label={`${title}启用 ${index + 1}`} checked={item.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(enabled) => update(index, { enabled })} />
            <Space.Compact>
              <Button aria-label={`上移${title} ${index + 1}`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
              <Button aria-label={`下移${title} ${index + 1}`} icon={<ArrowDownOutlined />} disabled={index === items.length - 1} onClick={() => move(index, 1)} />
              <Button danger aria-label={`删除${title} ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} />
            </Space.Compact>
          </div>
        ))}
      </div>
      <Button icon={<PlusOutlined />} disabled={items.length >= 20} onClick={() => onChange([...items, { name: '', label: '', enabled: true }])}>新增{title}</Button>
    </Card>
  )
}

export default function ScriptConfigSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['script-config'], queryFn: ({ signal }) => getScriptConfig(signal) })
  const [emotionTags, setEmotionTags] = useState<ScriptTagConfig[]>([])
  const [vocalTags, setVocalTags] = useState<ScriptTagConfig[]>([])
  const [pausePresets, setPausePresets] = useState<number[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!query.data || dirty) return
    const next = cloneConfig(query.data)
    setEmotionTags(next.emotion_tags)
    setVocalTags(next.vocal_tags)
    setPausePresets(next.pause_presets)
  }, [dirty, query.data])

  useEffect(() => {
    onDirtyChange?.(dirty)
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, onDirtyChange])

  const validationError = useMemo(() => {
    const emotionError = tagError(emotionTags, '情绪')
    if (emotionError) return emotionError
    const vocalError = tagError(vocalTags, '语气词')
    if (vocalError) return vocalError
    if (pausePresets.length > 20) return '停顿预设最多 20 个'
    if (pausePresets.some((value) => !Number.isInteger(value) || value < 1 || value > 300)) return '停顿预设必须是 1～300 的整数'
    if (new Set(pausePresets).size !== pausePresets.length) return '停顿预设不能重复'
    return null
  }, [emotionTags, pausePresets, vocalTags])

  const changeTags = (category: TagCategory, items: ScriptTagConfig[]) => {
    if (category === 'emotion_tags') setEmotionTags(items)
    else setVocalTags(items)
    setDirty(true)
  }
  const saveMutation = useMutation({
    mutationFn: () => updateScriptConfig({
      revision: query.data!.revision,
      emotion_tags: emotionTags,
      vocal_tags: vocalTags,
      pause_presets: pausePresets,
    }),
    onSuccess: (result) => {
      queryClient.setQueryData(['script-config'], result)
      queryClient.invalidateQueries({ queryKey: ['settings-status'] })
      setDirty(false)
      message.success('脚本配置已保存并生效')
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'SETTINGS_REVISION_CONFLICT') query.refetch()
      message.error(error instanceof ApiError ? error.message : '脚本配置保存失败')
    },
  })
  const restoreDefaults = () => {
    if (!query.data) return
    setEmotionTags(query.data.defaults.emotion_tags.map((item) => ({ ...item })))
    setVocalTags(query.data.defaults.vocal_tags.map((item) => ({ ...item })))
    setPausePresets([...query.data.defaults.pause_presets])
    setDirty(true)
  }

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (!query.data) return <Alert type="error" showIcon message="脚本配置加载失败" action={<Button onClick={() => query.refetch()}>重试</Button>} />

  return (
    <div className="settings-tab-stack settings-script-config">
      <Alert type="info" showIcon message="模型标签使用英文名，脚本界面使用中文显示名" description="新标签仅对支持文本内嵌标签的阿里云 Qwen-Audio 模型生效；其他引擎会忽略情绪和语气词，停顿仍正常生效。" />
      <TagListCard title="情绪" description="控制标签会持续作用于后续文本，直到出现下一个情绪标签。" items={emotionTags} onChange={(items) => changeTags('emotion_tags', items)} />
      <TagListCard title="语气词" description="富语言/拟声标签只在插入位置生效，不改变后续情绪。" items={vocalTags} onChange={(items) => changeTags('vocal_tags', items)} />
      <Card title="停顿预设" extra={<Tag>{pausePresets.length} / 20</Tag>}>
        <p className="settings-script-description">预设和编辑器自定义值均使用 1～300 秒整数；合成时生成本地静音。</p>
        <div className="settings-pause-list">
          {pausePresets.map((value, index) => (
            <Space.Compact key={`${index}-${value}`}>
              <InputNumber aria-label={`停顿预设 ${index + 1}`} min={1} max={300} precision={0} value={value} onChange={(next) => { setPausePresets(pausePresets.map((item, itemIndex) => itemIndex === index ? Number(next ?? 0) : item)); setDirty(true) }} />
              <span className="settings-input-unit">秒</span>
              <Button danger aria-label={`删除停顿 ${index + 1}`} icon={<DeleteOutlined />} onClick={() => { setPausePresets(pausePresets.filter((_, itemIndex) => itemIndex !== index)); setDirty(true) }} />
            </Space.Compact>
          ))}
        </div>
        <Button icon={<PlusOutlined />} disabled={pausePresets.length >= 20} onClick={() => { setPausePresets([...pausePresets, 1]); setDirty(true) }}>新增停顿</Button>
      </Card>
      {validationError && <Alert type="error" showIcon message={validationError} />}
      <div className="settings-script-actions">
        <Popconfirm title="恢复系统默认脚本配置？" description="恢复后仍需点击保存才会生效。" okText="恢复" cancelText="取消" onConfirm={restoreDefaults}>
          <Button icon={<UndoOutlined />}>恢复默认</Button>
        </Popconfirm>
        <Button aria-label="保存脚本配置" type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} disabled={!dirty || Boolean(validationError)} onClick={() => saveMutation.mutate()}>保存脚本配置</Button>
      </div>
    </div>
  )
}
