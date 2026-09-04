import { describe, expect, it } from 'vitest'
import type { Artifact } from '../../api/types'
import { mixRuleText } from './rules'

function track(type: 'voice' | 'bgm', duration: number): Artifact {
  return {
    id: `art_${type}`,
    type,
    name: type,
    conversation_id: null,
    source_run_id: null,
    params: {},
    content: null,
    audio: { format: 'wav', duration, url: '/audio', peaks_url: '/peaks' },
    created_at: 1,
    updated_at: 1,
    current_version_id: null,
    current_version_no: null,
  }
}

describe('mixRuleText', () => {
  it('describes all track combinations and duration branches', () => {
    const voice = track('voice', 60)
    expect(mixRuleText(null, null)).toContain('至少')
    expect(mixRuleText(voice, null)).toContain('仅人声')
    expect(mixRuleText(null, track('bgm', 20))).toContain('仅背景')
    expect(mixRuleText(voice, track('bgm', 20))).toContain('循环填充')
    expect(mixRuleText(voice, track('bgm', 80))).toContain('截断')
    expect(mixRuleText(voice, track('bgm', 60))).toContain('等长')
  })
})
