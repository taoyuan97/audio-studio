import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import FocusLayout from './layouts/FocusLayout'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const BgmPage = lazy(() => import('./pages/BgmPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const MeditationListPage = lazy(() => import('./pages/MeditationListPage'))
const MeditationWorkspacePage = lazy(() => import('./pages/MeditationWorkspacePage'))
const MixdownPage = lazy(() => import('./pages/MixdownPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const TtsPage = lazy(() => import('./pages/TtsPage'))

/** 路由表：tech-design 6.2；handoff 语义 = 路由 query 参数 */
export default function App() {
  return (
    <Suspense fallback={<div className="page-stack">页面加载中…</div>}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="meditation" element={<MeditationListPage />} />
          <Route path="tts" element={<TtsPage />} />
          <Route path="bgm" element={<BgmPage />} />
          <Route path="mixdown" element={<MixdownPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route element={<FocusLayout />}>
          <Route path="meditation/:conversationId" element={<MeditationWorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
