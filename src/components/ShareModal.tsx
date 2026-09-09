import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, User } from 'lucide-react'
import { apiGetUsers } from '../api'

type Props = {
  isOpen: boolean
  onClose: () => void
  documentName: string
  onShare: (targetMatricula: string, message: string) => Promise<void>
}

export default function ShareModal({ isOpen, onClose, documentName, onShare }: Props) {
  const [targetMatricula, setTargetMatricula] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [users, setUsers] = useState<{ matricula: string; nome: string }[]>([])
  const [filtered, setFiltered] = useState<{ matricula: string; nome: string }[]>([])

  useEffect(() => {
    if (!isOpen) return
    setTargetMatricula('')
    setMessage('')
    setError('')
    setSuccess(false)
    setFiltered([])
    apiGetUsers()
      .then(res => setUsers(res.users || []))
      .catch(() => {})
  }, [isOpen])

  const handleMatriculaChange = (value: string) => {
    setTargetMatricula(value)
    if (value.length >= 2) {
      const matches = users.filter(u =>
        u.matricula.toLowerCase().includes(value.toLowerCase()) ||
        u.nome.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 5)
      setFiltered(matches)
    } else {
      setFiltered([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetMatricula.trim()) {
      setError('Informe a matrícula do destinatário.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await onShare(targetMatricula.trim(), message.trim())
      setSuccess(true)
      setTimeout(() => {
        onClose()
        setSuccess(false)
        setTargetMatricula('')
        setMessage('')
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao compartilhar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
          >
            <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <Send size={20} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-bold">Compartilhar Documento</h2>
                <p className="text-sm text-gray-500 dark:text-gray-200 truncate">{documentName}</p>
              </div>
            </div>

            {success ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                  <Send size={24} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="text-green-600 dark:text-green-400 font-medium">Documento compartilhado!</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200 flex items-center gap-2">
                    <User size={14} /> Matrícula do destinatário
                  </label>
                  <input
                    type="text"
                    value={targetMatricula}
                    onChange={e => handleMatriculaChange(e.target.value)}
                    placeholder="Ex: 2024001234"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                  />
                  {filtered.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {filtered.map(u => (
                        <button
                          key={u.matricula}
                          type="button"
                          onClick={() => { setTargetMatricula(u.matricula); setFiltered([]) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 text-gray-900 dark:text-gray-200"
                        >
                          <span className="font-medium">{u.matricula}</span>
                          <span className="text-gray-400 dark:text-gray-500 truncate">{u.nome}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Mensagem (opcional)</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Ex: Olá, segue o documento para impressão..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all resize-none"
                  />
                </div>

                {error && (
                  <p className="text-red-500 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  {loading ? 'Compartilhando...' : 'Compartilhar'}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
