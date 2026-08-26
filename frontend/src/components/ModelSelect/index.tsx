import { Select } from 'antd'
import type { LlmModelInfo } from '../../api/types'

interface ModelSelectProps {
  models: LlmModelInfo[]
  value?: string
  onChange?: (model: string) => void
  loading?: boolean
  disabled?: boolean
}

/** 模型选择（可用 LLM 列表来自 GET /api/conversations/{id}/models，仅含已配置 Key 的模型） */
export default function ModelSelect({ models, value, onChange, loading, disabled }: ModelSelectProps) {
  return (
    <Select
      value={value}
      onChange={onChange}
      loading={loading}
      disabled={disabled}
      placeholder={models.length === 0 ? '无可用模型' : '选择模型'}
      style={{ minWidth: 180 }}
      options={models.map((model) => ({
        value: model.model,
        label: model.name,
        title: model.name,
      }))}
    />
  )
}
