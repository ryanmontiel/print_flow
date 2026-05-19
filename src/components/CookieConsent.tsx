import { motion, AnimatePresence } from 'framer-motion'
import { Cookie, Check, X } from 'lucide-react'

type Props = {
  onAccept: () => void
  onReject: () => void
}

export default function CookieConsent({ onAccept, onReject }: Props) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 80 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 80 }}
        className="fixed bottom-0 left-0 right-0 z-50 p-4"
      >
        <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
            <Cookie size={20} className="text-primary-600 dark:text-primary-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-0.5">Este site utiliza cookies</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Usamos cookies para lembrar suas preferências e melhorar sua experiência.
              Ao aceitar, o tutorial de boas-vindas será exibido apenas uma vez.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onReject}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
            >
              <X size={14} /> Recusar
            </button>
            <button
              onClick={onAccept}
              className="px-4 py-2 text-sm rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors flex items-center gap-1.5"
            >
              <Check size={14} /> Aceitar
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
