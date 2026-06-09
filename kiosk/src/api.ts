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
  return JSON.parse(raw) as { matricula: string; senha: string }
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
  sentFromMatricula?: string
  sentFromName?: string
  sentMessage?: string
  sentDocId?: string
}

export const BLACK_WHITE_PRICE = 0.50

declare global {
  interface Window {
    __kioskLogout?: () => void
  }
}

export const apiLogin = (matricula: string, senha: string) =>
  request<{ message: string; displayName: string }>('/api/login', {
    method: 'POST',
    body: { matricula, senha },
  })

export const apiGetDocuments = () => {
  const { matricula, senha } = getCredentials()
  return request<{ documents: Record<string, StoredDocument>; documentsList: StoredDocument[] }>('/api/documents', {
    method: 'POST',
    body: { matricula, senha },
  })
}

export const apiGetCredits = () => {
  const { matricula, senha } = getCredentials()
  return request<{ credits: number; transactions: unknown[] }>('/api/credits', {
    params: { matricula, senha },
  })
}

export const apiPrint = (documentId: string, documentName: string, pages: number, cost: number) => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string; printRecord: { id: string }; credits: number }>('/api/print', {
    method: 'POST',
    body: { matricula, senha, documentId, documentName, pages, cost },
  })
}

export const apiCupsPrint = (fileUrl: string) => {
  return request<{ message: string; jobId?: string }>('/api/cups-print', {
    method: 'POST',
    body: { fileUrl },
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted') => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { matricula, senha, notificationId, action },
  })
}

export type Notification = {
  id: string
  type: string
  fromMatricula?: string
  fromName?: string
  documentId?: string
  documentName?: string
  message?: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export const apiHealthCheck = () =>
  request<{ status: string }>('/api/health')

export const apiGetNotifications = () => {
  const { matricula, senha } = getCredentials()
  return request<{ notifications: Notification[] }>('/api/notifications', {
    params: { matricula, senha },
  })
}
