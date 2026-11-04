// Tela de login do kiosk. O aluno entra com o mesmo email e senha do site; a sessão
// (token de 2 horas, pedido com client: 'kiosk') fica no sessionStorage. Ao abrir,
// já chama /api/health para "acordar" o servidor principal enquanto o aluno digita.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Loader2 } from 'lucide-react'
import { apiLogin, apiHealthCheck } from '../api'

export default function KioskLoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { apiHealthCheck().catch(() => {}) }, [])

  useEffect(() => {
    if (sessionStorage.getItem('pf-kiosk-token')) {
      navigate('/print', { replace: true })
    }
  }, [navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !senha) { setError('Preencha todos os campos'); return }
    setLoading(true)
    try {
      const res = await apiLogin(email, senha)
      sessionStorage.setItem('pf-kiosk-token', res.token)
      sessionStorage.setItem('pf-kiosk-name', res.displayName)
      navigate('/print', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-700 to-primary-900 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
            <Printer size={32} className="text-primary-600" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-gray-900">PrintFlow</h1>
          <p className="text-gray-500 text-sm mt-1">Kiosk de Impressão</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="Digite sua senha"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold rounded-xl text-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : null}
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
