import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'https://print-flow-frjf.onrender.com',
      '/uploads': 'https://print-flow-frjf.onrender.com',
    },
  },
})
