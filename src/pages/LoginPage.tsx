import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiLogin, apiRegister } from '../api'
import { Printer, FileText } from 'lucide-react'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const noticeTimerRef = useRef<number | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()

  const showNotice = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotice({ message, type })
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3800)
  }

  useEffect(() => {
    return () => { if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current) }
  }, [])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const matricula = String(formData.get('matricula') ?? '').trim()
    const senha = String(formData.get('senha') ?? '').trim()

    if (!matricula || !senha) {
      showNotice('Preencha matrícula e senha.', 'error')
      return
    }

    setLoading(true)
    try {
      if (mode === 'register') {
        const nomeCompleto = String(formData.get('nomeCompleto') ?? '').trim()
        const confirmeSenha = String(formData.get('confirmeSenha') ?? '').trim()
        if (!nomeCompleto || !confirmeSenha) {
          showNotice('Preencha todos os campos.', 'error')
          setLoading(false)
          return
        }
        if (senha !== confirmeSenha) {
          showNotice('Senhas não conferem.', 'error')
          setLoading(false)
          return
        }
        await apiRegister(matricula, nomeCompleto, senha)
        showNotice('Conta criada!', 'success')
        localStorage.setItem('userCredentials', JSON.stringify({ matricula, senha }))
        localStorage.setItem('pf-new-reg', 'true')
        login(matricula, nomeCompleto)
        setTimeout(() => navigate('/home'), 500)
      } else {
        const result = await apiLogin(matricula, senha)
        localStorage.setItem('userCredentials', JSON.stringify({ matricula, senha }))
        login(matricula, result.displayName)
        setTimeout(() => navigate('/home'), 500)
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro de conexão', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-gray-900">
      {/* Hero side */}
      <div className="lg:w-[55%] bg-gradient-to-br from-primary-800 via-primary-700 to-secondary-800 p-8 lg:p-14 flex flex-col justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-20 right-20 w-48 h-48 rounded-full bg-primary-300 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-xl mx-auto lg:mx-0">
          <h1 className="font-heading text-5xl lg:text-7xl font-bold text-white mb-4 tracking-tight">
            PrintFlow
          </h1>
          <p className="text-lg lg:text-xl text-primary-100 leading-relaxed mb-8">
            Sistema de impressão automatizado do IFSul Campus Lajeado.
            Envie seus documentos, compre créditos e imprima de qualquer lugar.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/10">
              <FileText size={24} className="text-primary-200 mb-2" />
              <h3 className="text-white font-semibold text-sm">Documentos</h3>
              <p className="text-primary-200 text-xs mt-1">Upload e organize seus arquivos</p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/10">
              <Printer size={24} className="text-primary-200 mb-2" />
              <h3 className="text-white font-semibold text-sm">Impressão</h3>
              <p className="text-primary-200 text-xs mt-1">Imprima no campus sem sair de casa</p>
            </div>
          </div>
        </div>
      </div>

      {/* Auth side */}
      <div className="flex-1 bg-white dark:bg-gray-900 p-8 lg:p-14 flex flex-col justify-center">
        <div className="max-w-sm mx-auto w-full">
          <h2 className="font-heading text-3xl font-bold text-gray-900 dark:text-white mb-1">
            {mode === 'login' ? 'Acessar' : 'Criar conta'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
            {mode === 'login' ? 'Entre com sua matrícula e senha.' : 'Preencha os dados para se cadastrar.'}
          </p>

          {notice && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
              notice.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' :
              notice.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800' :
              'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
            }`}>
              {notice.message}
            </div>
          )}

          <form key={mode} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="matricula" className="block text-sm font-medium mb-1">Matrícula</label>
              <input
                id="matricula"
                name="matricula"
                type="text"
                required
                placeholder="Ex: 2024001234"
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="nomeCompleto" className="block text-sm font-medium mb-1">Nome Completo</label>
                <input
                  id="nomeCompleto"
                  name="nomeCompleto"
                  type="text"
                  required
                  placeholder="Seu nome completo"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
              </div>
            )}

            <div>
              <label htmlFor="senha" className="block text-sm font-medium mb-1">Senha</label>
              <input
                id="senha"
                name="senha"
                type="password"
                required
                placeholder="Sua senha"
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="confirmeSenha" className="block text-sm font-medium mb-1">Confirme sua senha</label>
                <input
                  id="confirmeSenha"
                  name="confirmeSenha"
                  type="password"
                  required
                  placeholder="Repita a senha"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Aguarde...' : mode === 'login' ? 'Acessar' : 'Criar conta'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-sm text-primary-500 hover:text-primary-600 font-medium transition-colors"
            >
              {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Faça login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
