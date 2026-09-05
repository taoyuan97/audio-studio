/**
 * API 契约 TS 类型（单一事实源）。
 * 锚定 docs/tech/api-contract.md；由 backend/tests/test_frontend_contract.py 逐端点锁定。
 */

// ---------- 通用 ----------

export type RunKind = 'script' | 'tts' | 'music' | 'mixdown'

export type RunStatusValue = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ApiErrorBody {
  code: string
  message: string
}

/** 各线长任务提交统一 202 返回的 run 载荷 */
export interface RunPayload {
  run_id: string
  kind: RunKind
  status: RunStatusValue
  events_url: string
}

export interface RunProgress {
  completed: number
  total: number
  stage: string
}

/** GET /api/runs/{run_id} */
export interface RunStatusResponse {
  run_id: string
  kind: RunKind
  status: RunStatusValue
  conversation_id: string | null
  queue_position: number
  progress: RunProgress | null
  artifact_id: string | null
  error: ApiErrorBody | null
  music_retry: MusicRetryInfo | null
}

export interface MusicRetryInfo {
  download_available: boolean
  expires_at: number | null
}

export interface CancelRunResponse {
  run_id: string
  status: 'cancelled'
}

export interface HealthResponse {
  status: string
  version: string
}

export interface StatsRecentArtifact {
  id: string
  type: ArtifactType
  name: string
  created_at: number
}

export interface StatsActiveRun {
  run_id: string
  kind: RunKind
  status: RunStatusValue
}

/** GET /api/stats */
export interface StatsResponse {
  artifact_counts: Partial<Record<ArtifactType, number>>
  conversation_count: number
  recent_artifacts: StatsRecentArtifact[]
  active_runs: StatsActiveRun[]
}

// ---------- 会话 / 消息（剧本线）----------

export type Scene = 'meditation' | 'podcast'

export type ScriptDuration = 5 | 10 | 15 | 20 | 25 | 30

export interface Conversation {
  id: string
  scene: Scene
  title: string
  created_at: number
  updated_at: number
}

export interface MessageParams {
  duration: ScriptDuration
  model: string
}

export interface MessageAttachment {
  id: string
  name: string
  size: number
  media_type: 'text/markdown' | 'text/plain'
}

export interface SendMessageAttachment {
  name: string
  content: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  params: MessageParams | null
  attachments: MessageAttachment[]
  created_at: number
}

export interface MessagesResponse {
  items: Message[]
  has_more: boolean
}

/** GET /api/conversations/{id} 聚合响应 */
export interface ConversationDetail {
  conversation: Conversation
  script_draft: ScriptDraft | null
  script_artifact: Artifact | null
  has_unsaved_changes: boolean
  active_run_id: string | null
}

export interface LlmModelInfo {
  provider: string
  model: string
  name: string
}

export interface LlmModelsResponse {
  models: LlmModelInfo[]
}

export interface SendMessageRequest {
  text: string
  duration: ScriptDuration
  model: string
  allow_draft_overwrite?: boolean
  attachments?: SendMessageAttachment[]
}

export interface CreateConversationRequest {
  scene: Scene
  title?: string
}

// ---------- 产物 ----------

export type ArtifactType = 'script_meditation' | 'voice' | 'bgm' | 'mix'

export type AudioFormat = 'mp3' | 'wav'

/** 剧本 segments 元素（后端解析，唯一事实源） */
export type ScriptSegment =
  | { kind: 'speech'; text: string; emotion: string | null; speed: string | null }
  | { kind: 'pause'; seconds: number }

export interface ScriptContent {
  text: string
  segments: ScriptSegment[]
  est_duration: number
}

export interface ArtifactAudioMeta {
  format: AudioFormat
  duration: number
  url: string
  peaks_url: string
}

export interface Artifact {
  id: string
  type: ArtifactType
  name: string
  conversation_id: string | null
  source_run_id: string | null
  params: Record<string, unknown> | null
  content: ScriptContent | null
  audio: ArtifactAudioMeta | null
  created_at: number
  updated_at: number
  current_version_id: string | null
  current_version_no: number | null
}

export type ScriptDraftOrigin = 'generated' | 'manual' | 'restored'

export interface ScriptDraft {
  conversation_id: string
  source_run_id: string | null
  params: Record<string, unknown>
  content: ScriptContent
  origin: ScriptDraftOrigin
  revision: number
  updated_at: number
}

export interface ScriptVersion {
  id: string
  artifact_id: string
  version_no: number
  source_run_id: string | null
  params: Record<string, unknown>
  content: ScriptContent
  created_at: number
}

export interface ScriptVersionsResponse {
  items: ScriptVersion[]
}

export interface SaveScriptVersionResponse {
  artifact: Artifact
  version: ScriptVersion
}

export interface ArtifactsResponse {
  items: Artifact[]
}

export interface UpdateArtifactRequest {
  name?: string
}

export interface DeleteArtifactResponse {
  deleted: boolean
}

/** GET /api/artifacts/{id}/peaks */
export interface PeaksResponse {
  peaks: number[]
  duration: number
  buckets: number
}

// ---------- TTS 线 ----------

export interface TtsVoice {
  id: string
  name: string
  tags: string[]
  recommended_scene: string
}

export interface TtsEngine {
  id: string
  name: string
  model: string
  supports_ssml: boolean
  supports_instruction: boolean
  max_ssml_pause_ms: number
  supports_pitch: boolean
  voices: TtsVoice[]
}

export interface TtsScenePreset {
  speed: number
  recommended_voice_ids: string[]
  note: string
}

/** GET /api/tts/defaults */
export interface TtsDefaults {
  engines: TtsEngine[]
  scene_presets: Record<string, TtsScenePreset>
}

export interface SubmitTtsJobRequest {
  script_artifact_id?: string | null
  text?: string | null
  scene: Scene
  engine: string
  voice_id: string
  speed: number
  pitch?: number | null
  format: AudioFormat
}

// ---------- BGM 线 ----------

export interface MusicPromptSuggestion {
  id: string
  label: string
  prompt: string
}

export interface MusicCapabilities {
  instrumental: boolean
  prompt_max_length: number
  native_duration: boolean
  structure_control: 'prompt_hint' | 'native'
  remote_url: boolean
}

/** GET /api/music/defaults */
export interface MusicDefaults {
  provider: string
  model: string
  capabilities: MusicCapabilities
  prompt_suggestions: MusicPromptSuggestion[]
  structure_hints: string[]
  duration_range: { min: number; max: number }
}

export interface SubmitMusicJobRequest {
  prompt: string
  target_duration: number
  structure_hints?: string[]
  format: AudioFormat
}

export interface RetryMusicJobRequest {
  mode: 'download' | 'regenerate'
  confirm_regenerate?: boolean | null
}

// ---------- 混音线 ----------

export interface SubmitMixdownJobRequest {
  voice_artifact_id?: string | null
  bgm_artifact_id?: string | null
  voice_gain?: number
  bgm_gain?: number
  bgm_offset?: number
  ducking?: boolean
  format?: AudioFormat
}

// ---------- 设置线 ----------

export type SettingsProviderId =
  | 'llm_deepseek'
  | 'llm_qwen'
  | 'llm_moonshot'
  | 'tts_aliyun'
  | 'tts_volc'
  | 'minimax'

export interface ProviderStatus {
  configured: boolean
  credential_masked: string | null
  credential_source: 'runtime' | 'env' | 'mixed' | null
  editable: boolean
  runtime_credential_fields: Array<'credential' | 'app_id' | 'access_token'>
  model_id?: string
}

/** GET /api/settings/status */
export interface SettingsStatus {
  revision: number
  providers: Record<SettingsProviderId, ProviderStatus>
  runtime: {
    llm_timeout_seconds: number
    minimax_timeout_seconds: number
  }
  ffmpeg: {
    available: boolean
    version: string | null
    ffprobe_available: boolean
  }
  fake_mode: boolean
}

export interface ProviderUpdateResponse {
  revision: number
  provider: ProviderStatus
}

export interface CredentialRevealResponse {
  revision: number
  field: 'credential' | 'app_id' | 'access_token'
  value: string
}

export interface RuntimeUpdateResponse {
  revision: number
  runtime: SettingsStatus['runtime']
}

/** POST /api/settings/probe/{provider} */
export interface ProbeResult {
  ok: boolean
  latency_ms: number
  message: string
}

// ---------- SSE 事件载荷（契约第 11 节，锁定项）----------

export interface RunStatusEvent {
  status: RunStatusValue
  queue_position: number
  progress: RunProgress | null
  artifact_id?: string | null
  error?: ApiErrorBody | null
}

export interface AssistantDeltaEvent {
  delta: string
}

export interface MessageCompletedEvent {
  message: Pick<Message, 'id' | 'role' | 'content' | 'created_at'>
}

export interface ScriptDraftUpdatedEvent {
  draft: ScriptDraft
}

export type TtsStage = 'synthesizing' | 'assembling' | 'encoding'

export interface TtsProgressEvent {
  segment?: number
  total_segments?: number
  stage: TtsStage
}

export interface MusicProgressEvent {
  phase: 'generating' | 'downloading' | 'processing'
  waited_s?: number
}

export interface MixProgressEvent {
  phase: 'prep' | 'ducking' | 'encode'
}

export interface RunCompletedEvent {
  artifact_id: string | null
}

export type RunFailedEvent = ApiErrorBody
