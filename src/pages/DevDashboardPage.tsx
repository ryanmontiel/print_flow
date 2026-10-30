import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiDevMetrics, formatBRL, formatBytes, type DevMetrics } from '../api'
import BarChart from '../components/dev/BarChart'
import DevLayout from '../components/dev/DevLayout'

// ── Datas no fuso de Brasília (o mesmo usado pelo servidor) ──────────
const TZ = 'America/Sao_Paulo'
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const rotuloLongoDia = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

type Preset = 'hoje' | '7d' | '30d' | '90d' | 'mes' | 'mesPassado' | 'tudo' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mesPassado', label: 'Mês passado' },
  { id: 'tudo', label: 'Tudo' },
  { id: 'custom', label: 'Personalizado' },
]

function intervalo(p: Preset, custom: { from: string; to: string }) {
  const h = hoje()
  switch (p) {
    case 'hoje': return { from: h, to: h }
    case '7d': return { from: somarDias(h, -6), to: h }
    case '30d': return { from: somarDias(h, -29), to: h }
    case '90d': return { from: somarDias(h, -89), to: h }
    case 'mes': return { from: `${h.slice(0, 7)}-01`, to: h }
    case 'mesPassado': {
      const fim = somarDias(`${h.slice(0, 7)}-01`, -1)
      return { from: `${fim.slice(0, 7)}-01`, to: fim }
    }
    case 'tudo': return { from: 'all', to: h }
    case 'custom': return custom
  }
}

const inteiro = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const reaisEixo = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 2 : 0 })}`)

function Tile({ label, valor, detalhe }: { label: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{detalhe}</p>}
    </div>
  )
}

function Card({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{titulo}</h2>
        {nota && <span className="text-xs text-gray-500 dark:text-gray-400">{nota}</span>}
      </div>
      {children}
    </section>
  )
}

function Linhas({ itens }: { itens: [string, string][] }) {
  return (
    <dl className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
      {itens.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 py-2">
          <dt className="text-gray-600 dark:text-gray-300">{k}</dt>
          <dd className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function DevDashboardPage() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [custom, setCustom] = useState(() => ({ from: somarDias(hoje(), -6), to: hoje() }))
  const [dados, setDados] = useState<DevMetrics | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async (fresh = false) => {
    const { from, to } = intervalo(preset, custom)
    if (from !== 'all' && from > to) { setErro('A data inicial é depois da final.'); return }
    setCarregando(true)
    setErro('')
    try {
      setDados(await apiDevMetrics({ from, to, fresh }))
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar as métricas')
    } finally {
      setCarregando(false)
    }
  }, [preset, custom])

  useEffect(() => { carregar() }, [carregar])

  const m = dados
  const porMes = m?.periodo.granularidade === 'mes'
  const pontosDinheiro = (m?.serie || []).map((s) => ({
    rotulo: porMes ? rotuloMes(s.periodo) : rotuloDia(s.periodo),
    rotuloLongo: porMes ? rotuloMes(s.periodo) : rotuloLongoDia(s.periodo),
    valores: [s.creditosComprados, s.receitaImpressoes],
  }))
  const pontosPaginas = (m?.serie || []).map((s) => ({
    rotulo: porMes ? rotuloMes(s.periodo) : rotuloDia(s.periodo),
    rotuloLongo: `${porMes ? rotuloMes(s.periodo) : rotuloLongoDia(s.periodo)} · ${inteiro(s.trabalhos)} impressões`,
    valores: [s.paginas],
  }))
  const pontosHora = (m?.impressoes.porHora || []).map((n, h) => ({ rotulo: `${h}h`, rotuloLongo: `${h}h às ${h}h59`, valores: [n] }))
  const maxTipo = Math.max(1, ...(m?.impressoes.porTipo || []).map((t) => t.paginas))

  return (
    <DevLayout>
      {/* Filtros: uma linha acima de tudo; valem para todos os números do período */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${preset === p.id ? 'bg-white dark:bg-gray-700 shadow-sm font-semibold' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              De
              <input id="dev-de" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="block mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100" />
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Até
              <input id="dev-ate" type="date" value={custom.to} min={custom.from} max={hoje()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="block mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100" />
            </label>
          </div>
        )}
        <button type="button" onClick={() => carregar(true)} disabled={carregando}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} /> Atualizar
        </button>
        {m && (
          <span className="text-xs text-gray-500 dark:text-gray-400 pb-2">
            {dataBR(m.periodo.from)} a {dataBR(m.periodo.to)} · dados de {new Date(m.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {erro && <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm">{erro}</p>}

      {!m && !erro && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando métricas...</p>}

      {m && (
        <div className={`space-y-6 transition-opacity ${carregando ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label="Gasto em impressões" valor={formatBRL(m.impressoes.receita)} detalhe={`média de ${formatBRL(m.impressoes.ticketMedio)} por impressão`} />
            <Tile label="Créditos comprados (Pix)" valor={formatBRL(m.creditos.valor)} detalhe={`${inteiro(m.creditos.compras)} compras de ${inteiro(m.creditos.compradores)} alunos`} />
            <Tile label="Impressões" valor={inteiro(m.impressoes.trabalhos)} detalhe={`${inteiro(m.impressoes.paginas)} páginas · ${m.impressoes.paginasPorTrabalho.toLocaleString('pt-BR')} por impressão`} />
            <Tile label="Alunos que imprimiram" valor={inteiro(m.impressoes.alunos)} detalhe={`de ${inteiro(m.alunos.total)} cadastrados`} />
          </div>

          <Card titulo="Dinheiro movimentado" nota={porMes ? 'por mês' : 'por dia'}>
            <BarChart
              titulo="Créditos comprados e gasto em impressões"
              series={[{ nome: 'Créditos comprados', cor: '--series-1' }, { nome: 'Gasto em impressões', cor: '--series-2' }]}
              pontos={pontosDinheiro}
              formatar={reaisEixo}
            />
          </Card>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card titulo="Páginas impressas" nota={porMes ? 'por mês' : 'por dia'}>
              <BarChart titulo="Páginas" series={[{ nome: 'Páginas', cor: '--series-1' }]} pontos={pontosPaginas} formatar={inteiro} />
            </Card>
            <Card titulo="Horário de uso do kiosk" nota="impressões por hora · horário de Brasília">
              <BarChart titulo="Impressões por hora do dia" series={[{ nome: 'Impressões', cor: '--series-1' }]} pontos={pontosHora} formatar={inteiro} />
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <Card titulo="Impressões por tipo">
              <table className="w-full text-sm tabular-nums viz-root">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="pb-2 font-medium">Tipo</th>
                    <th className="pb-2 font-medium text-right">Impr.</th>
                    <th className="pb-2 font-medium text-right">Páginas</th>
                    <th className="pb-2 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {m.impressoes.porTipo.map((t) => (
                    <tr key={t.tipo} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="py-2 pr-2">
                        {t.label}
                        <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
                          <div className="h-1.5 rounded-full" style={{ width: `${(t.paginas / maxTipo) * 100}%`, background: 'var(--series-1)' }} />
                        </div>
                      </td>
                      <td className="py-2 text-right">{inteiro(t.trabalhos)}</td>
                      <td className="py-2 text-right">{inteiro(t.paginas)}</td>
                      <td className="py-2 text-right">{formatBRL(t.receita)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card titulo="Compras de crédito">
              <Linhas itens={[
                ['Compras pagas', inteiro(m.creditos.compras)],
                ['Valor total', formatBRL(m.creditos.valor)],
                ['Alunos que compraram', inteiro(m.creditos.compradores)],
                ['Valor médio por compra', formatBRL(m.creditos.ticketMedio)],
                ...m.creditos.porValor.map((p): [string, string] => [`Pacote de ${formatBRL(p.valor)}`, `${inteiro(p.compras)} compras`]),
              ]} />
              {m.creditos.manuais.lancamentos > 0 && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Fora do total: {inteiro(m.creditos.manuais.lancamentos)} lançamentos manuais ({formatBRL(m.creditos.manuais.valor)}), de testes ou de versões antigas.
                </p>
              )}
            </Card>

            <Card titulo="Pagamentos Pix">
              <Linhas itens={[
                ['Links de pagamento gerados', inteiro(m.pagamentos.linksGerados)],
                ['Pagos', inteiro(m.pagamentos.pagos)],
                ['Não pagos', `${inteiro(m.pagamentos.pendentes)} (${formatBRL(m.pagamentos.valorPendente)})`],
                ['Conversão', m.pagamentos.linksGerados ? pct(m.pagamentos.conversao) : '—'],
              ]} />
            </Card>

            <Card titulo="Ajustes da equipe" nota="no período · fora das compras">
              <Linhas itens={[
                ['Ajustes feitos', inteiro(m.ajustes.lancamentos)],
                ['Créditos adicionados', formatBRL(m.ajustes.adicionado)],
                ['Créditos removidos', formatBRL(m.ajustes.removido)],
              ]} />
            </Card>

            <Card titulo="Alunos" nota="no período">
              <Linhas itens={[
                ['Novos cadastros', inteiro(m.alunos.novos)],
                ['Com acesso no período', inteiro(m.alunos.ativos)],
                ['Imprimiram', inteiro(m.alunos.imprimiram)],
                ['Compraram créditos', inteiro(m.alunos.compraram)],
                ['Cadastrados (total)', inteiro(m.alunos.total)],
                ['Email verificado (total)', inteiro(m.alunos.verificados)],
              ]} />
            </Card>

            <Card titulo="Situação atual" nota="não depende do filtro">
              <Linhas itens={[
                ['Créditos ainda não usados', formatBRL(m.situacao.saldoEmContas)],
                ['Alunos com saldo', inteiro(m.situacao.alunosComSaldo)],
                ['Documentos guardados', inteiro(m.situacao.documentos)],
                ['Armazenamento usado', formatBytes(m.situacao.armazenamentoBytes)],
                ['Documentos recebidos por compartilhamento', inteiro(m.situacao.compartilhados)],
              ]} />
            </Card>

            <Card titulo="Compartilhamentos" nota="não depende do filtro">
              <Linhas itens={[
                ['Aceitos', inteiro(m.situacao.compartilhamentos.aceitos)],
                ['Aguardando resposta', inteiro(m.situacao.compartilhamentos.pendentes)],
                ['Recusados', inteiro(m.situacao.compartilhamentos.recusados)],
              ]} />
            </Card>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Datas e horários no fuso de Brasília. "Créditos ainda não usados" é o dinheiro que os alunos já pagaram e ainda podem gastar em impressões.
          </p>
        </div>
      )}
    </DevLayout>
  )
}
