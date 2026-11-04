// Ponto de entrada da interface do kiosk: liga o bloqueio de atalhos de teclado e
// monta o React com o roteador.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ativarBloqueioTeclado } from './bloqueioTeclado'
import './index.css'

ativarBloqueioTeclado()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
