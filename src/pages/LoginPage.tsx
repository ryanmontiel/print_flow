// Página de entrada do site, com três fluxos na mesma tela:
//   - login (aluno vai para /home; a credencial de dev vai para /dev);
//   - cadastro -> etapa "verify", onde o aluno digita o código recebido por email
//     e já entra logado;
//   - "Esqueci minha senha", que pede o envio do link de redefinição.
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiLogin, apiRegister, apiVerifyEmail, apiResendCode, apiForgotPassword, setToken } from '../api'
import { useConsent } from '../consent'
import { motion, AnimatePresence } from 'framer-motion'
import { Printer, FileText, MailCheck, MailSearch, Check, Lock } from 'lucide-react'

// Lista dos requisitos da senha, marcando em tempo real os que já foram cumpridos
function PasswordChecklist({ password }: { password: string }) {
  const requirements = [
    { label: '8 caracteres ou mais', met: password.length >= 8 },
    { label: '1 letra maiúscula', met: /[A-Z]/.test(password) },
    { label: '1 número', met: /[0-9]/.test(password) },
    { label: '1 símbolo especial', met: /[^A-Za-z0-9]/.test(password) },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="mt-2.5 p-3 bg-gray-50 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 rounded-lg"
    >
      <ul className="space-y-2">
        {requirements.map((req, i) => (
          <motion.li
            key={req.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2.5"
          >
            <div
              className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-200 ${
                req.met
                  ? 'bg-green-500 border-green-500'
                  : 'border-red-400 dark:border-red-500/80 bg-red-50 dark:bg-transparent'
              }`}
            >
              <AnimatePresence>
                {req.met && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    className="text-white"
                  >
                    <Check size={12} strokeWidth={3.5} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span
              className={`text-xs transition-colors duration-200 ${
                req.met ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {req.label}
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}

type Step = 'credentials' | 'verify'

// Emails automáticos (código de verificação, link de nova senha) às vezes caem no spam
function SpamHint() {
  return (
    <div className="flex gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-left">
      <MailSearch size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-amber-900 dark:text-amber-200">Não encontrou o email?</p>
        <p className="text-amber-800 dark:text-amber-300/90">
          Dê uma olhada nas pastas <strong>Spam</strong> e <strong>Lixo eletrônico</strong>: às vezes nossa mensagem vai parar lá.
          Se encontrar, marque como "Não é spam" para que os próximos emails cheguem direto na sua caixa de entrada.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [step, setStep] = useState<Step>('credentials')
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [remember, setRemember] = useState(false)
  // "Lembrar de mim" guarda o login por 30 dias: só com cookies aceitos
  const podeLembrar = useConsent() === 'accepted'
  useEffect(() => { if (!podeLembrar) setRemember(false) }, [podeLembrar])
  const [pendingEmail, setPendingEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [senhaValue, setSenhaValue] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const cooldownRef = useRef<number | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()

  const showNotice = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotice({ message, type })
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3800)
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      if (cooldownRef.current) window.clearInterval(cooldownRef.current)
    }
  }, [])

  // Bloqueia o "Reenviar código" por 60 s, com contagem regressiva no botão
  const startResendCooldown = () => {
    setResendCooldown(60)
    if (cooldownRef.current) window.clearInterval(cooldownRef.current)
    cooldownRef.current = window.setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { window.clearInterval(cooldownRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  const handleResendCode = async () => {
    if (resendCooldown > 0) return
    try {
      await apiResendCode(pendingEmail)
      showNotice('Código reenviado para seu email.', 'success')
      startResendCooldown()
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Falha ao reenviar código', 'error')
    }
  }

  // Envio do formulário principal. No cadastro, valida na tela as mesmas regras do
  // servidor (email institucional, senha forte, confirmação) antes de criar a conta.
  // No login, guarda o token e o usuário e redireciona conforme o papel.
  const handleSubmitCredentials = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const email = String(formData.get('email') ?? '').trim()
    const senha = String(formData.get('senha') ?? '').trim()

    if (!email || !senha) {
      showNotice('Preencha email e senha.', 'error')
      return
    }

    setLoading(true)
    try {
      if (mode === 'register') {
        const nome = String(formData.get('nome') ?? '').trim()
        const confirmeSenha = String(formData.get('confirmeSenha') ?? '').trim()
        if (!nome || !confirmeSenha) {
          showNotice('Preencha todos os campos.', 'error')
          setLoading(false)
          return
        }
        if (!/@(?:academico\.)?ifsul\.edu\.br$/i.test(email)) {
          showNotice('Use um email institucional (@academico.ifsul.edu.br ou @ifsul.edu.br).', 'error')
          setLoading(false)
          return
        }
        if (!/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) {
          showNotice('Senha fraca: use no mínimo 8 caracteres, com uma letra maiúscula, um número e um símbolo especial.', 'error')
          setLoading(false)
          return
        }
        if (senha !== confirmeSenha) {
          showNotice('Senhas não conferem.', 'error')
          setLoading(false)
          return
        }
        const reg = await apiRegister(email, nome, senha)
        setPendingEmail(email)
        setStep('verify')
        if (reg.emailSent === false) {
          showNotice('Conta criada, mas não conseguimos enviar o email. Toque em "Reenviar código".', 'error')
        } else {
          startResendCooldown()
          showNotice('Conta criada! Verifique seu email para o código de verificação.', 'success')
        }
      } else {
        const result = await apiLogin(email, senha, remember)
        if (result.role === 'dev') {
          // Sessão de dev nunca fica salva entre aberturas do navegador
          setToken(result.token, false)
          login(result.email, result.displayName, false, undefined, undefined, 'dev')
          setTimeout(() => navigate('/dev'), 300)
          return
        }
        setToken(result.token, remember)
        login(result.email, result.displayName, remember, result.printColor as 'color' | 'bw', result.printDuplex as 'single' | 'duplex')
        setTimeout(() => navigate('/home'), 500)
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Erro de conexão', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!verifyCode.trim()) {
      showNotice('Digite o código de verificação.', 'error')
      return
    }
    setLoading(true)
    try {
      await apiVerifyEmail(pendingEmail, verifyCode.trim())
      showNotice('Email verificado com sucesso!', 'success')
      // Já verificado: entra direto com a senha digitada no cadastro
      const result = await apiLogin(pendingEmail, senhaValue, remember)
      setToken(result.token, remember)
      login(result.email, result.displayName, remember, result.printColor as 'color' | 'bw', result.printDuplex as 'single' | 'duplex')
      setTimeout(() => navigate('/home'), 500)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Código inválido', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) {
      showNotice('Digite seu email.', 'error')
      return
    }
    setForgotLoading(true)
    try {
      await apiForgotPassword(forgotEmail.trim().toLowerCase())
      setForgotSent(true)
      setForgotError(null)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Falha ao solicitar recuperação', 'error')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-gray-900">
      {/* Hero side */}
      <div className="lg:w-[55%] bg-gradient-to-br from-primary-800 via-primary-700 to-secondary-800 p-8 lg:p-14 flex flex-col justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-64 h-64 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-20 right-20 w-48 h-48 rounded-full bg-primary-300 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-xl mx-auto lg:mx-0">
          <h1 className="font-heading text-5xl lg:text-7xl font-bold text-white mb-4 tracking-tight">
            PrintFlow
          </h1>
          <p className="text-lg lg:text-xl text-primary-100 leading-relaxed mb-8">
            Sistema de impressão automatizado do IFSul Campus Lajeado.
            De qualquer lugar, envie seus documentos e compre créditos; a impressão é feita com conforto nas máquinas do câmpus, sem sair da instituição.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/10">
              <FileText size={24} className="text-primary-200 mb-2" />
              <h3 className="text-white font-semibold text-sm">Documentos</h3>
              <p className="text-primary-200 text-xs mt-1">Upload e organize seus arquivos</p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/10">
              <Printer size={24} className="text-primary-200 mb-2" />
              <h3 className="text-white font-semibold text-sm">Impressão</h3>
              <p className="text-primary-200 text-xs mt-1">Imprima com conforto no câmpus, sem sair da instituição</p>
            </div>
          </div>
        </div>
      </div>

      {/* Auth side */}
      <div className="flex-1 bg-white dark:bg-gray-900 p-8 lg:p-14 flex flex-col justify-center">
        <div className="max-w-sm mx-auto w-full">
          <h2 className="font-heading text-3xl font-bold text-gray-900 dark:text-white mb-1">
            {step === 'verify' ? 'Verificar email' : forgotMode ? 'Recuperar senha' : mode === 'login' ? 'Acessar' : 'Criar conta'}
          </h2>
          <p className="text-gray-500 dark:text-gray-200 text-sm mb-8">
            {step === 'verify'
              ? `Enviamos um código de 6 dígitos para ${pendingEmail}`
              : forgotMode ? 'Enviaremos um link para você criar uma nova senha.'
              : mode === 'login' ? 'Entre com seu email e senha.' : 'Preencha os dados para se cadastrar.'}
          </p>

          {notice && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
              notice.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' :
              notice.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800' :
              'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
            }`}>
              {notice.message}
            </div>
          )}

          {step === 'verify' ? (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="flex items-center justify-center mb-4">
                <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <MailCheck size={28} className="text-primary-600 dark:text-primary-400" />
                </div>
              </div>

              <div>
                <label htmlFor="codigo" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Código de verificação</label>
                <input
                  id="codigo"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-center text-2xl tracking-[0.3em] font-mono"
                  autoFocus
                />
              </div>

              <SpamHint />

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? 'Verificando...' : 'Verificar'}
              </button>

              <button
                type="button"
                disabled={resendCooldown > 0}
                onClick={handleResendCode}
                className="w-full py-2 text-sm text-primary-500 hover:text-primary-600 disabled:text-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar código'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('credentials'); setVerifyCode('') }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-200 dark:hover:text-gray-100 font-medium transition-colors"
              >
                Voltar
              </button>
            </form>
          ) : forgotMode ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="flex items-center justify-center mb-4">
                <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <Lock size={28} className="text-primary-600 dark:text-primary-400" />
                </div>
              </div>

              {!forgotSent ? (
                <>
                  <div>
                    <label htmlFor="forgotEmail" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Email</label>
                    <input
                      id="forgotEmail"
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                      autoFocus
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Enviaremos um link de recuperação para seu email.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                  >
                    {forgotLoading ? 'Enviando...' : 'Enviar link de recuperação'}
                  </button>
                </>
              ) : forgotError ? (
                <>
                  <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm text-center">
                    {forgotError}
                  </div>
                  <button
                    type="button"
                    disabled={forgotLoading}
                    onClick={() => { setForgotSent(false); setForgotError(null) }}
                    className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                  >
                    Tentar novamente
                  </button>
                </>
              ) : (
                <>
                  <div className="px-4 py-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg text-sm text-center">
                    Se o email estiver cadastrado, você receberá um link para redefinir sua senha. Verifique sua caixa de entrada.
                  </div>
                  <SpamHint />
                </>
              )}

              <button
                type="button"
                onClick={() => { setForgotMode(false); setForgotSent(false); setForgotError(null); setNotice(null) }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-200 dark:hover:text-gray-100 font-medium transition-colors"
              >
                Voltar para login
              </button>
            </form>
          ) : (
            <form key={mode} onSubmit={handleSubmitCredentials} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="seu@email.com"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
                {mode === 'register' && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Use seu email institucional: @academico.ifsul.edu.br ou @ifsul.edu.br
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor="nome" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Nome Completo</label>
                  <input
                    id="nome"
                    name="nome"
                    type="text"
                    required
                    placeholder="Seu nome completo"
                    className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              )}

              <div>
                <label htmlFor="senha" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Senha</label>
                <input
                  id="senha"
                  name="senha"
                  type="password"
                  required
                  value={senhaValue}
                  onChange={e => setSenhaValue(e.target.value)}
                  placeholder="Sua senha"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
                {mode === 'register' && (
                  senhaValue.length > 0 ? (
                    <AnimatePresence>
                      <PasswordChecklist password={senhaValue} />
                    </AnimatePresence>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Mínimo 8 caracteres, com letra maiúscula, número e símbolo especial.
                    </p>
                  )
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor="confirmeSenha" className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-200">Confirme sua senha</label>
                  <input
                    id="confirmeSenha"
                    name="confirmeSenha"
                    type="password"
                    required
                    placeholder="Repita a senha"
                    className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              )}

              {mode === 'login' && (
                <div className="flex items-center justify-between">
                  <label
                    className={`flex items-center gap-2 ${podeLembrar ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                    title={podeLembrar ? undefined : 'Disponível ao aceitar cookies (Perfil → Cookies)'}
                  >
                    <input
                      type="checkbox"
                      checked={remember}
                      disabled={!podeLembrar}
                      onChange={e => setRemember(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-200">
                      Lembrar de mim
                      {!podeLembrar && <span className="block text-xs text-gray-500 dark:text-gray-400">requer aceitar cookies</span>}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(true); setForgotSent(false); setForgotEmail(''); setNotice(null) }}
                    className="text-sm text-primary-500 hover:text-primary-600 font-medium transition-colors"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? 'Aguarde...' : mode === 'login' ? 'Acessar' : 'Criar conta'}
              </button>
            </form>
          )}

          {step === 'credentials' && !forgotMode && (
            <div className="mt-6 text-center">
              <button
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setSenhaValue('') }}
                className="text-sm text-primary-500 hover:text-primary-600 font-medium transition-colors"
              >
                {mode === 'login' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Faça login'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
