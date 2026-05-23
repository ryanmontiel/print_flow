import { Routes, Route } from 'react-router-dom'
import KioskLoginPage from './pages/KioskLoginPage'
import KioskPrintPage from './pages/KioskPrintPage'

export default function App() {
  // Each page handles its own auth check
  return (
    <Routes>
      <Route path="/" element={<KioskLoginPage />} />
      <Route path="/print" element={<KioskPrintPage />} />
      <Route path="/print/:docId" element={<KioskPrintPage />} />
    </Routes>
  )
}

// Global logout helper used by KioskPrintPage
window.__kioskLogout = () => {
  localStorage.removeItem('pf-kiosk-credentials')
  localStorage.removeItem('pf-kiosk-name')
}
