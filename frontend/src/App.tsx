import { Navigate, Route, Routes } from 'react-router-dom'
import PagePlaceholder from './components/PagePlaceholder'
import AppLayout from './layouts/AppLayout'
import FocusLayout from './layouts/FocusLayout'
import DashboardPage from './pages/DashboardPage'
import LibraryPage from './pages/LibraryPage'
import MeditationListPage from './pages/MeditationListPage'
import MeditationWorkspacePage from './pages/MeditationWorkspacePage'
import SettingsPage from './pages/SettingsPage'
import TtsPage from './pages/TtsPage'

/** 路由表：tech-design 6.2；handoff 语义 = 路由 query 参数 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="meditation" element={<MeditationListPage />} />
        <Route path="tts" element={<TtsPage />} />
        <Route path="bgm" element={<PagePlaceholder title="BGM" description="BGM 功能当前阻塞，后续开放" />} />
        <Route path="mixdown" element={<PagePlaceholder title="混音" description="混音功能依赖 BGM，后续开放" />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route element={<FocusLayout />}>
        <Route path="meditation/:conversationId" element={<MeditationWorkspacePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
