import { useEffect, useRef, useState } from 'react'
import './App.css'
import LandingPage from './LandingPage'

type StoredDocument = {
  id: string
  name: string
  filename: string
  originalname: string
  mimetype: string
  size: number
  url: string
  uploadedAt: string
}

type AppNotice = {
  type: 'success' | 'error' | 'info'
  message: string
}

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready to print')
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const [uploadedFile, setUploadedFile] = useState<any>(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [documentName, setDocumentName] = useState('')
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const noticeTimerRef = useRef<number | null>(null)

  const showNotice = (message: string, type: AppNotice['type'] = 'info', autoHide = true) => {
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    showNotice('Enviando arquivo...', 'info', false)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('http://localhost:4002/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        setUploadedFile(result.file)
        setShowNameInput(true)
        showNotice(`Arquivo "${result.file.originalname}" enviado. Informe um nome e salve o documento.`, 'success')
      } else {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          showNotice(`Falha no upload: ${parsed.error || 'Erro desconhecido'}`, 'error')
        } catch {
          showNotice(`Falha no upload: ${response.status} ${response.statusText}`, 'error')
        }
      }
    } catch (error) {
      showNotice('Falha no upload: erro de conexao', 'error')
    }
  }

  const openFileDialog = () => {
    fileInputRef.current?.click()
  }

  const fetchDocuments = async () => {
    const rawCredentials = localStorage.getItem('userCredentials')
    if (!rawCredentials) {
      setDocuments([])
      return
    }

    const { matricula, senha } = JSON.parse(rawCredentials)
    setIsLoadingDocuments(true)

    try {
      const response = await fetch('http://localhost:4002/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, senha }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          showNotice(`Nao foi possivel carregar documentos: ${parsed.error || 'Erro desconhecido'}`, 'error')
        } catch {
          showNotice(`Nao foi possivel carregar documentos: ${response.status} ${response.statusText}`, 'error')
        }
        return
      }

      const result = await response.json()
      const list = Array.isArray(result.documentsList) ? result.documentsList : []
      const orderedList = [...list].sort((a: StoredDocument, b: StoredDocument) => {
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      })

      setDocuments(orderedList)
    } catch (error) {
      showNotice('Nao foi possivel carregar documentos: erro de conexao', 'error')
    } finally {
      setIsLoadingDocuments(false)
    }
  }

  useEffect(() => {
    fetchDocuments()
  }, [currentUser])

  const handleAddDocument = async () => {
    if (!documentName.trim() || !uploadedFile) {
      return
    }

    const rawCredentials = localStorage.getItem('userCredentials')
    if (!rawCredentials) {
      showNotice('Credenciais ausentes. Faca login novamente.', 'error')
      return
    }

    const { matricula, senha } = JSON.parse(rawCredentials)
    showNotice('Salvando documento...', 'info', false)

    try {
      const response = await fetch('http://localhost:4002/api/add-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matricula,
          senha,
          documentName: documentName.trim(),
          filename: uploadedFile.filename,
          originalname: uploadedFile.originalname,
          mimetype: uploadedFile.mimetype,
          size: uploadedFile.size,
          url: uploadedFile.url,
        }),
      })

      if (response.ok) {
        showNotice(`Documento "${documentName}" salvo com sucesso.`, 'success')
        setDocumentName('')
        setUploadedFile(null)
        setShowNameInput(false)
        await fetchDocuments()
      } else {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          showNotice(`Falha ao salvar documento: ${parsed.error || 'Erro desconhecido'}`, 'error')
        } catch {
          showNotice(`Falha ao salvar documento: ${response.status} ${response.statusText}`, 'error')
        }
      }
    } catch (error) {
      showNotice('Falha ao salvar documento: erro de conexao', 'error')
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    const rawCredentials = localStorage.getItem('userCredentials')
    if (!rawCredentials) {
      showNotice('Credenciais ausentes. Faca login novamente.', 'error')
      return
    }

    const { matricula, senha } = JSON.parse(rawCredentials)
    setDeletingDocumentId(documentId)
    showNotice('Excluindo documento...', 'info', false)

    try {
      const response = await fetch('http://localhost:4002/api/delete-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, senha, documentId }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          showNotice(`Nao foi possivel excluir documento: ${parsed.error || 'Erro desconhecido'}`, 'error')
        } catch {
          showNotice(`Nao foi possivel excluir documento: ${response.status} ${response.statusText}`, 'error')
        }
        return
      }

      showNotice('Documento excluido com sucesso.', 'success')
      await fetchDocuments()
    } catch (error) {
      showNotice('Nao foi possivel excluir documento: erro de conexao', 'error')
    } finally {
      setDeletingDocumentId(null)
    }
  }

  if (!currentUser) {
    return <LandingPage onAuthenticate={(userName) => setCurrentUser(userName)} />
  }

  return (
    <main className="app">
      <header className="header">
        <h1>PrintFlow</h1>
        <p>Welcome, {currentUser}. Your lightweight print management dashboard</p>
      </header>

      <div className="dashboard-notice-slot" aria-live="polite">
        {notice && <div className={`inline-notice dashboard-notice notice-${notice.type}`}>{notice.message}</div>}
      </div>

      <section className="card">
        <h2>Dashboard</h2>
        <p>Status: {status}</p>
        <button onClick={() => setStatus('Printing in progress...')}>Start printing</button>
        <button onClick={() => setStatus('Ready to print')}>Reset status</button>
        
        <div style={{ marginTop: 16 }}>
          <button onClick={openFileDialog}>Upload Document/Image</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {showNameInput && (
            <div style={{ marginTop: 12 }}>
              {uploadedFile && uploadedFile.mimetype?.startsWith('image/') && (
                <img
                  src={`http://localhost:4002${uploadedFile.url}`}
                  alt="preview"
                  style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block', marginBottom: 10 }}
                />
              )}
              {uploadedFile && uploadedFile.mimetype === 'application/pdf' && (
                <iframe
                  src={`http://localhost:4002${uploadedFile.url}`}
                  title="preview"
                  style={{ width: 120, height: 90, border: '1px solid #ddd', borderRadius: 6, marginBottom: 10 }}
                />
              )}
              <input
                type="text"
                placeholder="Document name"
                value={documentName}
                onChange={(event) => setDocumentName(event.target.value)}
                style={{ marginRight: 8, padding: 4 }}
              />
              <button onClick={handleAddDocument} disabled={!documentName.trim()}>
                Save Document
              </button>
            </div>
          )}
        </div>

            <button onClick={() => {
              setCurrentUser(null)
              localStorage.removeItem('userCredentials')
            }} style={{ marginTop: 12 }}>
          Logout
        </button>
      </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Uploaded Documents</h2>
            {isLoadingDocuments && <p>Loading documents...</p>}
            {!isLoadingDocuments && documents.length === 0 && <p>No documents uploaded yet.</p>}

            {!isLoadingDocuments && documents.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {documents.map((document) => {
                  const fileUrl = `http://localhost:4002${document.url}`
                  const isImage = document.mimetype.startsWith('image/')
                  const isPdf = document.mimetype === 'application/pdf'
                  return (
                    <li key={document.id} style={{ marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 16 }}>
                      <strong>{document.name}</strong>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                        {document.originalname} · {(document.size / 1024).toFixed(1)} KB
                      </div>

                      {isImage && (
                        <img
                          src={fileUrl}
                          alt={document.name}
                          style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block', marginBottom: 8 }}
                        />
                      )}

                      {isPdf && (
                        <iframe
                          src={fileUrl}
                          title={document.name}
                          style={{ width: 120, height: 90, border: '1px solid #ddd', borderRadius: 6, marginBottom: 8 }}
                        />
                      )}

                      {!isImage && !isPdf && (
                        <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                          📄 Preview not available for this file type
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a href={fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                          Open file
                        </a>
                        <a href={fileUrl} download={document.originalname} style={{ fontSize: 13 }}>
                          Download file
                        </a>
                        <button
                          onClick={() => handleDeleteDocument(document.id)}
                          disabled={deletingDocumentId === document.id}
                          style={{ fontSize: 12 }}
                        >
                          {deletingDocumentId === document.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
    </main>
  )
}

export default App
