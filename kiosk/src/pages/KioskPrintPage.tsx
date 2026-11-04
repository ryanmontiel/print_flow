// Tela principal do kiosk, em etapas (step):
//   select    -> lista os documentos do aluno;
//   simulate  -> pré-visualiza, escolhe páginas, cópias, cor e frente e verso e mostra o custo;
//   printing  -> envia ao servidor do kiosk e consulta o status a cada 3 s;
//   done/error -> resultado da impressão.
// Encerra a sessão sozinha por inatividade, com aviso nos últimos 20 segundos.
import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Printer, FileText, LogOut, Loader2, CheckCircle, AlertCircle,
  ChevronLeft, File, Image, RefreshCw, XCircle
} from 'lucide-react'
import PdfPreview from '../components/PdfPreview'
import ImagePreview from '../components/ImagePreview'
import { apiGetDocuments, apiGetCredits, apiPrintStart, apiPrintStatus, apiPrintComplete, apiGetPrintPreferences, getPrintPrice, getPrintCost, printConfigLabel, formatBRL, documentDisplayName, truncateTitle, type StoredDocument, type PrintConfig } from '../api'

// Encerra a sessão sozinho se o aluno se afastar do kiosk
const IDLE_LOGOUT_MS = 2 * 60 * 1000
const IDLE_LOGOUT_DONE_MS = 30 * 1000
const IDLE_WARNING_MS = 20 * 1000

// {1,2,3,5} -> "1-3,5" (formato do page-ranges do CUPS)
function toPageRanges(pages: Set<number>): string {
  const sorted = [...pages].sort((a, b) => a - b)
  const ranges: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++
    ranges.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`)
  }
  return ranges.join(',')
}

type Step = 'select' | 'simulate' | 'printing' | 'done' | 'error'

export default function KioskPrintPage() {
  const { docId } = useParams()
  const navigate = useNavigate()

  const [docs, setDocs] = useState<StoredDocument[]>([])
  const [selected, setSelected] = useState<StoredDocument | null>(null)
  const [pdfSelectedPages, setPdfSelectedPages] = useState<Set<number>>(new Set())
  const [manualPages, setManualPages] = useState(1)
  const [copies, setCopies] = useState(1)
  const [credits, setCredits] = useState(0)
  const [config, setConfig] = useState<PrintConfig>({ color: 'bw', duplex: 'single' })

  const setConfigPersist = (updater: PrintConfig | ((prev: PrintConfig) => PrintConfig)) => {
    setConfig(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try { localStorage.setItem('pf-kiosk-print-config', JSON.stringify(next)) } catch {}
      return next
    })
  }
  const [loading, setLoading] = useState(true)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [step, setStep] = useState<Step>('select')
  const [printJobId, setPrintJobId] = useState<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const printStartingRef = useRef(false)

  const isPdf = selected?.mimetype === 'application/pdf'
  const selectedPageCount = isPdf ? pdfSelectedPages.size : manualPages
  const totalPrintedPages = selectedPageCount * copies
  const price = getPrintPrice(config)
  const totalCost = getPrintCost(config, totalPrintedPages)
  const canDuplex = selectedPageCount >= 2
  const canPrint = credits >= totalCost && totalPrintedPages > 0

  const userName = sessionStorage.getItem('pf-kiosk-name') || ''

  useEffect(() => {
    if (!sessionStorage.getItem('pf-kiosk-token')) {
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

  useEffect(() => {
    if (!canDuplex && config.duplex === 'duplex') {
      setConfigPersist(c => ({ ...c, duplex: 'single' }))
    }
  }, [canDuplex, config.duplex])

  // Carrega documentos, saldo e preferências de impressão de uma vez e já começa a
  // baixar os arquivos em segundo plano, para a pré-visualização abrir mais rápido
  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [docRes, credRes, prefRes] = await Promise.all([
        apiGetDocuments(),
        apiGetCredits().catch(() => ({ credits: 0 })),
        apiGetPrintPreferences().catch(() => ({ printColor: 'bw', printDuplex: 'single' })),
      ])
      // Show all documents for the user
      const accepted = docRes.documents
      setDocs(accepted)
      setCredits(credRes.credits)
      // Apply print preferences from main server
      setConfigPersist({ color: prefRes.printColor as 'bw' | 'color', duplex: prefRes.printDuplex as 'single' | 'duplex' })
      // Pre-fetch document files in background so cache warms up
      accepted.forEach(doc => {
        fetch(doc.url, { priority: 'low', cache: 'force-cache' }).catch(() => {})
      })
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
    setConfigPersist({ color: 'bw', duplex: 'single' })
    setSuccess('')
    setError('')
    setStep('simulate')
  }

  const handlePrint = async () => {
    // Trava síncrona: toques repetidos antes de a tela redesenhar geravam vários trabalhos
    if (!selected || printStartingRef.current) return
    printStartingRef.current = true
    setPrinting(true)
    setError('')
    setSuccess('')
    setStep('printing')

    try {
      const res = await apiPrintStart({
        fileUrl: selected.url,
        color: config.color,
        duplex: config.duplex,
        documentId: selected.id,
        documentName: selected.name || selected.originalname || 'Documento',
        pages: totalPrintedPages,
        copies,
        pageRanges: isPdf ? toPageRanges(pdfSelectedPages) : undefined,
      })
      setPrintJobId(res.jobId)
      startPolling(res.jobId)
    } catch (err) {
      setPrinting(false)
      setStep('error')
      setError(err instanceof Error ? err.message : 'Erro ao iniciar impressão')
    } finally {
      printStartingRef.current = false
    }
  }

  // Pergunta ao servidor do kiosk, a cada 3 s, se a impressora já terminou o trabalho
  const startPolling = (jobId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await apiPrintStatus(jobId)
        if (res.status === 'completed') {
          clearInterval(pollIntervalRef.current!)
          await completePrint(jobId)
        } else if (res.status === 'error') {
          handlePrintError(res.error || 'Falha na impressão')
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 3000)
  }

  const completePrint = async (jobId: string) => {
    try {
      const res = await apiPrintComplete(jobId)
      setCredits(res.credits)
      setPrinting(false)
      setStep('done')
      setSuccess(`Impressão concluída! Créditos debitados: ${formatBRL(res.credits)}`)
    } catch (err) {
      handlePrintError(err instanceof Error ? err.message : 'Falha ao debitar créditos')
    }
  }

  const handlePrintError = (message: string) => {
    clearInterval(pollIntervalRef.current!)
    setPrinting(false)
    setStep('error')
    setError(message)
  }

  const cleanupPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  useEffect(() => {
    return () => cleanupPolling()
  }, [])

  const handleLogout = () => {
    if (typeof window.__kioskLogout === 'function') {
      window.__kioskLogout()
    }
    navigate('/', { replace: true })
  }

  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null)
  const logoutRef = useRef(handleLogout)
  logoutRef.current = handleLogout

  // Contador de inatividade: qualquer toque/tecla zera; depois de 2 min (30 s na tela
  // de concluído) faz logout. Recomeça a cada troca de etapa.
  useEffect(() => {
    // Não desloga no meio de uma impressão
    if (step === 'printing') { setIdleSecondsLeft(null); return }
    const limit = step === 'done' ? IDLE_LOGOUT_DONE_MS : IDLE_LOGOUT_MS
    let lastActivity = Date.now()
    const reset = () => { lastActivity = Date.now(); setIdleSecondsLeft(null) }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    const timer = setInterval(() => {
      const left = limit - (Date.now() - lastActivity)
      if (left <= 0) logoutRef.current()
      else setIdleSecondsLeft(left <= IDLE_WARNING_MS ? Math.ceil(left / 1000) : null)
    }, 1000)
    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      clearInterval(timer)
    }
  }, [step])

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
      {idleSecondsLeft !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl text-center">
          <p className="font-semibold">Sessão será encerrada em {idleSecondsLeft}s por inatividade</p>
          <p className="text-sm text-gray-300">Toque na tela para continuar</p>
        </div>
      )}
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Printer size={22} className="text-primary-600" />
          <span className="font-heading text-xl font-bold text-gray-900">PrintFlow</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Kiosk</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            Saldo: <strong className="text-primary-600">{formatBRL(credits)}</strong>
          </span>
          <span className="text-sm text-gray-400 hidden sm:inline max-w-[160px] truncate">{truncateTitle(userName, 24)}</span>
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
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-heading text-2xl font-bold text-gray-800">Selecione um documento</h2>
              <button
                onClick={loadData}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-primary-600 transition-colors rounded-lg hover:bg-gray-200 disabled:opacity-40"
                title="Recarregar documentos"
              >
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-4">Escolha o documento que deseja imprimir</p>

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
                        {truncateTitle(documentDisplayName(doc))}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {doc.compartilhado_de_nome ? `Compartilhado por ${doc.compartilhado_de_nome}` : 'Documento próprio'}
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
                        {truncateTitle(documentDisplayName(selected))}
                      </h2>
                  <p className="text-sm text-gray-400 truncate">
                    {selected.compartilhado_de_nome ? `Compartilhado por ${selected.compartilhado_de_nome}` : 'Documento próprio'}
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
                      <ImagePreview src={selected.url} alt={selected.name} />
                    )
                  }

                  return (
                    <div className="flex flex-col items-center justify-center bg-gray-100 rounded-xl p-8 text-gray-400">
                      {getFileIcon(selected.mimetype)}
                      <p className="mt-2 text-sm">Pré-visualização não disponível para este formato</p>
                      <p className="text-xs mt-1 max-w-full truncate">{truncateTitle(documentDisplayName(selected))}</p>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-4 mb-6">
                {/* Configuração */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cor
                    </label>
                    <select
                      value={config.color}
                      onChange={e => setConfigPersist(c => ({ ...c, color: e.target.value as PrintConfig['color'] }))}
                      className="w-full px-3 py-3 border border-gray-300 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="bw">Preto e branco</option>
                      <option value="color">Colorido</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Impressão
                    </label>
                    <select
                      value={config.duplex}
                      onChange={e => setConfigPersist(c => ({ ...c, duplex: e.target.value as PrintConfig['duplex'] }))}
                      className="w-full px-3 py-3 border border-gray-300 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="single">Simples</option>
                      <option value="duplex" disabled={!canDuplex}>Frente e verso</option>
                    </select>
                    {!canDuplex && (
                      <p className="text-xs text-gray-400 mt-1">
                        Frente e verso indisponível: requer pelo menos 2 páginas.
                      </p>
                    )}
                  </div>
                </div>

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
                    <span className="font-medium text-gray-700">{printConfigLabel(config)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Preço por página</span>
                    <span className="font-medium text-gray-700">{formatBRL(price)}</span>
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
                      {formatBRL(totalCost)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Saldo atual</span>
                    <span className={`font-medium ${credits >= totalCost ? 'text-primary-600' : 'text-red-500'}`}>
                      {formatBRL(credits)}
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
                {printing ? 'Imprimindo...' : `Imprimir (${formatBRL(totalCost)})`}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'printing' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-100 rounded-full mb-6 animate-pulse">
              <Printer size={40} className="text-primary-600" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-gray-800 mb-2">Aguardando impressão...</h2>
            <p className="text-gray-500 mb-8">Enviamos o documento para a impressora. Por favor, aguarde a conclusão.</p>
            <div className="flex justify-center gap-2">
              <div className="w-4 h-4 bg-primary-200 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-4 h-4 bg-primary-200 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-4 h-4 bg-primary-200 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="mt-6 text-sm text-gray-400">Verificando status a cada 3 segundos...</p>
            {printJobId && <p className="mt-2 text-xs text-gray-400 font-mono">Job ID: {printJobId}</p>}
          </motion.div>
        )}

        {step === 'error' && error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-6">
              <XCircle size={40} className="text-red-600" />
            </div>
            <h2 className="font-heading text-2xl font-bold text-gray-800 mb-4">Algo deu errado durante a impressão</h2>
            <div className="max-w-md mx-auto mb-8 text-left bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
              <p className="mb-4">Por favor, avise nosso suporte sobre o ocorrido e desculpe pelo inconveniente.</p>
              <p className="font-medium mb-2">Nenhum crédito foi debitado no processo.</p>
              <div className="mt-6 pt-4 border-t border-red-200 space-y-1 text-sm">
                <p><strong>Contato:</strong></p>
                <p>Ryan - 51 99768-6007</p>
                <p>Luiza - 51 99989-5586</p>
              </div>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setStep('simulate'); setError(''); setPrintJobId(null) }}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl transition-colors"
              >
                Tentar novamente
              </button>
              <button
                onClick={handleBack}
                className="px-6 py-3 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition-colors"
              >
                Voltar
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
