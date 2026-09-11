import { FormEvent, useEffect, useRef, useState } from 'react'

type LandingProps = {
  onAuthenticate: (userName: string) => void
}

type Notice = {
  type: 'success' | 'error' | 'info'
  message: string
}

export default function LandingPage({ onAuthenticate }: LandingProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeTimerRef = useRef<number | null>(null)

  const showNotice = (message: string, type: Notice['type'] = 'info', autoHide = true) => {
    setNotice({ message, type })

    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = null
    }

    if (autoHide) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null)
      }, 3800)
    }
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    const email = String(formData.get('email') ?? '').trim()
    const senha = String(formData.get('senha') ?? '').trim()

    if (!email || !senha) {
      showNotice('Por favor preencha Email e Senha.', 'error')
      return
    }

    if (mode === 'register') {
      const nome = String(formData.get('nome') ?? '').trim()
      const confirmeSenha = String(formData.get('confirmeSenha') ?? '').trim()

      if (!nome || !confirmeSenha) {
        showNotice('Por favor preencha Nome Completo e Confirme sua senha.', 'error')
        return
      }

      if (senha !== confirmeSenha) {
        showNotice('Senha e Confirme sua senha devem ser iguais.', 'error')
        return
      }

      try {
        const response = await fetch('http://localhost:4002/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, nome, senha })
        })
        if (response.ok) {
          showNotice(`Registrado como ${nome}. Verifique seu email para o código de verificação.`, 'success', false)
        } else {
          const errorText = await response.text()
          try {
            const parsed = JSON.parse(errorText)
            showNotice(`Erro: ${parsed.error || 'Falha ao registrar'}`, 'error')
          } catch {
            showNotice(`Erro: ${response.status} ${response.statusText}`, 'error')
          }
        }
      } catch (error) {
        showNotice('Erro de conexao', 'error')
      }
      return
    }

    try {
      const response = await fetch('http://localhost:4002/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      })

      if (response.ok) {
        const result = await response.json()
        const displayName = String(result.displayName ?? email)
        localStorage.setItem('userCredentials', JSON.stringify({ email, senha }))
        showNotice(`Logado como ${displayName}`, 'success', false)
        window.setTimeout(() => onAuthenticate(displayName), 520)
      } else {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          showNotice(`Erro de login: ${parsed.error || 'Credenciais invalidas'}`, 'error')
        } catch {
          showNotice(`Erro de login: ${response.status} ${response.statusText}`, 'error')
        }
      }
    } catch (error) {
      showNotice('Erro de conexao ao tentar logar', 'error')
    }
  }

  return (
    <main className="app landing-shell">
      <section className="landing-layout">
        <section className="landing-hero" aria-label="Apresentacao do PrintFlow">
          <h1 className="landing-brand">PRINTFLOW</h1>

          <div className="landing-message">
            <p>
              Printflow e um site exclusivamente voltado para o sistema de impressao dos alunos do Instituto Federal
              Sul-Rio grandense Campus Lajeado.
            </p>
            <p>Solicite a sua impressao ou faca a recarga dos seus creditos por aqui!</p>
            <p>Fora do campus voce pode enviar documentos e comprar creditos; a impressao e feita com conforto nas maquinas do campus, sem sair da instituicao.</p>
          </div>

          <div className="landing-art" aria-hidden="true">
            <div className="paper-stack">
              <span className="paper-sheet paper-sheet-back" />
              <span className="paper-sheet paper-sheet-middle" />
              <span className="paper-sheet paper-sheet-front" />
            </div>

            <div className="printer-scene">
              <div className="printer-top">
                <div className="printer-glass" />
              </div>
              <div className="printer-body">
                <div className="printer-panel" />
                <div className="printer-buttons">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="printer-output" />
              </div>
              <div className="printer-pages">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </section>

        <section className={mode === 'register' ? 'auth-card auth-panel auth-panel-register' : 'auth-card auth-panel'}>
          <div className="tab-row auth-switcher" role="tablist" aria-label="Alternar autenticacao">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              disabled={mode === 'login'}
              className={mode === 'login' ? 'tab active' : 'tab'}
              onClick={() => setMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              disabled={mode === 'register'}
              className={mode === 'register' ? 'tab active' : 'tab'}
              onClick={() => setMode('register')}
            >
              Registrar
            </button>
          </div>

          <div className="notice-slot" aria-live="polite">
            {notice && <div className={`inline-notice notice-${notice.type}`}>{notice.message}</div>}
          </div>

          <form
            key={mode}
            className={mode === 'register' ? 'auth-form auth-form-register auth-form-enter' : 'auth-form auth-form-enter'}
            onSubmit={handleSubmit}
          >
            <div className="field auth-field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required placeholder="seu@email.com" />
            </div>

            {mode === 'register' && (
              <div className="field auth-field">
                <label htmlFor="nome">Nome Completo</label>
                <input id="nome" name="nome" type="text" required placeholder="" />
              </div>
            )}

            <div className="field auth-field">
              <label htmlFor="senha">Senha</label>
              <input id="senha" name="senha" type="password" required placeholder="" />
            </div>

            {mode === 'register' && (
              <div className="field auth-field">
                <label htmlFor="confirmeSenha">Confirme sua senha</label>
                <input id="confirmeSenha" name="confirmeSenha" type="password" required placeholder="" />
              </div>
            )}

            <button type="submit" className="primaryButton auth-submit">
              {mode === 'login' ? 'Acessar' : 'Criar conta'}
            </button>
          </form>
        </section>
      </section>
    </main>
  )
}
