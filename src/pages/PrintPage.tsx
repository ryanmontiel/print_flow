import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Printer, FileText, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { apiGetDocuments, apiGetCredits, apiPrint, type StoredDocument } from '../api'
import { useNavigate } from 'react-router-dom'

export default function PrintPage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [credits, setCredits] = useState(0)
  const [selectedDoc, setSelectedDoc] = useState<StoredDocument | null>(null)
  const [pages, setPages] = useState(1)
  const [costPerPage] = useState(0.50)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [docRes, credRes] = await Promise.all([
        apiGetDocuments().catch(() => ({ documentsList: [] as StoredDocument[] })),
        apiGetCredits().catch(() => ({ credits: 0 })),
      ])
      setDocuments(docRes.documentsList || [])
      setCredits(credRes.credits)
    } catch {
      setError('Erro ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }

  const totalCost = pages * costPerPage
  const canPrint = selectedDoc && credits >= totalCost && pages > 0

  const handlePrint = async () => {
    if (!selectedDoc || !canPrint) return
    setPrinting(true)
    setError('')
    try {
      await apiPrint(selectedDoc.id, selectedDoc.name, pages, totalCost)
      setSuccess(true)
      // Refresh credits
      const credRes = await apiGetCredits().catch(() => null)
      if (credRes) setCredits(credRes.credits)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao imprimir')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-6">Imprimir</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16"
        >
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={36} className="text-green-600 dark:text-green-400" />
          </div>
          <h2 className="font-heading text-2xl font-bold mb-2">Impressão enviada!</h2>
          <p className="text-gray-500 dark:text-gray-200 mb-6">
            Seu documento foi enviado para a fila de impressão.
          </p>
          <button
            onClick={() => { setSuccess(false); setSelectedDoc(null); setPages(1) }}
            className="px-6 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
          >
            Nova impressão
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Select document */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <label className="block text-sm font-medium mb-3 flex items-center gap-2">
              <FileText size={16} /> Selecione o documento
            </label>
            {loading ? (
              <div className="h-10 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
            ) : documents.length === 0 ? (
              <p className="text-sm text-gray-400">
                Nenhum documento disponível.{' '}
                <button onClick={() => navigate('/documents')} className="text-primary-500 hover:underline">
                  Envie um documento primeiro
                </button>
              </p>
            ) : (
              <select
                value={selectedDoc?.id || ''}
                onChange={e => {
                  const doc = documents.find(d => d.id === e.target.value)
                  setSelectedDoc(doc || null)
                }}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="">-- Selecione --</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Pages input */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <label className="block text-sm font-medium mb-3">Número de páginas</label>
            <input
              type="number"
              min={1}
              max={100}
              value={pages}
              onChange={e => setPages(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 outline-none text-center"
            />
            <p className="text-xs text-gray-400 mt-2">Máximo de 100 páginas por impressão.</p>
          </div>

          {/* Summary */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <h3 className="font-heading text-lg font-bold mb-4">Resumo</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-200">Documento</span>
                <span className="font-medium">{selectedDoc?.name || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-200">Páginas</span>
                <span className="font-medium">{pages}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-200">Custo por página</span>
                <span className="font-medium">R$ {costPerPage.toFixed(2)}</span>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between text-base">
                <span className="font-bold">Total</span>
                <span className="font-bold text-primary-500">R$ {totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-200">Saldo atual</span>
                <span className={credits >= totalCost ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                  R$ {credits.toFixed(2)}
                </span>
              </div>
            </div>

            {credits < totalCost && selectedDoc && (
              <div className="mt-4 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                <AlertTriangle size={16} />
                <span>Créditos insuficientes.{' '}</span>
                <button onClick={() => navigate('/credits')} className="underline font-medium">Comprar créditos</button>
              </div>
            )}

            <button
              onClick={handlePrint}
              disabled={!canPrint || printing}
              className="mt-4 w-full py-3 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {printing ? (
                <><Loader2 size={18} className="animate-spin" /> Imprimindo...</>
              ) : (
                <><Printer size={18} /> Confirmar Impressão</>
              )}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
