import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Cookie, Check, X, Lock, Settings2 } from 'lucide-react'

type Props = {
  onAccept: () => void
  onReject: () => void
}

// Janela que bloqueia o site até a pessoa aceitar ou recusar. Não fecha com Esc
// nem clicando fora; os dois botões têm o mesmo tamanho e destaque.
export default function CookieConsent({ onAccept, onReject }: Props) {
  const primeiroBotao = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primeiroBotao.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-titulo"
        aria-describedby="cookie-descricao"
        onKeyDown={(e) => {
          // Mantém o Tab dentro da janela (o site atrás está bloqueado)
          if (e.key !== 'Tab') return
          const botoes = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const i = botoes.indexOf(document.activeElement as HTMLButtonElement)
          e.preventDefault()
          botoes[(i + (e.shiftKey ? -1 : 1) + botoes.length) % botoes.length]?.focus()
        }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 sm:p-8"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
            <Cookie size={24} className="text-primary-600 dark:text-primary-400" />
          </div>
          <h2 id="cookie-titulo" className="font-heading text-2xl font-bold text-gray-900 dark:text-gray-100">
            Cookies e dados no seu navegador
          </h2>
        </div>

        <p id="cookie-descricao" className="text-gray-700 dark:text-gray-200 mb-5">
          O PrintFlow não usa cookies de publicidade nem de rastreamento. Para continuar, escolha se podemos guardar suas preferências neste navegador.
        </p>

        <div className="space-y-3 mb-6">
          <div className="flex gap-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 p-4">
            <Lock size={20} className="text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Sempre, porque o site precisa</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Sua sessão enquanto o navegador estiver aberto e esta escolha, para não perguntarmos de novo.</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 p-4">
            <Settings2 size={20} className="text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Só se você aceitar</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Manter você conectado por até 30 dias ("Lembrar de mim"), o tema claro ou escuro e se você já viu o tutorial.
                Se recusar, nada disso fica salvo depois que você fechar o navegador.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            ref={primeiroBotao}
            type="button"
            onClick={onReject}
            className="py-3 text-base font-semibold rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X size={18} /> Recusar
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="py-3 text-base font-semibold rounded-xl border-2 border-primary-500 bg-primary-500 hover:bg-primary-600 text-white transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <Check size={18} /> Aceitar
          </button>
        </div>
        <p className="mt-4 text-xs text-center text-gray-500 dark:text-gray-400">Você pode mudar essa escolha a qualquer momento no seu Perfil.</p>
      </motion.div>
    </div>
  )
}
