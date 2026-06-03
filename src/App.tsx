import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import DocumentsPage from './pages/DocumentsPage'
import CreditsPage from './pages/CreditsPage'
import PrintHistoryPage from './pages/PrintHistoryPage'
import ProfilePage from './pages/ProfilePage'
import NotificationsPage from './pages/NotificationsPage'
import OnboardingModal from './components/OnboardingModal'
import CookieConsent from './components/CookieConsent'
import { useState, useEffect, useCallback } from 'react'

const COOKIE_KEY = 'pf-cookie-consent'
const TUTORIAL_SEEN_KEY = 'pf-tutorial-seen'
const NEW_REG_KEY = 'pf-new-reg'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { user, isLoading } = useAuth()
  const [cookieConsent, setCookieConsent] = useState<'accepted' | 'rejected' | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)

  useEffect(() => {
    let saved: 'accepted' | 'rejected' | null = null
    try { saved = localStorage.getItem(COOKIE_KEY) as 'accepted' | 'rejected' | null } catch {}
    setCookieConsent(saved)

    if (!user) return

    let isNewReg = false
    try { isNewReg = localStorage.getItem(NEW_REG_KEY) === 'true' } catch {}
    if (isNewReg) {
      try { localStorage.removeItem(NEW_REG_KEY) } catch {}
      setShowTutorial(true)
      return
    }

    if (saved === 'accepted') {
      let seen = false
      try { seen = !!localStorage.getItem(TUTORIAL_SEEN_KEY) } catch {}
      if (!seen) {
        setShowTutorial(true)
      }
    } else {
      setShowTutorial(true)
    }
  }, [user])

  const handleCookieAccept = useCallback(() => {
    try { localStorage.setItem(COOKIE_KEY, 'accepted') } catch {}
    setCookieConsent('accepted')
  }, [])

  const handleCookieReject = useCallback(() => {
    try { localStorage.setItem(COOKIE_KEY, 'rejected') } catch {}
    setCookieConsent('rejected')
  }, [])

  const handleTutorialComplete = useCallback(() => {
    let accepted = false
    try { accepted = localStorage.getItem(COOKIE_KEY) === 'accepted' } catch {}
    if (accepted) {
      try { localStorage.setItem(TUTORIAL_SEEN_KEY, 'true') } catch {}
    }
    setShowTutorial(false)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Carregando...</p>
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
            element={user ? <Navigate to="/home" replace /> : <LoginPage />}
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
          <Route path="*" element={<Navigate to={user ? '/home' : '/login'} replace />} />
        </Routes>
      </AnimatePresence>

      {/* Cookie consent pops on top of everything when undecided */}
      {cookieConsent === null && user && (
        <CookieConsent
          onAccept={handleCookieAccept}
          onReject={handleCookieReject}
        />
      )}

      {user && showTutorial && (
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
