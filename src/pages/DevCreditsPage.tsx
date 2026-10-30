import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { apiDevAdjustCredits, apiDevAdjustments, apiDevSearchUsers, formatBRL, type DevAjuste, type DevAluno } from '../api'
import DevLayout from '../components/dev/DevLayout'

type Operacao = DevAjuste['operacao']
const OPERACOES: { id: Operacao; label: string }[] = [
  { id: 'adicionar', label: 'Adicionar' },
  { id: 'remover', label: 'Remover' },
  { id: 'definir', label: 'Definir saldo' },
]
const NOME_OPERACAO: Record<Operacao, string> = { adicionar: 'Adição', remover: 'Remoção', definir: 'Saldo definido' }
const MAX = 1000
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function DevCreditsPage() {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<DevAluno[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aluno, setAluno] = useState<DevAluno | null>(null)
  const [operacao, setOperacao] = useState<Operacao>('adicionar')
  const [valorTexto, setValorTexto] = useState('')
  const [motivo, setMotivo] = useState('')
  // requestId é criado ao revisar: confirmar duas vezes reaproveita o mesmo pedido
  const [revisao, setRevisao] = useState<{ requestId: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [historico, setHistorico] = useState<DevAjuste[]>([])
  const [filtroHistorico, setFiltroHistorico] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const carregarHistorico = useCallback(async () => {
    try { setHistorico((await apiDevAdjustments()).ajustes) } catch { /* mostra o que já tinha */ }
  }, [])
  useEffect(() => { carregarHistorico() }, [carregarHistorico])

  const buscar = (texto: string) => {
    setBusca(texto)
    if (timer.current) clearTimeout(timer.current)
    if (texto.trim().length < 3) { setResultados([]); return }
    timer.current = setTimeout(async () => {
      setBuscando(true)
      try { setResultados((await apiDevSearchUsers(texto.trim())).users) } catch { setResultados([]) } finally { setBuscando(false) }
    }, 300)
  }

  const escolher = (a: DevAluno) => {
    setAluno(a); setResultados([]); setBusca('')
    setValorTexto(''); setMotivo(''); setRevisao(null); setErro(''); setSucesso('')
  }

  const valor = round2(Number(valorTexto.replace(',', '.')))
  const valorOk = Number.isFinite(valor) && valor <= MAX && (operacao === 'definir' ? valor >= 0 && valorTexto.trim() !== '' : valor > 0)
  const saldoNovo = aluno && valorOk
    ? operacao === 'adicionar' ? round2(aluno.creditos + valor) : operacao === 'remover' ? round2(aluno.creditos - valor) : valor
    : null
  const motivoOk = motivo.trim().length >= 5 && motivo.trim().length <= 200
  const podeRevisar = Boolean(aluno && valorOk && saldoNovo !== null && saldoNovo >= 0 && saldoNovo !== aluno.creditos && motivoOk)

  const confirmar = async () => {
    if (!aluno || !revisao || enviando) return
    setEnviando(true); setErro('')
    try {
      const r = await apiDevAdjustCredits({ email: aluno.email, operacao, valor, motivo: motivo.trim(), requestId: revisao.requestId })
      setSucesso(`Ajuste registrado. Saldo de ${aluno.nome || aluno.email}: ${formatBRL(r.saldoAnterior)} → ${formatBRL(r.saldoNovo)}.`)
      setAluno({ ...aluno, creditos: r.saldoNovo })
      setValorTexto(''); setMotivo(''); setRevisao(null)
      carregarHistorico()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao registrar o ajuste')
      setRevisao(null)
    } finally {
      setEnviando(false)
    }
  }

  const descricaoRevisao = aluno && saldoNovo !== null
    ? `${operacao === 'adicionar' ? `Adicionar ${formatBRL(valor)} a` : operacao === 'remover' ? `Remover ${formatBRL(valor)} de` : `Definir em ${formatBRL(valor)} o saldo de`} ${aluno.nome || aluno.email}. O saldo passa de ${formatBRL(aluno.creditos)} para ${formatBRL(saldoNovo)}.`
    : ''

  const historicoFiltrado = historico.filter((h) => {
    const q = filtroHistorico.trim().toLowerCase()
    return !q || h.aluno.email.includes(q) || h.aluno.nome.toLowerCase().includes(q) || h.motivo.toLowerCase().includes(q)
  })

  const campo = 'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm'

  return (
    <DevLayout>
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <section className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-3">
          <h2 className="font-semibold">Encontrar aluno</h2>
          <label htmlFor="dev-busca" className="sr-only">Nome ou email do aluno</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input id="dev-busca" value={busca} onChange={(e) => buscar(e.target.value)} placeholder="Nome ou email (mínimo 3 letras)" className={`${campo} pl-9`} autoComplete="off" />
          </div>
          {buscando && <p className="text-xs text-gray-500">Buscando...</p>}
          {resultados.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
              {resultados.map((r) => (
                <li key={r.email}>
                  <button type="button" onClick={() => escolher(r)} className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{r.nome || '(sem nome)'}{!r.verificado && <span className="ml-2 text-[10px] uppercase text-amber-600">não verificado</span>}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{r.email}</span>
                    </span>
                    <span className="text-sm tabular-nums shrink-0">{formatBRL(r.creditos)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca.trim().length >= 3 && !buscando && resultados.length === 0 && <p className="text-xs text-gray-500">Nenhum aluno encontrado.</p>}
        </section>

        <section className="lg:col-span-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4">
          <h2 className="font-semibold">Ajustar créditos</h2>
          {!aluno ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Busque e escolha um aluno ao lado.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{aluno.nome || '(sem nome)'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{aluno.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Saldo atual</p>
                  <p className="text-xl font-bold tabular-nums">{formatBRL(aluno.creditos)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-900/50 p-1 w-fit" role="group" aria-label="Operação">
                {OPERACOES.map((o) => (
                  <button key={o.id} type="button" aria-pressed={operacao === o.id} onClick={() => { setOperacao(o.id); setRevisao(null) }}
                    className={`px-3 py-1.5 rounded-md text-sm ${operacao === o.id ? 'bg-white dark:bg-gray-700 shadow-sm font-semibold' : 'text-gray-600 dark:text-gray-300'}`}>
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dev-valor" className="block text-sm mb-1">{operacao === 'definir' ? 'Novo saldo (R$)' : 'Valor (R$)'}</label>
                  <input id="dev-valor" inputMode="decimal" value={valorTexto} onChange={(e) => { setValorTexto(e.target.value); setRevisao(null) }} placeholder="0,00" className={campo} />
                  {valorTexto && !valorOk && <p className="mt-1 text-xs text-red-600">Valor inválido (até {formatBRL(MAX)}).</p>}
                </div>
                <div>
                  <p className="block text-sm mb-1">Resultado</p>
                  <p className={`px-3 py-2 rounded-lg text-sm tabular-nums ${saldoNovo !== null && saldoNovo < 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-gray-50 dark:bg-gray-900/50'}`}>
                    {formatBRL(aluno.creditos)} → {saldoNovo === null ? '—' : formatBRL(saldoNovo)}
                    {saldoNovo !== null && saldoNovo < 0 && ' (saldo não pode ficar negativo)'}
                  </p>
                </div>
              </div>

              <div>
                <label htmlFor="dev-motivo" className="block text-sm mb-1">Motivo <span className="text-gray-500">(aparece no extrato do aluno)</span></label>
                <textarea id="dev-motivo" rows={2} maxLength={200} value={motivo} onChange={(e) => { setMotivo(e.target.value); setRevisao(null) }}
                  placeholder="Ex.: reembolso de impressão que saiu com defeito" className={campo} />
                <p className="mt-1 text-xs text-gray-500">{motivo.trim().length}/200 · mínimo 5 caracteres</p>
              </div>

              {!revisao ? (
                <button type="button" disabled={!podeRevisar} onClick={() => { setRevisao({ requestId: crypto.randomUUID() }); setErro(''); setSucesso('') }}
                  className="px-4 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                  Revisar ajuste
                </button>
              ) : (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                  <p className="text-sm">{descricaoRevisao}</p>
                  <p className="text-sm">Motivo: <em>{motivo.trim()}</em></p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">O aluno verá no extrato "Ajuste feito pela equipe PrintFlow", com data, hora e motivo.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={confirmar} disabled={enviando}
                      className="px-4 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-semibold disabled:opacity-50">
                      {enviando ? 'Registrando...' : 'Confirmar ajuste'}
                    </button>
                    <button type="button" onClick={() => setRevisao(null)} disabled={enviando}
                      className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm">
                      Voltar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {erro && <p className="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2 text-sm">{erro}</p>}
          {sucesso && <p className="rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-3 py-2 text-sm">{sucesso}</p>}
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Histórico de ajustes</h2>
          <label htmlFor="dev-filtro-hist" className="sr-only">Filtrar histórico</label>
          <input id="dev-filtro-hist" value={filtroHistorico} onChange={(e) => setFiltroHistorico(e.target.value)} placeholder="Filtrar por aluno ou motivo" className={`${campo} max-w-xs`} />
        </div>
        {historicoFiltrado.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum ajuste registrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-4 font-medium">Data e hora</th>
                  <th className="py-2 pr-4 font-medium">Aluno</th>
                  <th className="py-2 pr-4 font-medium">Operação</th>
                  <th className="py-2 pr-4 font-medium text-right">Valor</th>
                  <th className="py-2 pr-4 font-medium text-right">Saldo</th>
                  <th className="py-2 pr-4 font-medium">Motivo</th>
                  <th className="py-2 font-medium">Feito por</th>
                </tr>
              </thead>
              <tbody>
                {historicoFiltrado.map((h, i) => (
                  <tr key={`${h.em}-${i}`} className="border-t border-gray-100 dark:border-gray-700 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{dataHora(h.em)}</td>
                    <td className="py-2 pr-4"><span className="block">{h.aluno.nome}</span><span className="block text-xs text-gray-500 dark:text-gray-400">{h.aluno.email}</span></td>
                    <td className="py-2 pr-4 whitespace-nowrap">{NOME_OPERACAO[h.operacao] || h.operacao}</td>
                    <td className={`py-2 pr-4 text-right whitespace-nowrap font-medium ${h.valor >= 0 ? 'text-green-600' : 'text-red-600'}`}>{h.valor >= 0 ? '+' : '−'}{formatBRL(Math.abs(h.valor))}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">{formatBRL(h.saldoAnterior)} → {formatBRL(h.saldoNovo)}</td>
                    <td className="py-2 pr-4 min-w-[14rem]">{h.motivo}</td>
                    <td className="py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{h.por}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DevLayout>
  )
}
