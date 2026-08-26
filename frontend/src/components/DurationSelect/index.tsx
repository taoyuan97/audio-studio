import { Popover } from 'antd'
import { useState } from 'react'
import type { ScriptDuration } from '../../api/types'

export type DurationValue = ScriptDuration

const DURATIONS: DurationValue[] = [5, 10, 15, 20, 25, 30]

interface DurationSelectProps {
  value?: DurationValue
  onChange?: (value: DurationValue) => void
  disabled?: boolean
}

/** 时长档位气泡选择（5/10/15/20/25/30 分钟） */
export default function DurationSelect({ value = 15, onChange, disabled }: DurationSelectProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      content={
        <div className="duration-options" role="listbox" aria-label="时长档位">
          {DURATIONS.map((duration) => (
            <button
              key={duration}
              type="button"
              role="option"
              aria-selected={duration === value}
              className={duration === value ? 'duration-option active' : 'duration-option'}
              onClick={() => {
                onChange?.(duration)
                setOpen(false)
              }}
            >
              {duration} 分钟
            </button>
          ))}
        </div>
      }
    >
      <button type="button" className="duration-trigger" disabled={disabled}>
        时长 · {value} 分钟
      </button>
    </Popover>
  )
}
