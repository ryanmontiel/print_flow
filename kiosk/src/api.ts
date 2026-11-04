// Cliente HTTP da interface do kiosk. Todas as chamadas vão para o servidor local do
// kiosk (mesma origem), que imprime pelo CUPS ou repassa ao servidor principal.
// Também reúne tipos, tabela de preços e formatações usadas nas telas.
const API = ''

type ApiOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string>
}

// Faz a requisição com o token da sessão e limite de 60 s. Resposta de erro vira
// exceção com a mensagem do servidor; sessão expirada desloga e volta ao login.
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
  } catch {
    throw new Error('Erro de conexão com o servidor. Verifique se o servidor principal está rodando.')
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
      window.__kioskLogout?.()
      if (location.pathname !== '/') location.assign('/')
    }
    throw new Error(msg)
  }
  return res.json()
}

// Fica no sessionStorage: some quando o app do kiosk é fechado
export const TOKEN_KEY = 'pf-kiosk-token'

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
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

export const TITLE_MAX_LENGTH = 60

export const truncateTitle = (text?: string, max = TITLE_MAX_LENGTH) => {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value
}

export const documentDisplayName = (doc?: Partial<StoredDocument> | null) =>
  doc?.name || doc?.originalname || 'Documento'

export type PrintConfig = {
  color: 'bw' | 'color'
  duplex: 'single' | 'duplex'
}

// Mesma tabela do server.js; aqui serve só para mostrar o valor na tela (quem cobra é o servidor)
export const PRINT_PRICES: Record<`${PrintConfig['color']}_${PrintConfig['duplex']}`, number> = {
  bw_single: 0.5,
  bw_duplex: 0.35,
  color_single: 0.75,
  color_duplex: 0.6,
}

export const getPrintPrice = (config: PrintConfig) => PRINT_PRICES[`${config.color}_${config.duplex}`]

// Preço é sempre por página do documento; frente e verso tem desconto (menos folhas).
export const getPrintCost = (config: PrintConfig, pages: number) =>
  Math.round(pages * getPrintPrice(config) * 100) / 100

export const printConfigLabel = (c?: { color?: string; duplex?: string }) => {
  const color = c?.color === 'color' ? 'Colorido' : 'Preto e branco'
  const duplex = c?.duplex === 'duplex' ? 'Frente e verso' : 'Simples'
  return `${color} · ${duplex}`
}

export const formatBRL = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

declare global {
  interface Window {
    __kioskLogout?: () => void
  }
}

export const apiLogin = (email: string, senha: string) =>
  request<{ message: string; token: string; displayName: string }>('/api/login', {
    method: 'POST',
    body: { email, senha, client: 'kiosk' },
  })

export const apiGetDocuments = () => {
  return request<{ documents: StoredDocument[] }>('/api/documents', {
    method: 'POST',
    body: {},
  })
}

export const apiGetCredits = () => {
  return request<{ credits: number; transactions: unknown[] }>('/api/credits', {
  })
}

export const apiPrintStart = (params: {
  fileUrl: string
  color: 'bw' | 'color'
  duplex: 'single' | 'duplex'
  documentId: string
  documentName: string
  pages: number
  copies: number
  pageRanges?: string
}) => request<{ message: string; jobId: string }>('/api/print/start', {
  method: 'POST',
  body: params,
})

export const apiPrintStatus = (jobId: string) =>
  request<{ status: 'printing' | 'completed' | 'error'; jobId: string; error?: string }>(`/api/print/status/${jobId}`)

export const apiPrintComplete = (jobId: string) =>
  request<{ message: string; credits: number }>('/api/print/complete', {
    method: 'POST',
    body: { jobId },
  })

export const apiGetPrintPreferences = () => {
  return request<{ printColor: string; printDuplex: string }>('/api/user/print-preferences', {
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted') => {
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { notificationId, action },
  })
}

export type Notification = {
  id: string
  tipo: string
  de_email?: string
  de_nome?: string
  documento_id?: string
  documento_nome?: string
  mensagem?: string
  status: 'pending' | 'accepted' | 'rejected'
  criado_em: string
}

export const apiHealthCheck = () =>
  request<{ status: string }>('/api/health')

export const apiGetNotifications = () => {
  return request<{ notifications: Notification[] }>('/api/notifications', {
  })
}
