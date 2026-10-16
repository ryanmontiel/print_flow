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
  const { email, senha } = JSON.parse(raw)
  return { email, senha }
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

// Auth
export const apiLogin = (email: string, senha: string) =>
  request<{ message: string; displayName: string; printColor: string; printDuplex: string }>('/api/login', {
    method: 'POST',
    body: { email, senha },
  })

export const apiRegister = (email: string, nome: string, senha: string) =>
  request<{ message: string }>('/api/register', {
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
  const { email, senha } = getCredentials()
  return request<{ documents: StoredDocument[]; usedBytes: number; limitBytes: number }>('/api/documents', {
    method: 'POST',
    body: { email, senha },
  })
}

// Envia o arquivo direto para o R2 via URL pré-assinada (contorna o limite de 4.5MB da Vercel)
export const apiUploadFile = async (file: File) => {
  const { email, senha } = getCredentials()

  if (file.size > PER_FILE_LIMIT_BYTES) {
    throw new Error(`Arquivo muito grande. O limite é ${PER_FILE_LIMIT_BYTES / (1024 * 1024)} MB por arquivo.`)
  }

  const presign = await request<{ uploadUrl: string; url: string; key: string }>('/api/upload/presign', {
    method: 'POST',
    body: {
      email,
      senha,
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
  const { email, senha } = getCredentials()
  return request<{ message: string; document: StoredDocument }>('/api/add-document', {
    method: 'POST',
    body: { email, senha, documentName, ...uploadedFile },
  })
}

export const apiDeleteDocument = async (documentId: string) => {
  const { email, senha } = getCredentials()
  await request<{ message: string }>('/api/delete-document', {
    method: 'POST',
    body: { email, senha, documentId },
  })
}

// Credits
export const apiGetCredits = () => {
  const { email, senha } = getCredentials()
  return request<{ credits: number; transactions: Transaction[] }>('/api/credits', {
    params: { email, senha },
  })
}

export const apiAddCredits = (amount: number, description?: string) => {
  const { email, senha } = getCredentials()
  return request<{ credits: number; transactions: Transaction[] }>('/api/credits/add', {
    method: 'POST',
    body: { email, senha, amount, description },
  })
}

// Print
export const apiPrint = (documentId: string, documentName: string, pages: number, cost: number, color: 'bw' | 'color' = 'bw', duplex: 'single' | 'duplex' = 'single') => {
  const { email, senha } = getCredentials()
  return request<{ message: string; printRecord: PrintRecord; credits: number }>('/api/print', {
    method: 'POST',
    body: { email, senha, documentId, documentName, pages, cost, color, duplex },
  })
}

export const apiGetPrintHistory = () => {
  const { email, senha } = getCredentials()
  return request<{ printHistory: PrintRecord[] }>('/api/print-history', {
    params: { email, senha },
  })
}

// Share
export const apiShareDocument = (targetEmail: string, documentId: string, documentName: string, message?: string) => {
  const { email, senha } = getCredentials()
  return request<{ message: string }>('/api/share-document', {
    method: 'POST',
    body: { email, senha, targetEmail, documentId, documentName, message },
  })
}

export const apiHandleShare = (notificationId: string, action: 'accepted' | 'rejected') => {
  const { email, senha } = getCredentials()
  return request<{ message: string }>('/api/handle-share', {
    method: 'POST',
    body: { email, senha, notificationId, action },
  })
}

// InfinitePay
export const apiCreatePaymentLink = (amount: number, redirectUrl: string) => {
  const { email, senha } = getCredentials()
  return request<{ url: string; order_nsu: string }>('/api/create-payment-link', {
    method: 'POST',
    body: { email, senha, amount, redirect_url: redirectUrl },
  })
}

export const apiCheckPayment = (order_nsu: string, slug?: string, transaction_nsu?: string) => {
  const { email, senha } = getCredentials()
  return request<{ paid: boolean; amount?: number }>('/api/check-payment', {
    method: 'POST',
    body: { email, senha, order_nsu, slug, transaction_nsu },
  })
}

export const apiReprocessPayment = (order_nsu: string) => {
  const { email, senha } = getCredentials()
  return request<{ paid: boolean; amount?: number; message: string }>('/api/reprocess-payment', {
    method: 'POST',
    body: { email, senha, order_nsu },
  })
}

export const apiGetPrintPreferences = () => {
  const { email, senha } = getCredentials()
  return request<{ printColor: string; printDuplex: string }>('/api/user/print-preferences', {
    params: { email, senha },
  })
}

export const apiDebugAddCredits = (amount: number, description?: string) => {
  const { email, senha } = getCredentials()
  return request<{ success: boolean; newCredits: string; transactions: any[] }>('/api/debug/add-credits', {
    method: 'POST',
    body: { email, senha, amount, description },
  })
}

export const apiDebugUser = () => {
  const { email, senha } = getCredentials()
  return request<{ __id: number; email: string; creditos: string; transacoes: any[]; pagamentospendentes: any }>('/api/debug/user', {
    method: 'POST',
    body: { email, senha },
  })
}

// Notifications
export const apiGetNotifications = () => {
  const { email, senha } = getCredentials()
  return request<{ notifications: Notification[] }>('/api/notifications', {
    params: { email, senha },
  })
}

// Users list for autocomplete
export const apiGetUsers = () =>
  request<{ users: { email: string; nome: string }[] }>('/api/users')
