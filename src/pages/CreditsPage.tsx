import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, TrendingUp, TrendingDown, Loader2, Wallet, ExternalLink, CheckCircle } from 'lucide-react'
import { apiGetCredits, apiCreatePaymentLink, apiCheckPayment, type Transaction } from '../api'

const UNIT_PRICE = 0.50
const plans = [
  { credits: 10, label: 'Básico', price: 5 },
  { credits: 20, label: 'Popular', price: 10, popular: true },
  { credits: 40, label: 'Plus', price: 20 },
  { credits: 100, label: 'Premium', price: 50 },
]

export default function CreditsPage() {
  const [credits, setCredits] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [processingPayment, setProcessingPayment] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null)
  const [searchParams] = useSearchParams()

  useEffect(() => { loadCredits() }, [])

  // Handle redirect back from InfinitePay
  useEffect(() => {
    const order_nsu = searchParams.get('order_nsu')
    if (!order_nsu) return
    const slug = searchParams.get('slug') || undefined
    const transaction_nsu = searchParams.get('transaction_nsu') || undefined
    const check = async () => {
      setProcessingPayment(true)
      try {
        const res = await apiCheckPayment(order_nsu, slug, transaction_nsu)
        if (res.paid && res.amount) {
          setPaymentSuccess(String(Math.round(res.amount / UNIT_PRICE)))
          await loadCredits()
        } else {
          // Try again after a short delay (InfinitePay API might need time)
          await new Promise(r => setTimeout(r, 3000))
          const retry = await apiCheckPayment(order_nsu, slug, transaction_nsu)
          if (retry.paid && retry.amount) {
            setPaymentSuccess(String(Math.round(retry.amount / UNIT_PRICE)))
            await loadCredits()
          } else {
            setError('Pagamento não confirmado. Se já pagou, aguarde alguns instantes e recarregue a página.')
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao verificar pagamento')
      } finally {
        setProcessingPayment(false)
        window.history.replaceState({}, '', '/credits')
      }
    }
    check()
  }, [searchParams])

  const loadCredits = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGetCredits()
      setCredits(res.credits)
      setTransactions(res.transactions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar créditos')
    } finally {
      setLoading(false)
    }
  }

  const handleBuy = async (price: number) => {
    setProcessingPayment(true)
    setError('')
    setPaymentSuccess(null)
    try {
      const redirectUrl = window.location.origin + '/credits'
      const res = await apiCreatePaymentLink(price, redirectUrl)
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar pagamento')
      setProcessingPayment(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-6">Créditos</h1>

      {/* Balance card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl p-6 text-white mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <Wallet size={24} />
          <span className="text-primary-100 text-sm font-medium">Créditos</span>
        </div>
        {loading ? (
          <div className="h-10 w-32 bg-white/20 rounded-lg animate-pulse" />
        ) : (
          <p className="font-heading text-4xl font-bold">{Math.round(credits / UNIT_PRICE)} impressões</p>
        )}
      </motion.div>

      {paymentSuccess && (
        <div className="mb-4 px-4 py-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle size={18} />
          Pagamento de {paymentSuccess} impressões confirmado! Créditos adicionados à sua conta.
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {processingPayment && (
        <div className="mb-4 px-4 py-4 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg text-sm flex items-center gap-3">
          <Loader2 size={18} className="animate-spin" />
          Verificando pagamento...
        </div>
      )}

      {/* Plans */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="font-heading text-xl font-bold mb-4">Planos de recarga</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.credits}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              className={`relative bg-white dark:bg-gray-800 border rounded-xl p-5 ${
                plan.popular
                  ? 'border-primary-500 ring-2 ring-primary-500/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary-500 text-white text-xs font-medium rounded-full">
                  Popular
                </span>
              )}
              <h3 className="font-heading text-lg font-bold mb-1">{plan.label}</h3>
              <p className="font-heading text-2xl font-bold text-primary-500 mb-1">
                R$ {plan.price.toFixed(2)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-200 mb-4">
                {plan.credits} impressões
              </p>
              <button
                onClick={() => handleBuy(plan.price)}
                disabled={processingPayment}
                className="w-full py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {processingPayment ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                Pagar
              </button>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Transaction history */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="font-heading text-xl font-bold mb-4">Extrato</h2>
        {transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <CreditCard size={40} className="mx-auto mb-3 opacity-50" />
            <p>Nenhuma transação ainda.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(tx => (
              <div key={tx.createdAt + tx.description} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  tx.type === 'credit'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-600'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-600'
                }`}>
                  {tx.type === 'credit' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tx.description}</p>
                  <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                </div>
                <span className={`text-sm font-semibold ${
                  tx.type === 'credit' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {tx.type === 'credit' ? '+' : '-'}{Math.round(Math.abs(tx.amount) / UNIT_PRICE)} impressões
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
