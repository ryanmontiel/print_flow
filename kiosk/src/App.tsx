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

// Versões antigas guardavam a senha no localStorage (sobrevivia ao fechar o app)
try {
  localStorage.removeItem('pf-kiosk-credentials')
  localStorage.removeItem('pf-kiosk-name')
} catch {}

// Global logout helper used by KioskPrintPage
window.__kioskLogout = () => {
  sessionStorage.removeItem('pf-kiosk-token')
  sessionStorage.removeItem('pf-kiosk-credentials')
  sessionStorage.removeItem('pf-kiosk-name')
}
