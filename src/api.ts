const API = ''
import { upload } from '@vercel/blob/client'

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
export const apiLogin = (email: string, senha: string) =>
  request<{ message: string; displayName: string }>('/api/login', {
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

// Documents
export const apiGetDocuments = () => {
  const { email, senha } = getCredentials()
  return request<{ documents: StoredDocument[] }>('/api/documents', {
    method: 'POST',
    body: { email, senha },
  })
}

export const apiUploadFile = async (file: File) => {
  try {
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: `${API}/api/blob/upload`,
      clientPayload: JSON.stringify(getCredentials()),
      contentType: file.type || 'application/octet-stream',
    })
    return {
      message: 'File uploaded successfully',
      file: {
        filename: blob.pathname,
        url: blob.url,
        originalname: file.name,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
      } as StoredDocument,
    }
  } catch (error) {
    if (file.size > 4 * 1024 * 1024) {
      throw new Error(
        `Não foi possível enviar o arquivo (${Math.ceil(file.size / 1024 / 1024)} MB) pelo armazenamento em nuvem. Tente novamente.`
      )
    }
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData })
    if (!res.ok) {
      const text = await res.text()
      let message = 'Erro ao enviar arquivo. Tente novamente.'
      try {
        const data = JSON.parse(text)
        if (data?.error) message = data.error
      } catch {
        if (/too large|TOO_LARGE|limit/i.test(text)) message = 'Arquivo muito grande. O limite é 4 MB.'
        else if (/An error occurred|FUNCTION/i.test(text)) message = 'Servidor demorou demais. Tente novamente.'
      }
      throw new Error(message)
    }
    return res.json() as Promise<{ message: string; file: StoredDocument }>
  }
}

export const apiAddDocument = (documentName: string, uploadedFile: StoredDocument) => {
  const { email, senha } = getCredentials()
  return request<{ message: string; document: StoredDocument }>('/api/add-document', {
    method: 'POST',
    body: { email, senha, documentName, ...uploadedFile },
  })
}

export const apiDeleteDocument = async (documentId: string, blobUrl?: string) => {
  const { email, senha } = getCredentials()
  await request<{ message: string }>('/api/delete-document', {
    method: 'POST',
    body: { email, senha, documentId },
  })
  if (blobUrl && blobUrl.includes('blob.vercel-storage.com')) {
    try {
      await request<{ ok: boolean }>('/api/blob/delete', {
        method: 'POST',
        body: { email, senha, url: blobUrl },
      })
    } catch {}
  }
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
export const apiPrint = (documentId: string, documentName: string, pages: number, cost: number) => {
  const { email, senha } = getCredentials()
  return request<{ message: string; printRecord: PrintRecord; credits: number }>('/api/print', {
    method: 'POST',
    body: { email, senha, documentId, documentName, pages, cost },
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
