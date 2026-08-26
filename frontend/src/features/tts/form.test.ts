import { describe, expect, it } from 'vitest'
import type { Artifact, Conversation, TtsEngine, TtsScenePreset } from '../../api/types'
import { buildScriptSourceOptions, pickVoiceId } from './form'

const engine: TtsEngine = {
  id: 'aliyun', name: '阿里云', model: 'qwen-audio-3.0-tts-plus',
  supports_ssml: true, supports_instruction: true, max_ssml_pause_ms: 10000, supports_pitch: true,
  voices: [
    { id: 'first', name: '首选', tags: [], recommended_scene: 'podcast' },
    { id: 'meditation', name: '冥想', tags: [], recommended_scene: 'meditation' },
  ],
}

describe('TTS 表单联动', () => {
  it('场景切换优先选择当前引擎的推荐音色', () => {
    const preset: TtsScenePreset = { speed: 0.8, recommended_voice_ids: ['meditation'], note: '' }
    expect(pickVoiceId(engine, preset)).toBe('meditation')
  })

  it('推荐音色不属于当前引擎时回退首个音色', () => {
    const preset: TtsScenePreset = { speed: 1, recommended_voice_ids: ['other-engine'], note: '' }
    expect(pickVoiceId(engine, preset)).toBe('first')
  })
})

function scriptArtifact(
  id: string,
  conversationId: string | null,
  version: number,
): Artifact {
  return {
    id,
    type: 'script_meditation',
    name: '未命名冥想·脚本',
    conversation_id: conversationId,
    source_run_id: null,
    params: {},
    content: null,
    audio: null,
    created_at: 1,
    updated_at: 2,
    current_version_id: `version_${version}`,
    current_version_no: version,
  }
}

const conversations: Conversation[] = [
  { id: 'conflict', title: '应对亲密关系冲突', scene: 'meditation', created_at: 1, updated_at: 2 },
  { id: 'work', title: '缓解工作压力', scene: 'meditation', created_at: 1, updated_at: 2 },
]

describe('TTS 脚本来源标签', () => {
  it('同名产物按当前会话标题区分并保留版本信息', () => {
    const options = buildScriptSourceOptions(
      [scriptArtifact('art_conflict', 'conflict', 3), scriptArtifact('art_work', 'work', 1)],
      conversations,
    )
    expect(options.map((item) => item.primary)).toEqual(['应对亲密关系冲突', '缓解工作压力'])
    expect(options[0].secondary).toBe('未命名冥想·脚本 · v3')
    expect(options[1].searchText).toContain('缓解工作压力')
  })

  it('会话缺失或已解除关联时回退产物名称', () => {
    const options = buildScriptSourceOptions(
      [scriptArtifact('orphan', null, 1), scriptArtifact('missing', 'deleted', 2)],
      conversations,
    )
    expect(options.map((item) => item.primary)).toEqual(['未命名冥想·脚本', '未命名冥想·脚本'])
  })
})
