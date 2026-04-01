import { useState } from 'react'
import './App.css'
import LandingPage from './LandingPage'

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready to print')

  if (!currentUser) {
    return <LandingPage onAuthenticate={(userName) => setCurrentUser(userName)} />
  }

  return (
    <main className="app">
      <header className="header">
        <h1>PrintFlow</h1>
        <p>Welcome, {currentUser}. Your lightweight print management dashboard</p>
      </header>

      <section className="card">
        <h2>Dashboard</h2>
        <p>Status: {status}</p>
        <button onClick={() => setStatus('Printing in progress...')}>Start printing</button>
        <button onClick={() => setStatus('Ready to print')}>Reset status</button>
        <button onClick={() => setCurrentUser(null)} style={{ marginTop: 12 }}>
          Logout
        </button>
      </section>
    </main>
  )
}

export default App
