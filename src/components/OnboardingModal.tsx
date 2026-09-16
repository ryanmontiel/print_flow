import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, X, FileText, CreditCard, Printer, CheckCircle } from 'lucide-react'

const steps = [
  {
    icon: FileText,
    title: 'Bem-vindo ao PrintFlow!',
    description: 'O sistema de impressão automatizado do IFSul. De onde estiver, envie documentos e compre créditos; a impressão acontece com conforto nas máquinas do câmpus, sem sair da instituição.',
  },
  {
    icon: FileText,
    title: 'Envie Documentos',
    description: 'Faça upload de PDFs, imagens e outros formatos. Seus documentos ficam salvos na sua conta para imprimir quando quiser.',
  },
  {
    icon: CreditCard,
    title: 'Compre Créditos',
    description: 'Adquira créditos pelo site para usar nas impressões. Cada página tem um custo fixo e você acompanha seu saldo.',
  },
  {
    icon: Printer,
    title: 'Imprima',
    description: 'Na máquina do campus, faça login, escolha o documento e confirme a impressão. Simples e rápido!',
  },
]

export default function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isOpen, setIsOpen] = useState(true)

  const handleClose = () => {
    setIsOpen(false)
    localStorage.setItem('printflow-onboarded', 'true')
    setTimeout(onComplete, 300)
  }

  const next = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleClose()
    }
  }

  const prev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1)
  }

  const StepIcon = steps[currentStep].icon

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            transition={{ duration: 0.25 }}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-8 relative"
          >
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-1 rounded-lg text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-100"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
                <StepIcon size={32} className="text-primary-600 dark:text-primary-400" />
              </div>

              <h2 className="font-heading text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">
                {steps[currentStep].title}
              </h2>
              <p className="text-gray-600 dark:text-gray-200 text-sm leading-relaxed">
                {steps[currentStep].description}
              </p>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-2 my-6">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === currentStep
                      ? 'w-8 bg-primary-500'
                      : 'w-2 bg-gray-300 dark:bg-gray-600'
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex justify-between items-center">
              <button
                onClick={prev}
                disabled={currentStep === 0}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 dark:text-gray-200 disabled:opacity-0 disabled:pointer-events-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                <ChevronLeft size={16} /> Anterior
              </button>

              <button
                onClick={handleClose}
                className="text-sm text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-100 transition-colors"
              >
                Pular tour
              </button>

              <button
                onClick={next}
                className="flex items-center gap-1 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {currentStep === steps.length - 1 ? (
                  <>
                    <CheckCircle size={16} /> Finalizar
                  </>
                ) : (
                  <>
                    Próximo <ChevronRight size={16} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
