import { NavLink, useNavigate } from 'react-router-dom'
import { BarChart3, LogOut, Moon, Sun } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'

const abas = [
  { to: '/dev', label: 'Métricas', end: true },
  { to: '/dev/creditos', label: 'Créditos dos alunos', end: false },
]

// Casca do painel do desenvolvedor: cabeçalho próprio, sem o menu do aluno
export default function DevLayout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const sair = () => { logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="sticky top-0 z-20 border-b border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 size={20} className="text-secondary-500 shrink-0" />
            <span className="font-semibold truncate">PrintFlow · Painel do desenvolvedor</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleTheme} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Alternar tema">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button type="button" onClick={sair} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 flex gap-1" aria-label="Seções do painel">
          {abas.map((a) => (
            <NavLink
              key={a.to}
              to={a.to}
              end={a.end}
              className={({ isActive }) => `px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${isActive ? 'border-secondary-500 font-semibold text-gray-900 dark:text-white' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
            >
              {a.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">{children}</main>
    </div>
  )
}
