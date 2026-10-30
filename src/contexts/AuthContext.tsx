import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getToken, clearToken } from '../api'

type User = {
  email: string
  nome: string
  printColor?: 'color' | 'bw'
  printDuplex?: 'single' | 'duplex'
  role?: 'dev'
}

type AuthContextType = {
  user: User | null
  login: (email: string, nome: string, remember?: boolean, printColor?: 'color' | 'bw', printDuplex?: 'single' | 'duplex', role?: 'dev') => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('printflow-user') || sessionStorage.getItem('printflow-user')
    // Sessão de versão antiga (sem token): precisa entrar de novo
    if (stored && !getToken()) {
      localStorage.removeItem('printflow-user')
      sessionStorage.removeItem('printflow-user')
      clearToken()
    } else if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setUser(parsed)
      } catch {}
    }
    setIsLoading(false)
  }, [])

  const login = (email: string, nome: string, remember: boolean = false, printColor?: 'color' | 'bw', printDuplex?: 'single' | 'duplex', role?: 'dev') => {
    const u = { email, nome, printColor, printDuplex, role }
    const storage = remember ? localStorage : sessionStorage
    storage.setItem('printflow-user', JSON.stringify(u))
    setUser(u)
  }

  const logout = () => {
    localStorage.removeItem('printflow-user')
    sessionStorage.removeItem('printflow-user')
    clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
