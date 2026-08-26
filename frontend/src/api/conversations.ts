import { apiFetch } from './client'
import type {
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  LlmModelsResponse,
  MessagesResponse,
  RunPayload,
  SendMessageRequest,
} from './types'

export function createConversation(payload: CreateConversationRequest) {
  return apiFetch<Conversation>('/api/conversations', { method: 'POST', body: payload })
}

export function listConversations(params: { scene?: string; limit?: number } = {}) {
  return apiFetch<{ items: Conversation[] }>('/api/conversations', { params })
}

export function getConversation(id: string) {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`)
}

export function renameConversation(id: string, title: string) {
  return apiFetch<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: { title } })
}

export function listMessages(id: string, params: { before?: string; limit?: number } = {}) {
  return apiFetch<MessagesResponse>(`/api/conversations/${id}/messages`, { params })
}

export function sendMessage(id: string, payload: SendMessageRequest) {
  return apiFetch<RunPayload>(`/api/conversations/${id}/messages`, { method: 'POST', body: payload })
}

export function retryMessage(conversationId: string, messageId: string) {
  return apiFetch<RunPayload>(`/api/conversations/${conversationId}/messages/${messageId}/retry`, {
    method: 'POST',
  })
}

export function listConversationModels(id: string) {
  return apiFetch<LlmModelsResponse>(`/api/conversations/${id}/models`)
}
