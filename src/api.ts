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
  } catch (err) {
    throw new Error('Erro de conexão com o servidor. Verifique se o backend está rodando.')
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
  const raw = sessionStorage.getItem('userCredentials') || localStorage.getItem('userCredentials')
  if (!raw) throw new Error('Credenciais ausentes. Faça login novamente.')
  const { matricula, senha } = JSON.parse(raw)
  return { matricula, senha }
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

export type Notification = {
  id: string
  type: 'share_request' | 'share_accepted' | 'share_rejected' | 'print_complete' | 'credits_added'
  fromMatricula?: string
  fromName?: string
  documentId?: string
  documentName?: string
  message?: string
  status: 'pending' | 'accepted' | 'rejected' | 'read'
  createdAt: string
}

export type PrintRecord = {
  id: string
  documentId: string
  documentName: string
  pages: number
  cost: number
  status: 'completed' | 'failed'
  printedAt: string
}

export type Transaction = {
  amount: number
  type: 'credit' | 'debit'
  description: string
  createdAt: string
}

// Auth
export const apiLogin = (matricula: string, senha: string) =>
  request<{ message: string; displayName: string }>('/api/login', {
    method: 'POST',
    body: { matricula, senha },
  })

export const apiRegister = (matricula: string, nomeCompleto: string, senha: string) =>
  request<{ message: string }>('/api/register', {
    method: 'POST',
    body: { matricula, nomeCompleto, senha },
  })

// Documents
export const apiGetDocuments = () => {
  const { matricula, senha } = getCredentials()
  return request<{ documents: Record<string, StoredDocument>; documentsList: StoredDocument[] }>('/api/documents', {
    method: 'POST',
    body: { matricula, senha },
  })
}

export const apiUploadFile = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return fetch(`${API}/api/upload`, { method: 'POST', body: formData }).then(async (res) => {
    if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
    return res.json() as Promise<{ message: string; file: StoredDocument }>
  })
}

export const apiAddDocument = (documentName: string, uploadedFile: StoredDocument) => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string; document: StoredDocument }>('/api/add-document', {
    method: 'POST',
    body: { matricula, senha, documentName, ...uploadedFile },
  })
}

export const apiDeleteDocument = (documentId: string) => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string }>('/api/delete-document', {
    method: 'POST',
    body: { matricula, senha, documentId },
  })
}

// Credits
export const apiGetCredits = () => {
  const { matricula, senha } = getCredentials()
  return request<{ credits: number; transactions: Transaction[] }>('/api/credits', {
    params: { matricula, senha },
  })
}

export const apiAddCredits = (amount: number, description?: string) => {
  const { matricula, senha } = getCredentials()
  return request<{ credits: number; transactions: Transaction[] }>('/api/credits/add', {
    method: 'POST',
    body: { matricula, senha, amount, description },
  })
}

// Print
export const apiPrint = (documentId: string, documentName: string, pages: number, cost: number) => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string; printRecord: PrintRecord; credits: number }>('/api/print', {
    method: 'POST',
    body: { matricula, senha, documentId, documentName, pages, cost },
  })
}

export const apiGetPrintHistory = () => {
  const { matricula, senha } = getCredentials()
  return request<{ printHistory: PrintRecord[] }>('/api/print-history', {
    params: { matricula, senha },
  })
}

// Share
export const apiShareDocument = (targetMatricula: string, documentId: string, documentName: string, message?: string) => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string }>('/api/share-document', {
    method: 'POST',
    body: { matricula, senha, targetMatricula, documentId, documentName, message },
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted' | 'rejected') => {
  const { matricula, senha } = getCredentials()
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { matricula, senha, notificationId, action },
  })
}

// InfinitePay
export const apiCreatePaymentLink = (amount: number, redirectUrl: string) => {
  const { matricula, senha } = getCredentials()
  return request<{ url: string; order_nsu: string }>('/api/create-payment-link', {
    method: 'POST',
    body: { matricula, senha, amount, redirect_url: redirectUrl },
  })
}

export const apiCheckPayment = (order_nsu: string, slug?: string, transaction_nsu?: string) => {
  const { matricula, senha } = getCredentials()
  return request<{ paid: boolean; amount?: number }>('/api/check-payment', {
    method: 'POST',
    body: { matricula, senha, order_nsu, slug, transaction_nsu },
  })
}

// Notifications
export const apiGetNotifications = () => {
  const { matricula, senha } = getCredentials()
  return request<{ notifications: Notification[] }>('/api/notifications', {
    params: { matricula, senha },
  })
}

// Users list for autocomplete
export const apiGetUsers = () =>
  request<{ users: { matricula: string; nome: string }[] }>('/api/users')
