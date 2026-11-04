// Configuração do Vite do site dos alunos. No modo de desenvolvimento repassa /api e
// /uploads para o backend local (server.js na porta 4002).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4002',
      '/uploads': 'http://localhost:4002',
    },
  },
})
