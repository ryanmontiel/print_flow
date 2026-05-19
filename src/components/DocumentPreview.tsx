import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, File, Image } from 'lucide-react'

type Props = {
  url: string
  mimetype: string
  name: string
  delay?: number
}

export default function DocumentPreview({ url, mimetype, name, delay = 1500 }: Props) {
  const [show, setShow] = useState(false)
  const [page, setPage] = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isImage = mimetype.startsWith('image/')
  const isPdf = mimetype === 'application/pdf'

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null }
    setShow(false)
    setPage(1)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      setShow(true)
      if (isPdf) {
        cycleRef.current = setInterval(() => {
          setPage(prev => prev + 1)
        }, 2000)
      }
    }, delay)
  }

  const handleMouseLeave = () => cleanup()

  const pdfSrc = isPdf ? `${url}#page=${page}&view=FitV` : url

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
        {isImage ? (
          <Image size={20} className="text-gray-500 dark:text-gray-400" />
        ) : isPdf ? (
          <FileText size={20} className="text-gray-500 dark:text-gray-400" />
        ) : (
          <File size={20} className="text-gray-500 dark:text-gray-400" />
        )}
      </div>

      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50"
            onMouseEnter={() => {
              if (timerRef.current) clearTimeout(timerRef.current)
            }}
          >
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden" style={{ width: isPdf ? 360 : 300 }}>
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <p className="text-xs font-medium truncate max-w-[240px]">{name}</p>
                <span className="text-[10px] text-gray-400 ml-2 whitespace-nowrap bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                  {isImage ? '1 pg' : isPdf ? `Pg ${page}` : '—'}
                </span>
              </div>

              {/* Content */}
              <div className="bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
                {isImage ? (
                  <img
                    src={url}
                    alt={name}
                    className="max-w-full max-h-96 object-contain"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                ) : isPdf ? (
                  <div className="w-full" style={{ height: 480 }}>
                    <embed
                      key={`pdf-${page}`}
                      src={pdfSrc}
                      type="application/pdf"
                      className="w-full h-full"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <File size={48} className="mb-2 opacity-50" />
                    <p className="text-xs">Preview não disponível</p>
                  </div>
                )}
              </div>
            </div>

            <div className="absolute top-full left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 -mt-1.5" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
