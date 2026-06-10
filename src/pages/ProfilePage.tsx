import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { LogOut, Sun, Moon, Printer, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const prefGroups = [
    {
      title: 'Aparência',
      items: [
        {
          icon: theme === 'light' ? Sun : Moon,
          label: 'Tema',
          description: theme === 'light' ? 'Claro' : 'Escuro',
          action: (
            <button
              onClick={toggleTheme}
              className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm transition-colors"
            >
              {theme === 'light' ? 'Escuro' : 'Claro'}
            </button>
          ),
        },
      ],
    },
    {
      title: 'Preferências de Impressão',
      items: [
        {
          icon: Printer,
          label: 'Cor',
          description: 'Impressão colorida',
          action: (
            <select className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm border-0 outline-none focus:ring-2 focus:ring-primary-500">
              <option>Colorido</option>
              <option>Preto e branco</option>
            </select>
          ),
        },
        {
          icon: FileText,
          label: 'Frente e verso',
          description: 'Modo de impressão',
          action: (
            <select className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm border-0 outline-none focus:ring-2 focus:ring-primary-500">
              <option>Simples</option>
              <option>Frente e verso</option>
            </select>
          ),
        },
      ],
    },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-6">Perfil</h1>

      {/* User card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 mb-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-500 text-white flex items-center justify-center text-2xl font-bold">
            {user?.nome?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div>
            <h2 className="font-heading text-xl font-bold">{user?.nome || 'Usuário'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-200">Matrícula: {user?.matricula || '—'}</p>
          </div>
        </div>
      </motion.div>

      {/* Preferences */}
      {prefGroups.map((group, gi) => (
        <motion.div
          key={group.title}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + gi * 0.05 }}
          className="mb-6"
        >
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-200 uppercase tracking-wider mb-3 px-1">
            {group.title}
          </h3>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
            {group.items.map((item, ii) => (
              <div key={ii} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <item.icon size={18} className="text-gray-500 dark:text-gray-200" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-gray-400">{item.description}</p>
                  </div>
                </div>
                {item.action}
              </div>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Logout */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg font-medium transition-colors"
        >
          <LogOut size={18} /> Sair da conta
        </button>
      </motion.div>
    </div>
  )
}
