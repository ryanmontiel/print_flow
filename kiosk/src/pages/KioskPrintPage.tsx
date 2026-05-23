import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Printer, FileText, LogOut, Loader2, CheckCircle, AlertCircle,
  ChevronLeft, File, Image
} from 'lucide-react'
import PdfPreview from '../components/PdfPreview'
import { apiGetDocuments, apiGetCredits, apiPrint, apiCupsPrint, apiHandleShare, apiGetNotifications, BLACK_WHITE_PRICE, type StoredDocument } from '../api'

type Step = 'select' | 'simulate' | 'done'

export default function KioskPrintPage() {
  const { docId } = useParams()
  const navigate = useNavigate()

  const [docs, setDocs] = useState<StoredDocument[]>([])
  const [selected, setSelected] = useState<StoredDocument | null>(null)
  const [pdfSelectedPages, setPdfSelectedPages] = useState<Set<number>>(new Set())
  const [manualPages, setManualPages] = useState(1)
  const [copies, setCopies] = useState(1)
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [step, setStep] = useState<Step>('select')

  const isPdf = selected?.mimetype === 'application/pdf'
  const selectedPageCount = isPdf ? pdfSelectedPages.size : manualPages
  const totalPrintedPages = selectedPageCount * copies
  const totalCost = totalPrintedPages * BLACK_WHITE_PRICE
  const canPrint = credits >= totalCost && totalPrintedPages > 0

  const userName = localStorage.getItem('pf-kiosk-name') || ''

  useEffect(() => {
    if (!localStorage.getItem('pf-kiosk-credentials')) {
      navigate('/', { replace: true })
      return
    }
    loadData()
  }, [navigate])

  useEffect(() => {
    if (docId && docs.length > 0) {
      const found = docs.find(d => d.id === docId)
      if (found) {
        setSelected(found)
        setStep('simulate')
      }
    }
  }, [docId, docs])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [docRes, credRes] = await Promise.all([
        apiGetDocuments(),
        apiGetCredits().catch(() => ({ credits: 0 })),
      ])
      setDocs(docRes.documentsList)
      setCredits(credRes.credits)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (doc: StoredDocument) => {
    setSelected(doc)
    setPdfSelectedPages(new Set())
    setManualPages(1)
    setCopies(1)
    setSuccess('')
    setError('')
    setStep('simulate')
  }

  const handlePrint = async () => {
    if (!selected) return
    setPrinting(true)
    setError('')
    setSuccess('')

    try {
      let docIdToPrint = selected.id
      let docNameToPrint = selected.name.replace(/^sent:/, '')

      // Auto-accept if the doc has sent: prefix
      if (selected.name.startsWith('sent:')) {
        const notifRes = await apiGetNotifications().catch(() => ({ notifications: [] }))
        const pendingNotif = notifRes.notifications.find(
          n => n.documentId === selected.id && n.status === 'pending'
        )
        if (pendingNotif) {
          await apiHandleShare(pendingNotif.id, 'accepted')
        }
        // Reload documents to get updated name
        const docRes = await apiGetDocuments()
        const updated = docRes.documentsList.find(d => d.id === selected.id)
        if (updated) {
          docNameToPrint = updated.name.replace(/^sent:/, '')
          setSelected(updated)
        }
      }

      // 1. Debit credits via main server
      const res = await apiPrint(docIdToPrint, docNameToPrint, totalPrintedPages, totalCost)
      setCredits(res.credits)

      // 2. Send to CUPS printer
      let cupsMsg = ''
      try {
        const cupsRes = await apiCupsPrint(selected.url)
        cupsMsg = cupsRes.jobId ? ` (job #${cupsRes.jobId})` : ''
      } catch (cupsErr) {
        cupsMsg = '. Atenção: falha ao enviar para impressora, créditos já foram debitados'
      }

      setStep('done')
      setSuccess(`Impressão de ${totalPrintedPages} página(s) concluída${cupsMsg}!`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao imprimir')
    } finally {
      setPrinting(false)
    }
  }

  const handleLogout = () => {
    if (typeof window.__kioskLogout === 'function') {
      window.__kioskLogout()
    }
  }

  const handleBack = () => {
    setSelected(null)
    setStep('select')
    setSuccess('')
    setError('')
    setPdfSelectedPages(new Set())
    setCopies(1)
    if (docId) navigate('/print', { replace: true })
  }

  const getFileIcon = (mime: string) => {
    if (mime?.startsWith('image/')) return <Image size={24} />
    return <File size={24} />
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 size={40} className="animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Printer size={22} className="text-primary-600" />
          <span className="font-heading text-xl font-bold text-gray-900">PrintFlow</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Kiosk</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            Saldo: <strong className="text-primary-600">R$ {credits.toFixed(2)}</strong>
          </span>
          <span className="text-sm text-gray-400 hidden sm:inline">{userName}</span>
          <button
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-gray-100"
            title="Sair"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {step === 'select' && (
          <>
            <h2 className="font-heading text-2xl font-bold text-gray-800 mb-1">Selecione um documento</h2>
            <p className="text-gray-400 text-sm mb-4">Escolha o documento que deseja imprimir em preto e branco</p>

            {docs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <FileText size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-lg">Nenhum documento disponível</p>
                <p className="text-sm">Compartilhe documentos pelo site principal do PrintFlow</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {docs.map((doc, i) => (
                  <motion.button
                    key={doc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => handleSelect(doc)}
                    className="flex items-center gap-4 w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-primary-400 hover:shadow-md transition-all"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0">
                      {getFileIcon(doc.mimetype)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {doc.name.replace(/^sent:/, '')}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {doc.sentFromName ? `Compartilhado por ${doc.sentFromName}` : 'Documento próprio'}
                      </p>
                    </div>
                    <ChevronLeft size={20} className="text-gray-300 rotate-180 flex-shrink-0" />
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'simulate' && selected && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
            >
              <ChevronLeft size={16} />
              Voltar
            </button>

            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0">
                  {getFileIcon(selected.mimetype)}
                </div>
                <div className="min-w-0">
                  <h2 className="font-heading text-xl font-bold text-gray-900 truncate">
                    {selected.name.replace(/^sent:/, '')}
                  </h2>
                  <p className="text-sm text-gray-400 truncate">
                    {selected.sentFromName ? `Compartilhado por ${selected.sentFromName}` : 'Documento próprio'}
                  </p>
                </div>
              </div>

              {/* File preview */}
              <div className="mb-6">
                {(() => {
                  const mime = selected.mimetype || ''

                  if (isPdf) {
                    return (
                      <PdfPreview
                        url={selected.url}
                        selectedPages={pdfSelectedPages}
                        onSelectionChange={setPdfSelectedPages}
                      />
                    )
                  }

                  if (mime.startsWith('image/')) {
                    return (
                      <div className="flex justify-center bg-gray-100 rounded-xl p-4 max-h-[400px] overflow-auto">
                        <img
                          src={selected.url}
                          alt={selected.name}
                          className="max-w-full max-h-[360px] object-contain rounded-lg shadow-md"
                          onLoad={() => setManualPages(1)}
                        />
                      </div>
                    )
                  }

                  return (
                    <div className="flex flex-col items-center justify-center bg-gray-100 rounded-xl p-8 text-gray-400">
                      {getFileIcon(selected.mimetype)}
                      <p className="mt-2 text-sm">Pré-visualização não disponível para este formato</p>
                      <p className="text-xs mt-1">{selected.originalname || selected.name}</p>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-4 mb-6">
                {/* For non-PDFs: manual page count input */}
                {!isPdf && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Número de páginas do documento
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={manualPages}
                      onChange={e => setManualPages(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 text-center px-3 py-3 border border-gray-300 rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}

                {/* Cópias */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Número de cópias
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setCopies(Math.max(1, copies - 1))}
                      className="w-12 h-12 rounded-xl border border-gray-300 text-gray-600 text-xl font-bold hover:bg-gray-50 transition-colors"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={copies}
                      onChange={e => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-center px-3 py-3 border border-gray-300 rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      onClick={() => setCopies(copies + 1)}
                      className="w-12 h-12 rounded-xl border border-gray-300 text-gray-600 text-xl font-bold hover:bg-gray-50 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Resumo / Custo */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Configuração</span>
                    <span className="font-medium text-gray-700">Preto e branco, simples</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Preço por página</span>
                    <span className="font-medium text-gray-700">R$ {BLACK_WHITE_PRICE.toFixed(2)}</span>
                  </div>
                  {selectedPageCount > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Páginas selecionadas</span>
                        <span className="font-medium text-gray-700">{selectedPageCount}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Cópias</span>
                        <span className="font-medium text-gray-700">{copies}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total de páginas</span>
                        <span className="font-medium text-gray-700">{totalPrintedPages}</span>
                      </div>
                    </>
                  )}
                  <div className="border-t border-gray-200 pt-2 flex justify-between">
                    <span className="font-medium text-gray-800">Valor total</span>
                    <span className={`font-bold text-lg ${canPrint ? 'text-primary-600' : 'text-red-500'}`}>
                      R$ {totalCost.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Saldo atual</span>
                    <span className={`font-medium ${credits >= totalCost ? 'text-primary-600' : 'text-red-500'}`}>
                      R$ {credits.toFixed(2)}
                    </span>
                  </div>
                  {credits < totalCost && (
                    <div className="mt-2 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs flex items-center gap-1">
                      <AlertCircle size={14} />
                      Créditos insuficientes. Adicione créditos pelo site principal.
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handlePrint}
                disabled={!canPrint || printing}
                className="w-full py-4 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {printing ? <Loader2 size={22} className="animate-spin" /> : <Printer size={22} />}
                {printing ? 'Imprimindo...' : `Imprimir (R$ ${totalCost.toFixed(2)})`}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'done' && success && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-16"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <CheckCircle size={40} className="text-green-600" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-gray-800 mb-2">Impressão concluída!</h2>
            <p className="text-gray-500 mb-8">{success}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl transition-colors"
              >
                Imprimir outro documento
              </button>
              <button
                onClick={handleLogout}
                className="px-6 py-3 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition-colors"
              >
                Sair
              </button>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  )
}
