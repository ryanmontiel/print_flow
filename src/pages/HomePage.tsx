import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, CreditCard, Printer, ArrowRight, TrendingUp } from 'lucide-react'
import { apiGetDocuments, apiGetCredits, apiGetPrintHistory, type StoredDocument } from '../api'

export default function HomePage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [credits, setCredits] = useState(0)
  const [printCount, setPrintCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [docRes, credRes, histRes] = await Promise.allSettled([
        apiGetDocuments(),
        apiGetCredits(),
        apiGetPrintHistory(),
      ])

      if (docRes.status === 'fulfilled') setDocuments(docRes.value.documentsList || [])
      else if (!credRes || credRes.status === 'rejected') setError('Erro ao carregar dados. Verifique sua conexão.')

      if (credRes.status === 'fulfilled') setCredits(credRes.value.credits)
      if (histRes.status === 'fulfilled') setPrintCount(histRes.value.printHistory?.length || 0)
    } catch {
      setError('Erro ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }

  const cards = [
    {
      icon: FileText,
      label: 'Documentos',
      value: documents.length,
      description: 'arquivos enviados',
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
      onClick: () => navigate('/documents'),
    },
    {
      icon: CreditCard,
      label: 'Créditos',
      value: credits,
      description: 'créditos disponíveis',
      color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
      onClick: () => navigate('/credits'),
    },
    {
      icon: Printer,
      label: 'Impressões',
      value: printCount,
      description: 'realizadas',
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
      onClick: () => navigate('/print-history'),
    },
    {
      icon: TrendingUp,
      label: 'Status',
      value: 'Online',
      description: 'sistema operacional',
      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
      onClick: undefined,
    },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-heading text-3xl font-bold">Olá! Bem-vindo ao PrintFlow</h1>
        <p className="text-gray-500 dark:text-gray-300 mt-1">
          Gerencie seus documentos, créditos e impressões em um só lugar.
        </p>
      </motion.div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ staggerChildren: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {cards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={card.onClick}
              className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 ${
                card.onClick ? 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 transition-all' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
                  <card.icon size={22} />
                </div>
                {card.onClick && <ArrowRight size={16} className="text-gray-300 dark:text-gray-600 mt-1" />}
              </div>
              <p className="text-2xl font-bold mt-3">{card.value}</p>
              <p className="text-sm text-gray-500 dark:text-gray-300">{card.label} &middot; {card.description}</p>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-8"
      >
        <h2 className="font-heading text-xl font-bold mb-4">Ações rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => navigate('/documents')}
            className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 transition-all text-left"
          >
            <FileText size={20} className="text-primary-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Enviar documento</p>
              <p className="text-xs text-gray-400">Upload de PDF ou imagem</p>
            </div>
          </button>

          <button
            onClick={() => navigate('/credits')}
            className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 transition-all text-left"
          >
            <CreditCard size={20} className="text-primary-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Comprar créditos</p>
              <p className="text-xs text-gray-400">Adicione saldo para imprimir</p>
            </div>
          </button>

          <button
            onClick={() => navigate('/print')}
            className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 transition-all text-left"
          >
            <Printer size={20} className="text-primary-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Imprimir</p>
              <p className="text-xs text-gray-400">Simule e confirme sua impressão</p>
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
