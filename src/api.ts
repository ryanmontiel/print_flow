// Cliente HTTP do site dos alunos: uma função por rota do backend (server.js),
// com os tipos das respostas. Também guarda o token da sessão (sessionStorage, ou
// localStorage com "Lembrar-me" e consentimento) e reúne preços, limites e
// formatações (R$, MB, títulos) usados nas páginas.
import { hasConsent } from './consent'

const API = ''


type ApiOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string>
}

export const TOKEN_KEY = 'printflow-token'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string, remember: boolean) {
  clearToken()
  // "Lembrar-me" só guarda o login de forma permanente com consentimento
  ;(remember && hasConsent() ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
}

export function clearToken() {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(TOKEN_KEY)
    // Versões antigas guardavam a senha em texto puro
    storage.removeItem('userCredentials')
  }
}

// Base de todas as chamadas: envia o token, desiste após 60 s e transforma resposta
// de erro em exceção com a mensagem do servidor. Se a sessão expirou, limpa o login
// salvo e manda para /login.
async function request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, params } = options
  let url = `${API}${endpoint}`
  if (params) {
    const search = new URLSearchParams(params)
    url += `?${search}`
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)
  let res: Response
  try {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (body) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error('Erro de conexão com o servidor. Verifique se o backend está rodando.')
  } finally {
    clearTimeout(timeoutId)
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`
    let code: string | undefined
    try {
      const parsed = await res.json()
      msg = parsed.error || msg
      code = parsed.code
    } catch {}
    if (code === 'SESSION_EXPIRED') {
      clearToken()
      localStorage.removeItem('printflow-user')
      sessionStorage.removeItem('printflow-user')
      if (!location.pathname.startsWith('/login')) location.assign('/login')
    }
    throw new Error(msg)
  }
  return res.json()
}

export type StoredDocument = {
  id: string
  name: string
  filename: string
  originalname: string
  mimetype: string
  size: number
  url: string
  uploadedAt: string
  compartilhado_de_email?: string
  compartilhado_de_nome?: string
  mensagem_compartilhamento?: string
}

export const isOwnDocument = (doc: StoredDocument) =>
  !!doc && !doc.compartilhado_de_email

export const documentDisplayName = (doc: StoredDocument) =>
  doc.name || doc.originalname || 'Documento sem nome'

export const TITLE_MAX_LENGTH = 60

export const truncateTitle = (text?: string, max = TITLE_MAX_LENGTH) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value
}

export type Notification = {
  id: string
  tipo: 'share_request' | 'share_accepted' | 'share_rejected' | 'print_complete' | 'credits_added'
  de_email?: string
  de_nome?: string
  documento_id?: string
  documento_nome?: string
  mensagem?: string
  status: 'pending' | 'accepted' | 'rejected' | 'read'
  criado_em: string
}

export type PrintRecord = {
  id: string
  documentId: string
  documentName: string
  pages: number
  cost: number
  color?: 'bw' | 'color'
  duplex?: 'single' | 'duplex'
  status: 'completed' | 'failed'
  printedAt: string
}

export type Transaction = {
  amount: number
  type: 'credit' | 'debit'
  description: string
  createdAt: string
  // Ajustes feitos pela equipe pelo painel de desenvolvedor
  origem?: 'equipe'
  motivo?: string
}

export type PrintConfig = {
  color: 'bw' | 'color'
  duplex: 'single' | 'duplex'
}

// Preço por página, igual ao server.js (quem cobra de fato é o servidor)
export const PRINT_PRICES: Record<`${PrintConfig['color']}_${PrintConfig['duplex']}`, number> = {
  bw_single: 0.5,
  bw_duplex: 0.35,
  color_single: 0.75,
  color_duplex: 0.6,
}

export const getPrintPrice = (config: PrintConfig) => PRINT_PRICES[`${config.color}_${config.duplex}`]

// Mesma conta do kiosk e do servidor: páginas impressas (já com as cópias) x preço por página
export const getPrintCost = (config: PrintConfig, pages: number) =>
  Math.round(pages * getPrintPrice(config) * 100) / 100

export const printConfigLabel = (c?: { color?: string; duplex?: string }) => {
  const color = c?.color === 'color' ? 'Colorido' : 'Preto e branco'
  const duplex = c?.duplex === 'duplex' ? 'Frente e verso' : 'Simples'
  return `${color} · ${duplex}`
}

export const formatBRL = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Auth
export const apiLogin = (email: string, senha: string, remember = false) =>
  request<{ message: string; token: string; email: string; displayName: string; printColor?: string; printDuplex?: string; role?: 'dev' }>('/api/login', {
    method: 'POST',
    body: { email, senha, remember },
  })

export const apiRegister = (email: string, nome: string, senha: string) =>
  request<{ message: string; emailSent?: boolean }>('/api/register', {
    method: 'POST',
    body: { email, nome, senha },
  })

export const apiVerifyEmail = (email: string, codigo: string) =>
  request<{ message: string }>('/api/verify-email', {
    method: 'POST',
    body: { email, codigo },
  })

export const apiResendCode = (email: string) =>
  request<{ message: string }>('/api/resend-code', {
    method: 'POST',
    body: { email },
  })

export const apiForgotPassword = (email: string) =>
  request<{ message: string }>('/api/forgot-password', {
    method: 'POST',
    body: { email },
  })

export const apiResetPassword = (code: string, senha: string) =>
  request<{ message: string }>('/api/reset-password', {
    method: 'POST',
    body: { code, senha },
  })

export const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024
export const PER_FILE_LIMIT_BYTES = 10 * 1024 * 1024

export const formatBytes = (bytes: number) => {
  if (!bytes || bytes < 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

// Documents
export const apiGetDocuments = () => {
  return request<{ documents: StoredDocument[]; usedBytes: number; limitBytes: number }>('/api/documents', {
    method: 'POST',
    body: {},
  })
}

// Envia o arquivo direto para o R2 via URL pré-assinada (contorna o limite de 4.5MB da Vercel).
// Etapas: 1) pede ao backend a URL de envio (/api/upload/presign), 2) faz o PUT do
// arquivo no R2. Depois a página chama apiAddDocument para registrar o documento.
export const apiUploadFile = async (file: File) => {

  if (file.size > PER_FILE_LIMIT_BYTES) {
    throw new Error(`Arquivo muito grande. O limite é ${PER_FILE_LIMIT_BYTES / (1024 * 1024)} MB por arquivo.`)
  }

  const presign = await request<{ uploadUrl: string; url: string; key: string }>('/api/upload/presign', {
    method: 'POST',
    body: {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    },
  })

  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!put.ok) {
    throw new Error('Falha ao enviar o arquivo. Tente novamente.')
  }

  const uploaded: StoredDocument = {
    id: '',
    name: '',
    filename: presign.url,
    originalname: file.name,
    mimetype: file.type || 'application/octet-stream',
    size: file.size,
    url: presign.url,
    uploadedAt: new Date().toISOString(),
  }
  return { message: 'File uploaded successfully', file: uploaded }
}

export const apiAddDocument = (documentName: string, uploadedFile: StoredDocument) => {
  return request<{ message: string; document: StoredDocument }>('/api/add-document', {
    method: 'POST',
    body: { documentName, ...uploadedFile },
  })
}

export const apiDeleteDocument = async (documentId: string) => {
  await request<{ message: string }>('/api/delete-document', {
    method: 'POST',
    body: { documentId },
  })
}

// Credits
export const apiGetCredits = () => {
  return request<{ credits: number; transactions: Transaction[] }>('/api/credits', {
  })
}

export const apiGetPrintHistory = () => {
  return request<{ printHistory: PrintRecord[] }>('/api/print-history', {
  })
}

// Share
export const apiShareDocument = (targetEmail: string, documentId: string, documentName: string, message?: string) => {
  return request<{ message: string }>('/api/share-document', {
    method: 'POST',
    body: { targetEmail, documentId, documentName, message },
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted' | 'rejected') => {
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { notificationId, action },
  })
}

// InfinitePay
export const apiCreatePaymentLink = (amount: number, redirectUrl: string) => {
  return request<{ url: string; order_nsu: string }>('/api/create-payment-link', {
    method: 'POST',
    body: { amount, redirect_url: redirectUrl },
  })
}

export const apiCheckPayment = (order_nsu: string, slug?: string, transaction_nsu?: string) => {
  return request<{ paid: boolean; amount?: number }>('/api/check-payment', {
    method: 'POST',
    body: { order_nsu, slug, transaction_nsu },
  })
}

export const apiReprocessPayment = (order_nsu: string) => {
  return request<{ paid: boolean; amount?: number; message: string }>('/api/reprocess-payment', {
    method: 'POST',
    body: { order_nsu },
  })
}

export const apiGetPrintPreferences = () => {
  return request<{ printColor: string; printDuplex: string }>('/api/user/print-preferences', {
  })
}

export const apiSavePrintPreferences = (printColor: 'color' | 'bw', printDuplex: 'single' | 'duplex') =>
  request<{ message: string }>('/api/user/print-preferences', {
    method: 'POST',
    body: { printColor, printDuplex },
  })

// Notifications
export const apiGetNotifications = () => {
  return request<{ notifications: Notification[] }>('/api/notifications', {
  })
}

// Users list for autocomplete
export const apiSearchUsers = (q: string) => {
  return request<{ users: { email: string; nome: string }[] }>('/api/users/search', {
    method: 'POST',
    body: { q },
  })
}

// ── Painel do desenvolvedor ──────────────────────────────────────────
export type DevMetrics = {
  geradoEm: string
  periodo: { from: string; to: string; dias: number; granularidade: 'dia' | 'mes' }
  impressoes: {
    trabalhos: number
    paginas: number
    receita: number
    ticketMedio: number
    paginasPorTrabalho: number
    alunos: number
    porTipo: { tipo: string; label: string; trabalhos: number; paginas: number; receita: number }[]
    porHora: number[]
  }
  creditos: {
    compras: number
    valor: number
    compradores: number
    ticketMedio: number
    porValor: { valor: number; compras: number }[]
    manuais: { lancamentos: number; valor: number }
  }
  pagamentos: { linksGerados: number; pagos: number; pendentes: number; valorPendente: number; conversao: number }
  ajustes: { lancamentos: number; adicionado: number; removido: number }
  alunos: { total: number; verificados: number; novos: number; ativos: number; imprimiram: number; compraram: number }
  situacao: {
    saldoEmContas: number
    alunosComSaldo: number
    documentos: number
    armazenamentoBytes: number
    compartilhados: number
    compartilhamentos: { pendentes: number; aceitos: number; recusados: number }
  }
  serie: { periodo: string; receitaImpressoes: number; creditosComprados: number; trabalhos: number; paginas: number }[]
}

export const apiDevMetrics = (params: { from: string; to: string; fresh?: boolean }) =>
  request<DevMetrics>('/api/dev/metrics', {
    params: { from: params.from, to: params.to, ...(params.fresh ? { fresh: '1' } : {}) },
  })

export type DevAluno = { email: string; nome: string; creditos: number; verificado: boolean }
export type DevAjuste = {
  em: string
  aluno: { email: string; nome: string }
  valor: number
  operacao: 'adicionar' | 'remover' | 'definir'
  saldoAnterior: number
  saldoNovo: number
  motivo: string
  por: string
}

export const apiDevSearchUsers = (q: string) =>
  request<{ users: DevAluno[] }>('/api/dev/users/search', { method: 'POST', body: { q } })

export const apiDevAdjustCredits = (params: { email: string; operacao: DevAjuste['operacao']; valor: number; motivo: string; requestId: string }) =>
  request<{ message: string; saldoAnterior: number; saldoNovo: number }>('/api/dev/credits/adjust', { method: 'POST', body: params })

export const apiDevAdjustments = () =>
  request<{ ajustes: DevAjuste[] }>('/api/dev/adjustments')
