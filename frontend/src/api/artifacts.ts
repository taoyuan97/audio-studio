import { apiFetch } from './client'
import type {
  Artifact,
  ArtifactsResponse,
  DeleteArtifactResponse,
  PeaksResponse,
  ScriptDraft,
  ScriptVersionsResponse,
  UpdateArtifactRequest,
} from './types'

export function listArtifacts(params: { type?: string; limit?: number } = {}) {
  return apiFetch<ArtifactsResponse>('/api/artifacts', { params })
}

export function getArtifact(id: string, signal?: AbortSignal) {
  return apiFetch<Artifact>(`/api/artifacts/${id}`, { signal })
}

export function updateArtifact(id: string, payload: UpdateArtifactRequest) {
  return apiFetch<Artifact>(`/api/artifacts/${id}`, { method: 'PATCH', body: payload })
}

export function deleteArtifact(id: string) {
  return apiFetch<DeleteArtifactResponse>(`/api/artifacts/${id}`, { method: 'DELETE' })
}

export function getPeaks(id: string, signal?: AbortSignal) {
  return apiFetch<PeaksResponse>(`/api/artifacts/${id}/peaks`, { signal })
}

export function listArtifactVersions(id: string) {
  return apiFetch<ScriptVersionsResponse>(`/api/artifacts/${id}/versions`)
}

export function restoreArtifactVersion(id: string, versionId: string, expectedRevision: number) {
  return apiFetch<ScriptDraft>(`/api/artifacts/${id}/versions/${versionId}/restore-draft`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
  })
}

/** 音频文件流地址（audio/mpeg 或 audio/wav，支持 Range） */
export function artifactAudioUrl(id: string): string {
  return `/api/artifacts/${id}/audio`
}
