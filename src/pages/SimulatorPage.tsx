// Página "Simular impressão": o aluno escolhe um documento (ou só informa o número de
// páginas), quais páginas, cópias, cor e frente e verso, e vê quanto vai custar, quantas
// folhas saem e como fica o saldo, antes de ir ao kiosk. Também compara as quatro
// configurações para as mesmas páginas. As regras são as do kiosk (KioskPrintPage), para
// o valor simulado ser o mesmo que será cobrado.
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calculator, FileText, Loader2, Minus, Plus, Wallet, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiGetDocuments, apiGetCredits, getPrintCost, getPrintPrice, documentDisplayName, isOwnDocument, truncateTitle, formatBRL, type PrintConfig, type StoredDocument } from '../api'

const MAX_COPIAS = 99
const MAX_PAGINAS = 2000

const CONFIGURACOES: { config: PrintConfig; label: string }[] = [
  { config: { color: 'bw', duplex: 'single' }, label: 'Preto e branco · Simples' },
  { config: { color: 'bw', duplex: 'duplex' }, label: 'Preto e branco · Frente e verso' },
  { config: { color: 'color', duplex: 'single' }, label: 'Colorido · Simples' },
  { config: { color: 'color', duplex: 'duplex' }, label: 'Colorido · Frente e verso' },
]

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

// Conta as páginas de um PDF com o pdf.js. Ele só é baixado quando um PDF é escolhido,
// para não pesar no carregamento do resto do site.
async function contarPaginasPdf(url: string) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ url }).promise
  const total = doc.numPages
  await doc.destroy()
  return total
}

// "1-3, 5" -> {1, 2, 3, 5}. Devolve null se algum trecho estiver mal escrito ou
// passar do total de páginas do documento.
function lerIntervalo(texto: string, total: number): Set<number> | null {
  const paginas = new Set<number>()
  for (const parte of texto.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(parte)
    if (!m) return null
    const inicio = Number(m[1])
    const fim = Number(m[2] ?? m[1])
    if (inicio < 1 || fim > total || inicio > fim) return null
    for (let p = inicio; p <= fim; p++) paginas.add(p)
  }
  return paginas.size ? paginas : null
}

const inteiro = (texto: string, min: number, max: number) => {
  const n = Number(texto)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

export default function SimulatorPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [docs, setDocs] = useState<StoredDocument[]>([])
  const [credits, setCredits] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [docId, setDocId] = useState(searchParams.get('doc') || '')
  const [paginasPdf, setPaginasPdf] = useState<number | null>(null)
  const [contando, setContando] = useState(false)
  const [erroContagem, setErroContagem] = useState('')
  const contagens = useRef(new Map<string, number>())

  const [paginasManual, setPaginasManual] = useState('1')
  const [modoPaginas, setModoPaginas] = useState<'todas' | 'intervalo'>('todas')
  const [intervalo, setIntervalo] = useState('')
  const [copias, setCopias] = useState('1')
  const [config, setConfig] = useState<PrintConfig>({
    color: user?.printColor || 'bw',
    duplex: user?.printDuplex || 'single',
  })

  useEffect(() => {
    const carregar = async () => {
      const [docRes, credRes] = await Promise.allSettled([apiGetDocuments(), apiGetCredits()])
      if (docRes.status === 'fulfilled') setDocs(docRes.value.documents || [])
      else setError('Não foi possível carregar seus documentos. Você ainda pode simular informando o número de páginas.')
      if (credRes.status === 'fulfilled') setCredits(credRes.value.credits)
      setLoading(false)
    }
    carregar()
  }, [])

  const doc = docs.find((d) => d.id === docId) || null
  const tipo = !doc ? 'nenhum' : doc.mimetype === 'application/pdf' ? 'pdf' : doc.mimetype?.startsWith('image/') ? 'imagem' : 'outro'

  // Ao trocar de documento: PDF tem as páginas contadas (uma vez por documento),
  // imagem conta como 1 página e os outros formatos pedem o número ao aluno
  useEffect(() => {
    setModoPaginas('todas')
    setIntervalo('')
    setErroContagem('')
    setPaginasPdf(null)
    if (!doc || tipo !== 'pdf') return
    const salvo = contagens.current.get(doc.id)
    if (salvo) { setPaginasPdf(salvo); return }
    let cancelado = false
    setContando(true)
    contarPaginasPdf(doc.url)
      .then((total) => {
        contagens.current.set(doc.id, total)
        if (!cancelado) setPaginasPdf(total)
      })
      .catch(() => {
        if (!cancelado) setErroContagem('Não foi possível contar as páginas deste PDF. Informe o número de páginas abaixo.')
      })
      .finally(() => { if (!cancelado) setContando(false) })
    return () => { cancelado = true }
  }, [doc?.id, tipo])

  // Páginas do documento: contadas (PDF), 1 (imagem) ou informadas pelo aluno
  const contagemAutomatica = tipo === 'pdf' && paginasPdf !== null
  const totalDocumento = tipo === 'imagem' ? 1 : contagemAutomatica ? paginasPdf : inteiro(paginasManual, 1, MAX_PAGINAS)

  // Páginas escolhidas para imprimir: todas, ou um intervalo (só quando o total é
  // conhecido). Enquanto o campo do intervalo está vazio, valem todas as páginas.
  const usandoIntervalo = contagemAutomatica && modoPaginas === 'intervalo' && intervalo.trim() !== ''
  const paginasIntervalo = usandoIntervalo ? lerIntervalo(intervalo, paginasPdf) : null
  const intervaloInvalido = usandoIntervalo && !paginasIntervalo
  const selecionadas = usandoIntervalo ? paginasIntervalo?.size ?? null : totalDocumento

  const nCopias = inteiro(copias, 1, MAX_COPIAS)
  const valido = selecionadas !== null && nCopias !== null
  const paginasImpressas = valido ? selecionadas * nCopias : 0

  // Frente e verso só com 2 páginas ou mais (regra do kiosk)
  const podeFrenteVerso = (selecionadas ?? 0) >= 2
  const efetiva: PrintConfig = config.duplex === 'duplex' && !podeFrenteVerso ? { ...config, duplex: 'single' } : config
  const custo = getPrintCost(efetiva, paginasImpressas)
  const folhas = valido ? (efetiva.duplex === 'duplex' ? Math.ceil(selecionadas / 2) : selecionadas) * nCopias : 0
  const saldoApos = credits !== null ? Math.round((credits - custo) * 100) / 100 : null

  const opcoes = CONFIGURACOES.map((o) => ({
    ...o,
    disponivel: o.config.duplex === 'single' || podeFrenteVerso,
    custo: getPrintCost(o.config, paginasImpressas),
  }))
  const maisBarata = Math.min(...opcoes.filter((o) => o.disponivel).map((o) => o.custo))

  const mudarCopias = (delta: number) => {
    const atual = nCopias ?? 1
    setCopias(String(Math.min(MAX_COPIAS, Math.max(1, atual + delta))))
  }

  const campo = 'w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'
  const rotulo = 'block text-sm font-medium mb-1.5'
  const botaoOpcao = (ativo: boolean) =>
    `flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      ativo
        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
        : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="font-heading text-3xl font-bold mb-1">Simular impressão</h1>
      <p className="text-sm text-gray-500 dark:text-gray-300 mb-6">
        Veja quanto uma impressão vai custar antes de ir ao kiosk.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Opções da impressão */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-5"
        >
          <div>
            <label htmlFor="sim-doc" className={rotulo}>Documento</label>
            <select
              id="sim-doc"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              disabled={loading}
              className={campo}
            >
              <option value="">Nenhum (informar o número de páginas)</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {truncateTitle(documentDisplayName(d), 50)}{isOwnDocument(d) ? '' : ' (compartilhado)'}
                </option>
              ))}
            </select>
          </div>

          {/* Páginas */}
          <div>
            <span className={rotulo}>Páginas</span>
            {tipo === 'pdf' && contando ? (
              <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-300 py-2.5">
                <Loader2 size={16} className="animate-spin" /> Contando as páginas do PDF...
              </p>
            ) : contagemAutomatica ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  O documento tem <strong>{plural(paginasPdf, 'página', 'páginas')}</strong>.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setModoPaginas('todas')} className={botaoOpcao(modoPaginas === 'todas')}>
                    Todas
                  </button>
                  <button type="button" onClick={() => setModoPaginas('intervalo')} className={botaoOpcao(modoPaginas === 'intervalo')}>
                    Escolher páginas
                  </button>
                </div>
                {modoPaginas === 'intervalo' && (
                  <div>
                    <label htmlFor="sim-intervalo" className="sr-only">Páginas a imprimir</label>
                    <input
                      id="sim-intervalo"
                      value={intervalo}
                      onChange={(e) => setIntervalo(e.target.value)}
                      placeholder={`Ex.: 1-3, 5 (de 1 a ${paginasPdf})`}
                      className={campo}
                    />
                    <p className={`text-xs mt-1 ${intervaloInvalido ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      {intervaloInvalido
                        ? `Confira as páginas: use números de 1 a ${paginasPdf}, separados por vírgula ou com hífen.`
                        : paginasIntervalo
                          ? `${plural(paginasIntervalo.size, 'página selecionada', 'páginas selecionadas')}.`
                          : 'Separe por vírgula e use hífen para sequências. Vazio = todas as páginas.'}
                    </p>
                  </div>
                )}
              </div>
            ) : tipo === 'imagem' ? (
              <p className="text-sm text-gray-600 dark:text-gray-300 py-2.5">Imagem: conta como <strong>1 página</strong>.</p>
            ) : (
              <div>
                {erroContagem && <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">{erroContagem}</p>}
                {tipo === 'outro' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Não dá para contar as páginas deste formato automaticamente. Informe quantas páginas ele tem.
                  </p>
                )}
                <label htmlFor="sim-paginas" className="sr-only">Número de páginas</label>
                <input
                  id="sim-paginas"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_PAGINAS}
                  value={paginasManual}
                  onChange={(e) => setPaginasManual(e.target.value)}
                  className={`${campo} max-w-[10rem]`}
                />
                {totalDocumento === null && (
                  <p className="text-xs mt-1 text-red-600 dark:text-red-400">Informe um número de 1 a {MAX_PAGINAS}.</p>
                )}
              </div>
            )}
          </div>

          {/* Cópias */}
          <div>
            <label htmlFor="sim-copias" className={rotulo}>Cópias</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => mudarCopias(-1)}
                disabled={(nCopias ?? 1) <= 1}
                aria-label="Menos uma cópia"
                className="p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                <Minus size={16} />
              </button>
              <input
                id="sim-copias"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COPIAS}
                value={copias}
                onChange={(e) => setCopias(e.target.value)}
                className={`${campo} w-20 text-center tabular-nums`}
              />
              <button
                type="button"
                onClick={() => mudarCopias(1)}
                disabled={(nCopias ?? 1) >= MAX_COPIAS}
                aria-label="Mais uma cópia"
                className="p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                <Plus size={16} />
              </button>
            </div>
            {nCopias === null && <p className="text-xs mt-1 text-red-600 dark:text-red-400">De 1 a {MAX_COPIAS} cópias.</p>}
          </div>

          {/* Cor */}
          <div>
            <span className={rotulo}>Cor</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfig((c) => ({ ...c, color: 'bw' }))} className={botaoOpcao(config.color === 'bw')}>
                Preto e branco
              </button>
              <button type="button" onClick={() => setConfig((c) => ({ ...c, color: 'color' }))} className={botaoOpcao(config.color === 'color')}>
                Colorido
              </button>
            </div>
          </div>

          {/* Lados */}
          <div>
            <span className={rotulo}>Lados</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfig((c) => ({ ...c, duplex: 'single' }))} className={botaoOpcao(efetiva.duplex === 'single')}>
                Simples
              </button>
              <button
                type="button"
                onClick={() => setConfig((c) => ({ ...c, duplex: 'duplex' }))}
                disabled={!podeFrenteVerso}
                className={botaoOpcao(efetiva.duplex === 'duplex')}
              >
                Frente e verso
              </button>
            </div>
            {!podeFrenteVerso && (
              <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">Frente e verso precisa de pelo menos 2 páginas.</p>
            )}
          </div>
        </motion.section>

        {/* Resultado */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="lg:col-span-2 lg:sticky lg:top-6 space-y-4"
          aria-live="polite"
        >
          <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl p-6 text-white">
            <div className="flex items-center gap-2 text-primary-100 text-sm font-medium mb-1">
              <Calculator size={18} /> Custo estimado
            </div>
            <p className="text-4xl font-bold tabular-nums tracking-tight">{valido ? formatBRL(custo) : '—'}</p>
            {valido && (
              <p className="text-sm text-primary-100 mt-2">
                {plural(paginasImpressas, 'página impressa', 'páginas impressas')} · {plural(folhas, 'folha', 'folhas')} ·{' '}
                {formatBRL(getPrintPrice(efetiva))} por página
              </p>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium mb-1">
              <Wallet size={16} className="text-gray-400" /> Seu saldo
            </div>
            {credits === null ? (
              <p className="text-gray-500 dark:text-gray-400">{loading ? 'Carregando...' : 'Não foi possível carregar o saldo.'}</p>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-300">Saldo atual</span>
                  <span className="tabular-nums">{formatBRL(credits)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-300">Esta impressão</span>
                  <span className="tabular-nums">{valido ? `−${formatBRL(custo)}` : '—'}</span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t border-gray-100 dark:border-gray-700">
                  <span>Saldo depois</span>
                  <span className="tabular-nums">
                    {!valido || (saldoApos !== null && saldoApos < 0) ? '—' : formatBRL(saldoApos ?? 0)}
                  </span>
                </div>
                {saldoApos !== null && saldoApos < 0 && (
                  <div className="flex items-start gap-2 mt-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <p>
                      Faltam <strong>{formatBRL(-saldoApos)}</strong> para esta impressão.{' '}
                      <Link to="/credits" className="underline font-medium">Comprar créditos</Link>
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Valor estimado com os preços atuais. O valor final é calculado no kiosk, no momento da impressão.
          </p>
        </motion.section>
      </div>

      {/* Comparação das configurações para as mesmas páginas */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-8"
      >
        <h2 className="font-heading text-xl font-bold mb-1">Comparar configurações</h2>
        <p className="text-sm text-gray-500 dark:text-gray-300 mb-4">
          {valido ? `Para ${plural(paginasImpressas, 'página impressa', 'páginas impressas')}. Toque em uma linha para escolher.` : 'Preencha as páginas e as cópias para comparar.'}
        </p>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
          {opcoes.map((o) => {
            const escolhida = o.config.color === efetiva.color && o.config.duplex === efetiva.duplex
            return (
              <button
                key={o.label}
                type="button"
                disabled={!o.disponivel}
                onClick={() => setConfig(o.config)}
                className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  escolhida ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <FileText size={16} className={escolhida ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400'} />
                <span className="flex-1 min-w-0 text-sm font-medium">
                  {o.label}
                  {valido && o.disponivel && o.custo === maisBarata && (
                    <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                      Mais barata
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums hidden sm:inline">
                  {formatBRL(getPrintPrice(o.config))}/página
                </span>
                <span className="w-24 text-right text-sm font-semibold tabular-nums">
                  {!o.disponivel ? 'Indisponível' : valido ? formatBRL(o.custo) : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </motion.section>
    </div>
  )
}
