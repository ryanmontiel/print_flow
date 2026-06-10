import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Search, Trash2, ExternalLink, Download, Share2, FileText, Loader2 } from 'lucide-react'
import { apiGetDocuments, apiUploadFile, apiAddDocument, apiDeleteDocument, apiShareDocument, type StoredDocument } from '../api'
import ShareModal from '../components/ShareModal'
import DocumentPreview from '../components/DocumentPreview'

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [namingDoc, setNamingDoc] = useState<StoredDocument | null>(null)
  const [docName, setDocName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shareDoc, setShareDoc] = useState<StoredDocument | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadDocuments() }, [])

  const loadDocuments = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGetDocuments()
      setDocuments(res.documentsList || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar documentos')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await apiUploadFile(file)
      setNamingDoc(result.file)
      setDocName(result.file.originalname.replace(/\.[^/.]+$/, ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSaveDocument = async () => {
    if (!namingDoc || !docName.trim()) return
    try {
      await apiAddDocument(docName.trim(), namingDoc)
      setNamingDoc(null)
      setDocName('')
      await loadDocuments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar documento')
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await apiDeleteDocument(id)
      setDocuments(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = documents.filter(d =>
    !d.name?.startsWith('sent:') && (
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.originalname.toLowerCase().includes(search.toLowerCase())
    )
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-heading text-3xl font-bold">Documentos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {documents.length} documento(s) enviado(s)
          </p>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          {uploading ? 'Enviando...' : 'Enviar documento'}
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp" onChange={handleFileSelect} className="hidden" />
      </div>

      {/* Name input inline */}
      <AnimatePresence>
        {namingDoc && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4">
              <p className="text-sm font-medium mb-2">Nome do documento:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="Ex: Trabalho de matemática"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 outline-none"
                  autoFocus
                />
                <button onClick={handleSaveDocument} disabled={!docName.trim()} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
                  Salvar
                </button>
                <button onClick={() => setNamingDoc(null)} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg transition-colors">
                  Cancelar
                </button>
              </div>
              {namingDoc.mimetype.startsWith('image/') && (
                <img src={namingDoc.url} alt="preview" className="w-20 h-16 object-cover rounded-lg mt-3" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar documentos..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 outline-none transition-all"
        />
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium text-gray-500 dark:text-gray-400">{search ? 'Nenhum documento encontrado' : 'Nenhum documento enviado'}</p>
          <p className="text-sm mt-1">{search ? 'Tente outro termo de busca.' : 'Clique em "Enviar documento" para começar.'}</p>
        </div>
      ) : (
        <motion.div layout className="space-y-3">
          <AnimatePresence>
            {filtered.map(doc => {
              const fileUrl = doc.url
              return (
                <motion.div
                  key={doc.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center gap-4"
                >
                  <DocumentPreview url={fileUrl} mimetype={doc.mimetype} name={doc.name} />

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400">
                      {doc.originalname} &middot; {(doc.size / 1024).toFixed(1)} KB
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <a href={fileUrl} target="_blank" rel="noreferrer"
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors"
                      title="Abrir">
                      <ExternalLink size={16} />
                    </a>
                    <a href={fileUrl} download={doc.originalname}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors"
                      title="Baixar">
                      <Download size={16} />
                    </a>
                    <button
                      onClick={() => setShareDoc(doc)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors"
                      title="Compartilhar"
                    >
                      <Share2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Excluir"
                    >
                      {deletingId === doc.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}

      {shareDoc && (
        <ShareModal
          isOpen={!!shareDoc}
          onClose={() => setShareDoc(null)}
          documentName={shareDoc.name}
          onShare={async (targetMatricula, message) => {
            await apiShareDocument(targetMatricula, shareDoc.id, shareDoc.name, message)
          }}
        />
      )}
    </div>
  )
}
