// Página inicial do aluno: cartões com total de documentos, saldo e impressões,
// últimas movimentações de créditos, atalhos e uma janela rápida para compartilhar
// um documento sem sair da página.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, CreditCard, Printer, ArrowRight, TrendingUp, TrendingDown, Send, X } from 'lucide-react'
import { apiGetDocuments, apiGetCredits, apiGetPrintHistory, apiSearchUsers, apiShareDocument, isOwnDocument, documentDisplayName, truncateTitle, formatBRL, type StoredDocument, type Transaction } from '../api'

export default function HomePage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [credits, setCredits] = useState(0)
  const [printCount, setPrintCount] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareDocs, setShareDocs] = useState<StoredDocument[]>([])
  const shareSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shareSelectedDoc, setShareSelectedDoc] = useState('')
  const [shareEmail, setShareEmail] = useState('')
  const [shareEmailFiltered, setShareEmailFiltered] = useState<{ email: string; nome: string }[]>([])
  const [shareMessage, setShareMessage] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareSuccess, setShareSuccess] = useState(false)
  const [shareError, setShareError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  // Busca tudo em paralelo; allSettled deixa a página mostrar o que carregou mesmo
  // se uma das chamadas falhar. Guarda só as 3 transações mais recentes.
  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [docRes, credRes, histRes] = await Promise.allSettled([
        apiGetDocuments(),
        apiGetCredits(),
        apiGetPrintHistory(),
      ])

      if (docRes.status === 'fulfilled') setDocuments(docRes.value.documents || [])
      else if (!credRes || credRes.status === 'rejected') setError('Erro ao carregar dados. Verifique sua conexão.')

      if (credRes.status === 'fulfilled') {
        setCredits(credRes.value.credits)
        setTransactions((credRes.value.transactions || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3))
      }
      if (histRes.status === 'fulfilled') setPrintCount(histRes.value.printHistory?.length || 0)
    } catch {
      setError('Erro ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }

  const openShareModal = async () => {
    setShareOpen(true)
    setShareSuccess(false)
    setShareError('')
    setShareSelectedDoc('')
    setShareEmail('')
    setShareMessage('')
    try {
      const docsRes = await apiGetDocuments()
      setShareDocs((docsRes.documents || []).filter(isOwnDocument))
    } catch {}
  }

  // Sugestões de destinatário: busca no servidor 250 ms depois de parar de digitar
  const handleShareEmailChange = (value: string) => {
    setShareEmail(value)
    if (shareSearchTimer.current) clearTimeout(shareSearchTimer.current)
    if (value.trim().length < 3) {
      setShareEmailFiltered([])
      return
    }
    shareSearchTimer.current = setTimeout(() => {
      apiSearchUsers(value.trim())
        .then(res => setShareEmailFiltered(res.users || []))
        .catch(() => setShareEmailFiltered([]))
    }, 250)
  }

  const handleShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shareSelectedDoc || !shareEmail.trim()) {
      setShareError('Selecione um documento e informe o email do destinatário.')
      return
    }
    setShareLoading(true)
    setShareError('')
    try {
      const doc = shareDocs.find(d => d.id === shareSelectedDoc)
      await apiShareDocument(shareEmail.trim(), shareSelectedDoc, doc ? documentDisplayName(doc) : '', shareMessage.trim())
      setShareSuccess(true)
      setTimeout(() => setShareOpen(false), 1500)
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Erro ao compartilhar')
    } finally {
      setShareLoading(false)
    }
  }

  const cards = [
    {
      icon: FileText,
      label: 'Documentos',
      value: documents.filter(isOwnDocument).length,
      description: 'arquivos enviados',
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
      onClick: () => navigate('/documents'),
    },
    {
      icon: CreditCard,
      label: 'Créditos',
      value: formatBRL(credits),
      description: 'saldo disponível',
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
  ]

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-heading text-3xl font-bold">Olá! Bem-vindo ao PrintFlow</h1>
        <p className="text-gray-500 dark:text-gray-200 mt-1">
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
        <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ staggerChildren: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {cards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={card.onClick}
              className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 ${
                card.onClick !== undefined ? 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 transition-all' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
                  <card.icon size={22} />
                </div>
                {card.onClick !== undefined && <ArrowRight size={16} className="text-gray-300 dark:text-gray-400 mt-1" />}
              </div>
              <p className="text-2xl font-bold mt-3">{card.value}</p>
              <p className="text-sm text-gray-500 dark:text-gray-200">{card.label} &middot; {card.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Transaction preview */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading text-sm font-bold text-gray-500 dark:text-gray-200">Últimas transações</h3>
            <button onClick={() => navigate('/credits')} className="text-xs text-primary-500 hover:text-primary-600 font-medium">Ver tudo</button>
          </div>
          {transactions.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-300">Nenhuma transação ainda.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.createdAt + tx.description} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    tx.type === 'credit'
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-600'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-600'
                  }`}>
                    {tx.type === 'credit' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                    {tx.description}
                    {tx.origem === 'equipe' && (
                      <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary-50 dark:bg-secondary-900/30 text-secondary-700 dark:text-secondary-300">Ajuste da equipe</span>
                    )}
                  </p>
                  {tx.motivo && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Motivo: {tx.motivo}</p>}
                    <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  <span className={`text-sm font-semibold shrink-0 ${tx.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.type === 'credit' ? '+' : '-'}{formatBRL(Math.abs(tx.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
        </>
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
            onClick={openShareModal}
            className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 transition-all text-left"
          >
            <Send size={20} className="text-primary-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">Compartilhar</p>
              <p className="text-xs text-gray-400">Envie um documento para alguém</p>
            </div>
          </button>
        </div>
      </motion.div>

      {/* Share modal */}
      {shareOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShareOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
            <button onClick={() => setShareOpen(false)} className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <Send size={20} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-bold">Compartilhar Documento</h2>
                <p className="text-sm text-gray-500 dark:text-gray-200">Envie um documento para outro usuário</p>
              </div>
            </div>

            {shareSuccess ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                  <Send size={24} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="text-green-600 dark:text-green-400 font-medium">Documento compartilhado!</p>
              </div>
            ) : (
              <form onSubmit={handleShareSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Documento</label>
                  <select
                    value={shareSelectedDoc}
                    onChange={e => setShareSelectedDoc(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  >
                    <option value="">Selecione um documento</option>
                    {shareDocs.map(d => (
                      <option key={d.id} value={d.id}>{truncateTitle(documentDisplayName(d))}</option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Email do destinatário</label>
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={e => handleShareEmailChange(e.target.value)}
                    placeholder="aluno@email.com"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    autoFocus
                  />
                  {shareEmailFiltered.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {shareEmailFiltered.map(u => (
                        <button
                          key={u.email}
                          type="button"
                          onClick={() => { setShareEmail(u.email); setShareEmailFiltered([]) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center gap-2 text-gray-900 dark:text-gray-200"
                        >
                          <span className="font-medium">{u.email}</span>
                          <span className="text-gray-400 dark:text-gray-500 truncate">{u.nome}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Mensagem (opcional)</label>
                  <textarea
                    value={shareMessage}
                    onChange={e => setShareMessage(e.target.value)}
                    placeholder="Ex: Olá, segue o documento para impressão..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all resize-none"
                  />
                </div>

                {shareError && (
                  <p className="text-red-500 text-sm">{shareError}</p>
                )}

                <button
                  type="submit"
                  disabled={shareLoading}
                  className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  {shareLoading ? 'Compartilhando...' : 'Compartilhar'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
