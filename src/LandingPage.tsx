import { FormEvent, useState } from 'react'

type LandingProps = {
  onAuthenticate: (userName: string) => void
}

export default function LandingPage({ onAuthenticate }: LandingProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    const matricula = String(formData.get('matricula') ?? '').trim()
    const senha = String(formData.get('senha') ?? '').trim()

    if (!matricula || !senha) {
      window.alert('Por favor preencha Matrícula e Senha.')
      return
    }

    if (mode === 'register') {
      const nomeCompleto = String(formData.get('nomeCompleto') ?? '').trim()
      const confirmeSenha = String(formData.get('confirmeSenha') ?? '').trim()

      if (!nomeCompleto || !confirmeSenha) {
        window.alert('Por favor preencha Nome Completo e Confirme sua senha.')
        return
      }

      if (senha !== confirmeSenha) {
        window.alert('Senha e Confirme sua senha devem ser iguais.')
        return
      }

      try {
        const response = await fetch('http://localhost:4000/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matricula, nomeCompleto, senha })
        })
        if (response.ok) {
          onAuthenticate(nomeCompleto)
          window.alert(`Registrado como ${nomeCompleto}`)
        } else {
          const error = await response.json()
          window.alert(`Erro: ${error.error}`)
        }
      } catch (error) {
        window.alert('Erro de conexão')
      }
      return
    }

    try {
      const response = await fetch('http://localhost:4000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, senha })
      })

      if (response.ok) {
        onAuthenticate(matricula)
        window.alert(`Logado como ${matricula}`)
      } else {
        const error = await response.json()
        window.alert(`Erro de login: ${error.error || 'Credenciais inválidas'}`)
      }
    } catch (error) {
      window.alert('Erro de conexão ao tentar logar')
    }
  }

  return (
    <main className="app">
      <section className="auth-card">
        <h1>PrintFlow</h1>
        <p>Gerencie ordens de impressão de maneira rápida e confiável.</p>

        <div className="tab-row">
          <button type="button" className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
            Login
          </button>
          <button type="button" className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>
            Registrar
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="matricula">Matrícula</label>
            <input id="matricula" name="matricula" type="text" required placeholder="123456" />
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="nomeCompleto">Nome Completo</label>
                <input id="nomeCompleto" name="nomeCompleto" type="text" required placeholder="Fulano da Silva" />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="senha">Senha</label>
            <input id="senha" name="senha" type="password" required placeholder="••••••••" />
          </div>

          {mode === 'register' && (
            <div className="field">
              <label htmlFor="confirmeSenha">Confirme sua senha</label>
              <input id="confirmeSenha" name="confirmeSenha" type="password" required placeholder="••••••••" />
            </div>
          )}

          <button type="submit" className="primaryButton">
            {mode === 'login' ? 'Acessar' : 'Criar conta'}
          </button>
        </form>
      </section>
    </main>
  )
}
