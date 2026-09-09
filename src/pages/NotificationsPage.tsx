import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, CheckCircle, XCircle, Send, FileText, Loader2 } from 'lucide-react'
import { apiGetNotifications, apiHandleShare, type Notification } from '../api'

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [handlingId, setHandlingId] = useState<string | null>(null)

  useEffect(() => { loadNotifications() }, [])

  const loadNotifications = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGetNotifications()
      setNotifications(res.notifications || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar notificações')
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (notif: Notification, action: 'accepted' | 'rejected') => {
    setHandlingId(notif.id)
    try {
      await apiHandleShare(notif.id, action)
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, status: action } : n)
      )
      window.dispatchEvent(new Event('pf-notifications-updated'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar')
    } finally {
      setHandlingId(null)
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'share_request': return Send
      case 'share_accepted': return CheckCircle
      case 'share_rejected': return XCircle
      default: return Bell
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-6">Notificações</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Bell size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium text-gray-500 dark:text-gray-200">Nenhuma notificação</p>
          <p className="text-sm mt-1">Você receberá notificações quando alguém compartilhar um documento com você.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {notifications.map((notif, i) => {
              const Icon = getIcon(notif.type)
              return (
                <motion.div
                  key={notif.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.04 }}
                  className={`bg-white dark:bg-gray-800 border rounded-xl p-4 ${
                    notif.status === 'pending'
                      ? 'border-primary-200 dark:border-primary-800'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      notif.type === 'share_request'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                        : notif.status === 'accepted'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600'
                        : notif.status === 'rejected'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                    }`}>
                      <Icon size={20} />
                    </div>

                    <div className="flex-1 min-w-0">
                      {notif.type === 'share_request' && (
                        <>
                          <p className="text-sm font-medium">
                            <span className="font-bold">{notif.fromName}</span> compartilhou um documento com você
                          </p>
                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                            <FileText size={12} /> {notif.documentName}
                          </p>
                          {notif.message && (
                            <p className="text-xs text-gray-500 dark:text-gray-200 mt-1 italic">
                              "{notif.message}"
                            </p>
                          )}
                          {notif.status === 'pending' && (
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => handleAction(notif, 'accepted')}
                                disabled={handlingId === notif.id}
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors flex items-center gap-1"
                              >
                                {handlingId === notif.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                Aceitar
                              </button>
                              <button
                                onClick={() => handleAction(notif, 'rejected')}
                                disabled={handlingId === notif.id}
                                className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 text-xs rounded-lg transition-colors flex items-center gap-1"
                              >
                                <XCircle size={12} />
                                Recusar
                              </button>
                            </div>
                          )}
                          {notif.status === 'accepted' && (
                            <span className="inline-block mt-2 text-xs text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded">
                              Aceito
                            </span>
                          )}
                          {notif.status === 'rejected' && (
                            <span className="inline-block mt-2 text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded">
                              Recusado
                            </span>
                          )}
                        </>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(notif.createdAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
