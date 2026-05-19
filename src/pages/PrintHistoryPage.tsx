import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Printer, CheckCircle, XCircle, FileText } from 'lucide-react'
import { apiGetPrintHistory, type PrintRecord } from '../api'

export default function PrintHistoryPage() {
  const [history, setHistory] = useState<PrintRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadHistory() }, [])

  const loadHistory = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGetPrintHistory()
      setHistory(res.printHistory || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar histórico')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-6">Histórico de Impressões</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Printer size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium text-gray-500 dark:text-gray-400">Nenhuma impressão realizada</p>
          <p className="text-sm mt-1">Suas impressões aparecerão aqui.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
          {history.map((record, i) => (
            <motion.div
              key={record.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-4 px-5 py-4"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                record.status === 'completed'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-600'
              }`}>
                {record.status === 'completed' ? <CheckCircle size={20} /> : <XCircle size={20} />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-gray-400 shrink-0" />
                  <p className="font-medium truncate">{record.documentName}</p>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(record.printedAt).toLocaleString('pt-BR')}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm text-gray-500 dark:text-gray-400">{record.pages} página(s)</p>
              </div>

              <div className="text-right shrink-0 min-w-[80px]">
                <p className={`text-sm font-semibold ${
                  record.status === 'completed' ? 'text-green-600' : 'text-red-600'
                }`}>
                  R$ {record.cost.toFixed(2)}
                </p>
                <span className={`text-xs ${
                  record.status === 'completed'
                    ? 'text-green-500'
                    : 'text-red-400'
                }`}>
                  {record.status === 'completed' ? 'Concluído' : 'Falhou'}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
