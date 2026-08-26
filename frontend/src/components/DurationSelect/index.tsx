import { Popover } from 'antd'
import { useState } from 'react'

export type DurationValue = 5 | 15 | 30

const DURATIONS: DurationValue[] = [5, 15, 30]

interface DurationSelectProps {
  value?: DurationValue
  onChange?: (value: DurationValue) => void
  disabled?: boolean
}

/** 时长档位气泡选择（5/15/30 分钟，Popover 交互对齐原型） */
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
