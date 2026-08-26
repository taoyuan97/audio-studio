import { create } from 'zustand'
import type { RunKind, RunStatusValue } from '../api/types'

export interface ActiveRunEntry {
  runId: string
  kind: RunKind
  status: RunStatusValue
  conversationId?: string | null
}

interface RunState {
  /** 全局活动 run 注册表（key = runId），各页面接入后由 runStore 汇总展示 */
  activeRuns: Record<string, ActiveRunEntry>
  registerRun: (entry: ActiveRunEntry) => void
  updateRunStatus: (runId: string, status: RunStatusValue) => void
  unregisterRun: (runId: string) => void
}

export const useRunStore = create<RunState>((set) => ({
  activeRuns: {},
  registerRun: (entry) =>
    set((state) => ({ activeRuns: { ...state.activeRuns, [entry.runId]: entry } })),
  updateRunStatus: (runId, status) =>
    set((state) => {
      const entry = state.activeRuns[runId]
      if (!entry) return state
      return { activeRuns: { ...state.activeRuns, [runId]: { ...entry, status } } }
    }),
  unregisterRun: (runId) =>
    set((state) => {
      if (!(runId in state.activeRuns)) return state
      const next = { ...state.activeRuns }
      delete next[runId]
      return { activeRuns: next }
    }),
}))
