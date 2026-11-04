// Pré-visualização de imagem na tela de impressão do kiosk, com indicador de
// carregamento e botão "Tentar novamente" se a imagem não abrir.
import { useState, useCallback } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

type Props = {
  src: string
  alt: string
}

export default function ImagePreview({ src, alt }: Props) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  // Mudar a key recria o <img>, forçando o navegador a baixar de novo
  const [retryKey, setRetryKey] = useState(0)

  const handleLoad = useCallback(() => setStatus('loaded'), [])
  const handleError = useCallback(() => setStatus('error'), [])
  const handleRetry = useCallback(() => {
    setStatus('loading')
    setRetryKey(k => k + 1)
  }, [])

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center bg-gray-100 rounded-xl p-8 text-gray-400 min-h-[200px]">
        <AlertCircle size={32} className="mb-2" />
        <p className="text-sm">Erro ao carregar imagem</p>
        <button
          onClick={handleRetry}
          className="mt-3 flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex justify-center bg-gray-100 rounded-xl p-4 min-h-[200px] max-h-[400px] overflow-auto">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <img
        key={retryKey}
        src={src}
        alt={alt}
        onLoad={handleLoad}
        onError={handleError}
        className={`max-w-full max-h-[360px] object-contain rounded-lg shadow-md transition-opacity duration-300 ${status === 'loading' ? 'opacity-0' : 'opacity-100'}`}
        style={status === 'loading' ? { position: 'absolute', pointerEvents: 'none' } : undefined}
      />
    </div>
  )
}
