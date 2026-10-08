import { FormEvent, useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { apiResetPassword } from '../api'
import { motion } from 'framer-motion'
import { Check, Lock } from 'lucide-react'

function PasswordChecklist({ password }: { password: string }) {
  const requirements = [
    { label: '8 caracteres ou mais', met: password.length >= 8 },
    { label: '1 letra maiúscula', met: /[A-Z]/.test(password) },
    { label: '1 número', met: /[0-9]/.test(password) },
    { label: '1 símbolo especial', met: /[^A-Za-z0-9]/.test(password) },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="mt-2.5 p-3 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 rounded-lg"
    >
      <ul className="space-y-2">
        {requirements.map((req, i) => (
          <motion.li
            key={req.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2.5"
          >
            <div
              className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-200 ${
                req.met
                  ? 'bg-green-500 border-green-500'
                  : 'border-red-400 dark:border-red-500/80 bg-red-50 dark:bg-transparent'
              }`}
            >
              {req.met && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  className="text-white"
                >
                  <Check size={12} strokeWidth={3.5} />
                </motion.span>
              )}
            </div>
            <span
              className={`text-xs transition-colors duration-200 ${
                req.met ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {req.label}
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [done, setDone] = useState(false)

const code = searchParams.get('code') || ''

  useEffect(() => {
    if (!code) {
      setNotice({ type: 'error', message: 'Link inválido ou incompleto.' })
    }
  }, [code])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code) return
    if (password !== confirmPassword) {
      setNotice({ type: 'error', message: 'Senhas não conferem' })
      return
    }
    if (!/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(password)) {
      setNotice({ type: 'error', message: 'Senha fraca.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      await apiResetPassword(code, password)
      setNotice({ type: 'success', message: 'Senha redefinida com sucesso!' })
      setDone(true)
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Falha ao redefinir senha' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center justify-center mb-6">
          <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
            <Lock size={28} className="text-primary-600 dark:text-primary-400" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-2">Redefinir senha</h2>
        <p className="text-center text-gray-500 dark:text-gray-400 text-sm mb-6">
          {done ? 'Sua senha foi redefinida com sucesso.' : 'Digite sua nova senha e confirme.'}
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
        {done ? (
          <div className="text-center">
            <Link to="/login" className="inline-block w-full py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors">
              Ir para login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Nova senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                placeholder="Sua nova senha"
              />
              {password.length > 0 && <PasswordChecklist password={password} />}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Confirme sua nova senha</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                placeholder="Repita a senha"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !code}
              className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Aguarde...' : 'Redefinir senha'}
            </button>
            <div className="text-center mt-4">
              <Link to="/login" className="text-sm text-primary-500 hover:text-primary-600 font-medium transition-colors">
                Voltar para login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
