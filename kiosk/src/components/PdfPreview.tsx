import { useEffect, useRef, useState, useCallback } from 'react'
import { CheckSquare, Square, RefreshCw, AlertCircle } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

const version = pdfjsLib.version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`

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
  }, [pdfDoc, previewPage])

  const renderPage = async (num: number) => {
    if (!pdfDoc || !canvasRef.current) return
    try {
      const page = await pdfDoc.getPage(num)
      const container = canvasRef.current.parentElement!
      const maxW = Math.min(container.clientWidth - 32, 600)
      const viewport = page.getViewport({ scale: 1 })
      const scale = maxW / viewport.width
      const scaled = page.getViewport({ scale })
      const canvas = canvasRef.current
      canvas.width = scaled.width
      canvas.height = scaled.height
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport: scaled }).promise
    } catch (err) {
      console.error('PDF render error:', err)
    }
  }

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
        <p className="text-xs text-gray-300 mt-1 max-w-xs text-center truncate">{error}</p>
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
      <div className="flex justify-center bg-gray-100 rounded-xl p-4 min-h-[250px] max-h-[450px] overflow-auto">
        <canvas ref={canvasRef} className="shadow-lg bg-white" />
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

function PdfThumbnail({ page, pageNum, scale }: { page: pdfjsLib.PDFDocumentProxy; pageNum: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        const p = await page.getPage(pageNum)
        if (cancelled) return
        const viewport = p.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        await p.render({ canvas, viewport }).promise
      } catch {}
    }
    render()
    return () => { cancelled = true }
  }, [page, pageNum, scale])

  return <canvas ref={canvasRef} className="block" style={{ width: 72, height: 72 * 1.4 }} />
}
