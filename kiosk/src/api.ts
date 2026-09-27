const API = ''

type ApiOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string>
}

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
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
    try {
      const parsed = await res.json()
      msg = parsed.error || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

function getCredentials() {
  let raw
  try { raw = localStorage.getItem('pf-kiosk-credentials') } catch {}
  if (!raw) throw new Error('Credenciais ausentes. Faça login novamente.')
  return JSON.parse(raw) as { email: string; senha: string }
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

export type PrintConfig = {
  color: 'bw' | 'color'
  duplex: 'single' | 'duplex'
}

export const PRINT_PRICES: Record<`${PrintConfig['color']}_${PrintConfig['duplex']}`, number> = {
  bw_single: 0.5,
  bw_duplex: 1.0,
  color_single: 0.75,
  color_duplex: 1.5,
}

export const getPrintPrice = (config: PrintConfig) => PRINT_PRICES[`${config.color}_${config.duplex}`]

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
  request<{ message: string; displayName: string }>('/api/login', {
    method: 'POST',
    body: { email, senha },
  })

export const apiGetDocuments = () => {
  const { email, senha } = getCredentials()
  return request<{ documents: StoredDocument[] }>('/api/documents', {
    method: 'POST',
    body: { email, senha },
  })
}

export const apiGetCredits = () => {
  const { email, senha } = getCredentials()
  return request<{ credits: number; transactions: unknown[] }>('/api/credits', {
    params: { email, senha },
  })
}

export const apiPrint = (documentId: string, documentName: string, pages: number, cost: number, color: 'bw' | 'color' = 'bw', duplex: 'single' | 'duplex' = 'single') => {
  const { email, senha } = getCredentials()
  return request<{ message: string; printRecord: { id: string }; credits: number }>('/api/print', {
    method: 'POST',
    body: { email, senha, documentId, documentName, pages, cost, color, duplex },
  })
}

export const apiCupsPrint = (fileUrl: string, color: 'bw' | 'color' = 'bw', duplex: 'single' | 'duplex' = 'single') => {
  return request<{ message: string; jobId?: string }>('/api/cups-print', {
    method: 'POST',
    body: { fileUrl, color, duplex },
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted') => {
  const { email, senha } = getCredentials()
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { email, senha, notificationId, action },
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
  const { email, senha } = getCredentials()
  return request<{ notifications: Notification[] }>('/api/notifications', {
    params: { email, senha },
  })
}
