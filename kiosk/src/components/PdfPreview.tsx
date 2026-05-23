import { useEffect, useRef, useState, useCallback } from 'react'
import { CheckSquare, Square } from 'lucide-react'
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
  const [previewPage, setPreviewPage] = useState(1)

  const loadPdf = useCallback(async () => {
    setLoading(true)
    setPdfDoc(null)
    try {
      const doc = await pdfjsLib.getDocument(url).promise
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setPreviewPage(1)
      // Auto-select all pages on first load
      const all = new Set(Array.from({ length: doc.numPages }, (_, i) => i + 1))
      onSelectionChange(all)
      onPageCount?.(doc.numPages)
    } catch (err) {
      console.error('PDF load error:', err)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => { loadPdf() }, [loadPdf])

  useEffect(() => {
    if (pdfDoc && canvasRef.current) renderPage(previewPage)
  }, [pdfDoc, previewPage])

  const renderPage = async (num: number) => {
    if (!pdfDoc || !canvasRef.current) return
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
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-xl">
        <div className="animate-spin w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full" />
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
      {/* Current page preview */}
      <div className="flex justify-center bg-gray-100 rounded-xl p-4 min-h-[250px] max-h-[450px] overflow-auto">
        <canvas ref={canvasRef} className="shadow-lg bg-white" />
      </div>

      {/* Selection toolbar */}
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

      {/* Thumbnail strip */}
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
              <PdfThumbnail url={url} pageNum={n} scale={0.22} />
              {/* Selection badge */}
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

function PdfThumbnail({ url, pageNum, scale }: { url: string; pageNum: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        const doc = await pdfjsLib.getDocument(url).promise
        if (cancelled) return
        const page = await doc.getPage(pageNum)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, viewport }).promise
      } catch {}
    }
    render()
    return () => { cancelled = true }
  }, [url, pageNum, scale])

  return <canvas ref={canvasRef} className="block" style={{ width: 72, height: 72 * 1.4 }} />
}
