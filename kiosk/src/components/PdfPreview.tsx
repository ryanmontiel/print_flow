// Pré-visualização de PDF no kiosk (pdf.js): mostra a página atual em tamanho grande
// e miniaturas de todas as páginas, que o aluno toca para escolher quais imprimir.
// A seleção fica com o componente pai (KioskPrintPage), que calcula o preço.
import { useEffect, useRef, useState, useCallback } from 'react'
import { CheckSquare, Square, RefreshCw, AlertCircle } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

const version = pdfjsLib.version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`

// Altura útil da área de visualização (max-h-[450px] menos o padding p-4)
const PREVIEW_MAX_HEIGHT = 418

type Props = {
  url: string
  selectedPages: Set<number>
  onSelectionChange: (selected: Set<number>) => void
  onPageCount?: (count: number) => void
}

export default function PdfPreview({ url, selectedPages, onSelectionChange, onPageCount }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [previewPage, setPreviewPage] = useState(1)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const renderSeqRef = useRef(0)
  // Abre o PDF, informa o total de páginas ao pai e começa com todas selecionadas
  const loadPdf = useCallback(async () => {
    setLoading(true)
    setError('')
    setPdfDoc(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)
      const doc = await pdfjsLib.getDocument({ url, useSystemFonts: true, stopAtErrors: false }).promise
      clearTimeout(timeout)
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setPreviewPage(1)
      const all = new Set(Array.from({ length: doc.numPages }, (_, i) => i + 1))
      onSelectionChange(all)
      onPageCount?.(doc.numPages)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error('PDF load error:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [url, onSelectionChange, onPageCount])

  useEffect(() => { loadPdf() }, [loadPdf])

  useEffect(() => {
    if (pdfDoc && canvasRef.current) renderPage(previewPage)
    // Ao trocar de documento/página ou desmontar, cancela o desenho em andamento
    return () => {
      renderSeqRef.current++
      renderTaskRef.current?.cancel()
    }
  }, [pdfDoc, previewPage])

  // Desenha a página no canvas principal, em alta resolução (devicePixelRatio)
  const renderPage = async (num: number) => {
    if (!pdfDoc || !canvasRef.current) return
    // Só o desenho mais recente pode pintar no canvas: um desenho antigo terminando
    // depois de o canvas ser redimensionado deixava a página cortada/esticada.
    const seq = ++renderSeqRef.current
    const previous = renderTaskRef.current
    previous?.cancel()
    try {
      const page = await pdfDoc.getPage(num)
      try { await previous?.promise } catch {}
      if (seq !== renderSeqRef.current || !canvasRef.current) return
      const container = canvasRef.current.parentElement!
      const maxW = Math.min(container.clientWidth - 32, 600)
      const viewport = page.getViewport({ scale: 1 })
      // Encaixa na largura e na altura mantendo a proporção (retrato e paisagem)
      const scale = Math.min(maxW / viewport.width, PREVIEW_MAX_HEIGHT / viewport.height)
      const dpr = window.devicePixelRatio || 1
      const scaled = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      canvas.width = scaled.width
      canvas.height = scaled.height
      canvas.style.width = `${scaled.width / dpr}px`
      canvas.style.height = `${scaled.height / dpr}px`
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      const task = page.render({ canvas, viewport: scaled })
      renderTaskRef.current = task
      await task.promise
    } catch (err) {
      if (err instanceof Error && err.name === 'RenderingCancelledException') return
      console.error('PDF render error:', err)
    }
  }

  // Marca/desmarca a página para impressão e já mostra ela em destaque
  const togglePage = (n: number) => {
    const next = new Set(selectedPages)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    onSelectionChange(next)
    setPreviewPage(n)
  }

  const selectAll = () => {
    const all = new Set(Array.from({ length: totalPages }, (_, i) => i + 1))
    onSelectionChange(all)
  }

  const deselectAll = () => {
    onSelectionChange(new Set())
  }

  const allSelected = selectedPages.size === totalPages

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-gray-100 rounded-xl gap-3">
        <div className="animate-spin w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full" />
        <p className="text-xs text-gray-400">Carregando PDF...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center bg-gray-100 rounded-xl p-8 text-gray-400 min-h-[200px]">
        <AlertCircle size={32} className="mb-2" />
        <p className="text-sm">Erro ao carregar PDF</p>
        <p className="text-xs text-gray-500 mt-1 max-w-sm text-center break-words">{error}</p>
        <button
          onClick={() => loadPdf()}
          className="mt-3 flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!pdfDoc) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-100 rounded-xl text-sm text-gray-400">
        Não foi possível carregar o PDF
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center bg-gray-100 rounded-xl p-4 min-h-[250px] max-h-[450px] overflow-auto">
        <canvas ref={canvasRef} className="shadow-lg bg-white flex-shrink-0" />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {selectedPages.size} de {totalPages} páginas selecionadas
        </span>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            disabled={allSelected}
            className="text-xs px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <CheckSquare size={14} />
            Selecionar todas
          </button>
          <button
            onClick={deselectAll}
            disabled={selectedPages.size === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Square size={14} />
            Limpar
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 px-1 justify-center flex-wrap">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => {
          const isSelected = selectedPages.has(n)
          return (
            <button
              key={n}
              onClick={() => togglePage(n)}
              className={`flex-shrink-0 rounded-lg border-2 overflow-hidden transition-all relative ${
                isSelected
                  ? 'border-primary-500 shadow-md'
                  : 'border-transparent opacity-50 hover:opacity-100'
              } ${n === previewPage ? 'ring-2 ring-primary-300' : ''}`}
              title={`Página ${n}${isSelected ? '' : ' (não selecionada)'}`}
            >
              <PdfThumbnail page={pdfDoc} pageNum={n} scale={0.22} />
              <div className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                isSelected ? 'bg-primary-600' : 'bg-gray-400'
              }`}>
                {n}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Miniatura de uma página; cancela o desenho se o componente sair da tela antes de terminar
function PdfThumbnail({ page, pageNum, scale }: { page: pdfjsLib.PDFDocumentProxy; pageNum: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: pdfjsLib.RenderTask | null = null
    const render = async () => {
      try {
        const p = await page.getPage(pageNum)
        if (cancelled) return
        const viewport = p.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        task = p.render({ canvas, viewport })
        await task.promise
      } catch {}
    }
    render()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [page, pageNum, scale])

  // Altura automática: a miniatura segue a proporção da página
  return <canvas ref={canvasRef} className="block" style={{ width: 72, height: 'auto' }} />
}
