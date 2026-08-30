import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import FocusLayout from './layouts/FocusLayout'
import DashboardPage from './pages/DashboardPage'
import BgmPage from './pages/BgmPage'
import LibraryPage from './pages/LibraryPage'
import MeditationListPage from './pages/MeditationListPage'
import MeditationWorkspacePage from './pages/MeditationWorkspacePage'
import MixdownPage from './pages/MixdownPage'
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
  )
}
