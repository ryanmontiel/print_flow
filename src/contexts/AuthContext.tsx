import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type User = {
  matricula: string
  nome: string
}

type AuthContextType = {
  user: User | null
  login: (matricula: string, nome: string, remember?: boolean) => void
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
    let stored
    try { stored = localStorage.getItem('printflow-user') } catch {}
    if (!stored) try { stored = sessionStorage.getItem('printflow-user') } catch {}
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setUser(parsed)
      } catch {}
    }
    setIsLoading(false)
  }, [])

  const login = (matricula: string, nome: string, remember: boolean = false) => {
    const u = { matricula, nome }
    const storage = remember ? localStorage : sessionStorage
    storage.setItem('printflow-user', JSON.stringify(u))
    setUser(u)
  }

  const logout = () => {
    localStorage.removeItem('printflow-user')
    localStorage.removeItem('userCredentials')
    sessionStorage.removeItem('printflow-user')
    sessionStorage.removeItem('userCredentials')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
