// Rotas do site dos alunos. Páginas de aluno ficam dentro do Layout (menu lateral)
// e exigem login; /dev e /dev/creditos são só para a credencial de desenvolvedor.
// Também decide quando mostrar o aviso de cookies e o tutorial de boas-vindas.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import DocumentsPage from './pages/DocumentsPage'
import CreditsPage from './pages/CreditsPage'
import PrintHistoryPage from './pages/PrintHistoryPage'
import SimulatorPage from './pages/SimulatorPage'
import ProfilePage from './pages/ProfilePage'
import NotificationsPage from './pages/NotificationsPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DevDashboardPage from './pages/DevDashboardPage'
import DevCreditsPage from './pages/DevCreditsPage'
import OnboardingModal from './components/OnboardingModal'
import CookieConsent from './components/CookieConsent'
import { useState, useEffect, useCallback } from 'react'
import { prefs, setConsent, useConsent } from './consent'

const TUTORIAL_SEEN_KEY = 'pf-tutorial-seen'
const NEW_REG_KEY = 'pf-new-reg'

// Página de aluno: sem login vai para /login; o dev é mandado para o painel dele
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-200">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  // O desenvolvedor só vê o painel de métricas
  if (user.role === 'dev') return <Navigate to="/dev" replace />
  return <Layout>{children}</Layout>
}

// Painel de métricas: só para a credencial de dev (o servidor também confere)
function DevRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'dev') return <Navigate to="/home" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, isLoading } = useAuth()
  const cookieConsent = useConsent()
  const [showTutorial, setShowTutorial] = useState(false)

  // Mostra o tutorial logo após o cadastro ou para quem ainda não o viu
  useEffect(() => {
    if (!user || user.role === 'dev') return
    if (sessionStorage.getItem(NEW_REG_KEY) === 'true') {
      sessionStorage.removeItem(NEW_REG_KEY)
      setShowTutorial(true)
      return
    }
    // Sem consentimento, "já viu o tutorial" vale só até fechar o navegador
    if (!prefs.get(TUTORIAL_SEEN_KEY)) setShowTutorial(true)
  }, [user])

  const handleCookieAccept = useCallback(() => setConsent('accepted'), [])
  const handleCookieReject = useCallback(() => setConsent('rejected'), [])

  const handleTutorialComplete = useCallback(() => {
    prefs.set(TUTORIAL_SEEN_KEY, 'true')
    setShowTutorial(false)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-200">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <AnimatePresence mode="wait">
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to={user.role === 'dev' ? '/dev' : '/home'} replace /> : <LoginPage />}
          />
          <Route
            path="/reset-password"
            element={<ResetPasswordPage />}
          />
          <Route
            path="/home"
            element={<ProtectedRoute><HomePage /></ProtectedRoute>}
          />
          <Route
            path="/documents"
            element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>}
          />
          <Route
            path="/credits"
            element={<ProtectedRoute><CreditsPage /></ProtectedRoute>}
          />
          <Route
            path="/simulator"
            element={<ProtectedRoute><SimulatorPage /></ProtectedRoute>}
          />
          <Route
            path="/print-history"
            element={<ProtectedRoute><PrintHistoryPage /></ProtectedRoute>}
          />
          <Route
            path="/profile"
            element={<ProtectedRoute><ProfilePage /></ProtectedRoute>}
          />
          <Route
            path="/notifications"
            element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>}
          />
          <Route
            path="/dev"
            element={<DevRoute><DevDashboardPage /></DevRoute>}
          />
          <Route
            path="/dev/creditos"
            element={<DevRoute><DevCreditsPage /></DevRoute>}
          />
          <Route path="*" element={<Navigate to={user ? (user.role === 'dev' ? '/dev' : '/home') : '/login'} replace />} />
        </Routes>
      </AnimatePresence>

      {/* Aviso de cookies: bloqueia o site para qualquer visitante até a escolha
          (a sessão de dev nunca guarda nada permanente) */}
      {cookieConsent === null && user?.role !== 'dev' && (
        <CookieConsent
          onAccept={handleCookieAccept}
          onReject={handleCookieReject}
        />
      )}

      {user && user.role !== 'dev' && showTutorial && cookieConsent !== null && (
        <OnboardingModal onComplete={handleTutorialComplete} />
      )}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
