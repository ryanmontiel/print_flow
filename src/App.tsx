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

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [status, setStatus] = useState('Ready to print')
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadedFile, setUploadedFile] = useState<any>(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [documentName, setDocumentName] = useState('')
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [documentsStatus, setDocumentsStatus] = useState('')
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadStatus('Uploading...')

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
        setUploadStatus(`File "${result.file.originalname}" uploaded. Enter a document name and save it.`)
      } else {
        const errorText = await response.text()
        try {
          const parsed = JSON.parse(errorText)
          setUploadStatus(`Upload failed: ${parsed.error || 'Unknown error'}`)
        } catch {
          setUploadStatus(`Upload failed: ${response.status} ${response.statusText}`)
        }
      }
    } catch (error) {
      setUploadStatus('Upload failed: Network error')
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
    setDocumentsStatus('Loading documents...')

    try {
      const response = await fetch('http://localhost:4002/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, senha }),
      })

      if (!response.ok) {
        const error = await response.json()
        setDocumentsStatus(`Could not load documents: ${error.error}`)
        return
      }

      const result = await response.json()
      const list = Array.isArray(result.documentsList) ? result.documentsList : []
      const orderedList = [...list].sort((a: StoredDocument, b: StoredDocument) => {
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      })

      setDocuments(orderedList)
      setDocumentsStatus('')
    } catch (error) {
      setDocumentsStatus('Could not load documents: Network error')
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
      setUploadStatus('Missing login credentials. Please log in again.')
      return
    }

    const { matricula, senha } = JSON.parse(rawCredentials)
    setUploadStatus('Saving document...')

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
        setUploadStatus(`Document "${documentName}" saved successfully.`)
        setDocumentName('')
        setUploadedFile(null)
        setShowNameInput(false)
        fetchDocuments()
      } else {
        const error = await response.json()
        setUploadStatus(`Failed to save document: ${error.error}`)
      }
    } catch (error) {
      setUploadStatus('Failed to save document: Network error')
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    const rawCredentials = localStorage.getItem('userCredentials')
    if (!rawCredentials) {
      setDocumentsStatus('Missing login credentials. Please log in again.')
      return
    }

    const { matricula, senha } = JSON.parse(rawCredentials)
    setDeletingDocumentId(documentId)

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
          setDocumentsStatus(`Could not delete document: ${parsed.error || 'Unknown error'}`)
        } catch {
          setDocumentsStatus(`Could not delete document: ${response.status} ${response.statusText}`)
        }
        return
      }

      setDocumentsStatus('Document deleted successfully.')
      await fetchDocuments()
    } catch (error) {
      setDocumentsStatus('Could not delete document: Network error')
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
          {uploadStatus && <p style={{ marginTop: 8 }}>{uploadStatus}</p>}

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
            {documentsStatus && <p>{documentsStatus}</p>}
            {!documentsStatus && documents.length === 0 && <p>No documents uploaded yet.</p>}

            {documents.length > 0 && (
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
