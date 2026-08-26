import { create } from 'zustand'

export type BannerType = 'success' | 'info' | 'warning' | 'error'

export interface BannerMessage {
  id: number
  type: BannerType
  content: string
}

interface UiState {
  banners: BannerMessage[]
  pushBanner: (type: BannerType, content: string) => void
  dismissBanner: (id: number) => void
}

let nextBannerId = 1

/** 全局 UI 态：横幅消息队列（StatusBanner 渲染） */
export const useUiStore = create<UiState>((set) => ({
  banners: [],
  pushBanner: (type, content) =>
    set((state) => ({ banners: [...state.banners, { id: nextBannerId++, type, content }] })),
  dismissBanner: (id) =>
    set((state) => ({ banners: state.banners.filter((banner) => banner.id !== id) })),
}))
