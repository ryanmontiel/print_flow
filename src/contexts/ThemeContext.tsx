import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { prefs } from '../consent'

type Theme = 'light' | 'dark'

type ThemeContextType = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = prefs.get('printflow-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  // Só grava quando a pessoa escolhe o tema (antes gravava ao abrir o site,
  // mesmo sem consentimento)
  const toggleTheme = () => setTheme(prev => {
    const next = prev === 'light' ? 'dark' : 'light'
    prefs.set('printflow-theme', next)
    return next
  })

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
