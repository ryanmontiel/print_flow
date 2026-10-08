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
import ResetPasswordPage from './pages/ResetPasswordPage'
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
          <p className="text-sm text-gray-500 dark:text-gray-200">Carregando...</p>
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
    const saved = localStorage.getItem(COOKIE_KEY) as 'accepted' | 'rejected' | null
    setCookieConsent(saved)

    if (!user) return

    const isNewReg = localStorage.getItem(NEW_REG_KEY) === 'true'
    if (isNewReg) {
      localStorage.removeItem(NEW_REG_KEY)
      setShowTutorial(true)
      return
    }

    if (saved === 'accepted') {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
        setShowTutorial(true)
      }
    } else {
      setShowTutorial(true)
    }
  }, [user])

  const handleCookieAccept = useCallback(() => {
    localStorage.setItem(COOKIE_KEY, 'accepted')
    setCookieConsent('accepted')
  }, [])

  const handleCookieReject = useCallback(() => {
    localStorage.setItem(COOKIE_KEY, 'rejected')
    setCookieConsent('rejected')
  }, [])

  const handleTutorialComplete = useCallback(() => {
    if (localStorage.getItem(COOKIE_KEY) === 'accepted') {
      localStorage.setItem(TUTORIAL_SEEN_KEY, 'true')
    }
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
            element={user ? <Navigate to="/home" replace /> : <LoginPage />}
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
