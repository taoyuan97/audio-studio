import { apiFetch } from './client'
import type {
  HealthResponse,
  CredentialRevealResponse,
  ProbeResult,
  ProviderUpdateResponse,
  RuntimeUpdateResponse,
  ScriptConfig,
  ScriptTagConfig,
  SettingsProviderId,
  SettingsStatus,
  StatsResponse,
} from './types'

export function getHealth(signal?: AbortSignal) {
  return apiFetch<HealthResponse>('/api/health', { signal })
}

export function getStats(signal?: AbortSignal) {
  return apiFetch<StatsResponse>('/api/stats', { signal })
}

export function getSettingsStatus(signal?: AbortSignal) {
  return apiFetch<SettingsStatus>('/api/settings/status', { signal })
}

export function updateProvider(
  provider: SettingsProviderId,
  payload: {
    revision: number
    credential?: string
    model_id?: string
    app_id?: string
    access_token?: string
    thinking_enabled?: boolean
  },
) {
  return apiFetch<ProviderUpdateResponse>(`/api/settings/providers/${provider}`, { method: 'PATCH', body: payload })
}

export function clearProviderCredentials(provider: SettingsProviderId, revision: number) {
  return apiFetch<ProviderUpdateResponse>(`/api/settings/providers/${provider}/credentials`, {
    method: 'DELETE', body: { revision },
  })
}

export function revealProviderCredential(
  provider: SettingsProviderId,
  revision: number,
  field: 'credential' | 'app_id' | 'access_token',
) {
  return apiFetch<CredentialRevealResponse>(`/api/settings/providers/${provider}/credentials/reveal`, {
    method: 'POST', body: { revision, field },
  })
}

export function updateRuntime(payload: { revision: number; llm_timeout_seconds?: number; minimax_timeout_seconds?: number }) {
  return apiFetch<RuntimeUpdateResponse>('/api/settings/runtime', { method: 'PATCH', body: payload })
}

export function getScriptConfig(signal?: AbortSignal) {
  return apiFetch<ScriptConfig>('/api/settings/script-config', { signal })
}

export function updateScriptConfig(payload: {
  revision: number
  emotion_tags: ScriptTagConfig[]
  vocal_tags: ScriptTagConfig[]
  pause_presets: number[]
}) {
  return apiFetch<ScriptConfig>('/api/settings/script-config', { method: 'PATCH', body: payload })
}

export function probeProvider(provider: SettingsProviderId | 'ffmpeg') {
  return apiFetch<ProbeResult>(`/api/settings/probe/${provider}`, { method: 'POST' })
}
