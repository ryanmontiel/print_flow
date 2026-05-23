import { Routes, Route, Navigate } from 'react-router-dom'
import KioskLoginPage from './pages/KioskLoginPage'
import KioskPrintPage from './pages/KioskPrintPage'

export default function App() {
  const isLoggedIn = !!localStorage.getItem('pf-kiosk-credentials')

  return (
    <Routes>
      <Route path="/" element={isLoggedIn ? <Navigate to="/print" replace /> : <KioskLoginPage />} />
      <Route path="/print" element={isLoggedIn ? <KioskPrintPage /> : <Navigate to="/" replace />} />
      <Route path="/print/:docId" element={isLoggedIn ? <KioskPrintPage /> : <Navigate to="/" replace />} />
    </Routes>
  )
}
