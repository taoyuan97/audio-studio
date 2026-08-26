import { useMemo } from 'react'
import type { ScriptContent, ScriptSegment } from '../../../api/types'
import { formatEstDuration } from './format'

/**
 * 脚本结果区：标记徽章结构化渲染（segments 来自后端解析，唯一事实源）
 * + 时间轴条（语音/停顿分段着色 + est_duration）。
 *
 * 时间轴宽度为展示层估算（音节数 × 0.33s ÷ 语速系数），非解析逻辑——
 * 权威时长以 content.est_duration 为准。
 */

/** 展示层语速系数（与后端 markers.py 常数对齐，仅用于时间轴比例） */
const SPEED_DISPLAY_FACTORS: Record<string, number> = {
  慢速: 0.72,
  正常: 1.0,
  快速: 1.28,
}
const SYLLABLE_SECONDS = 0.33

function segmentWeight(segment: ScriptSegment): number {
  if (segment.kind === 'pause') return segment.seconds
  const chars = segment.text.replace(/\s/g, '').length
  const factor = SPEED_DISPLAY_FACTORS[segment.speed ?? ''] ?? 1
  return (chars * SYLLABLE_SECONDS) / factor
}

function segmentTooltip(segment: ScriptSegment): string {
  if (segment.kind === 'pause') return `停顿 ${segment.seconds}s`
  const labels = [segment.emotion ? `情绪：${segment.emotion}` : null, segment.speed ? `语速：${segment.speed}` : null]
  const meta = labels.filter(Boolean).join(' · ')
  const preview = segment.text.length > 16 ? `${segment.text.slice(0, 16)}…` : segment.text
  return meta ? `${preview}（${meta}）` : preview
}

function countScriptChars(content: ScriptContent): number {
  return content.segments.reduce(
    (sum, seg) => sum + (seg.kind === 'speech' ? seg.text.replace(/\s/g, '').length : 0),
    0,
  )
}

interface ScriptViewProps {
  content: ScriptContent
}

export default function ScriptView({ content }: ScriptViewProps) {
  const weights = useMemo(() => content.segments.map(segmentWeight), [content.segments])
  const totalWeight = useMemo(() => weights.reduce((a, b) => a + b, 0), [weights])

  const wordCount = useMemo(() => countScriptChars(content), [content])

  return (
    <div className="script-result">
      <div className="param-chips">
        <span className="param-chip">预估口播：约 {formatEstDuration(content.est_duration)}</span>
        <span className="param-chip">正文：{wordCount} 字</span>
      </div>

      <div className="timeline-wrap">
        <div className="timeline-bar" role="img" aria-label="脚本时间轴">
          {content.segments.map((segment, index) =>
            totalWeight > 0 ? (
              <div
                key={index}
                className={`tl-seg ${segment.kind === 'speech' ? 'tl-speech' : 'tl-pause'}`}
                style={{ width: `${((weights[index] / totalWeight) * 100).toFixed(2)}%` }}
                title={segmentTooltip(segment)}
              />
            ) : null,
          )}
        </div>
        <div className="timeline-legend">
          <span>
            <i className="tl-dot tl-speech" aria-hidden />
            语音段
          </span>
          <span>
            <i className="tl-dot tl-pause" aria-hidden />
            停顿
          </span>
          <span className="tl-total">{formatEstDuration(content.est_duration)}</span>
        </div>
      </div>

      <div className="script-view" data-testid="script-view">
        {content.segments.map((segment, index) =>
          segment.kind === 'speech' ? (
            <span key={index} className="sv-speech">
              {segment.emotion && <span className="marker-badge mb-emotion">情绪·{segment.emotion}</span>}
              {segment.speed && <span className="marker-badge mb-speed">语速·{segment.speed}</span>}
              {segment.text}
            </span>
          ) : (
            <span key={index} className="sv-pause" title={`停顿 ${segment.seconds} 秒`}>
              停顿 {segment.seconds}s
            </span>
          ),
        )}
      </div>
    </div>
  )
}
