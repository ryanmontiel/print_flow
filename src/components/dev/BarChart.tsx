import { useEffect, useRef, useState } from 'react'

export type Serie = { nome: string; cor: string }
export type Ponto = { rotulo: string; rotuloLongo?: string; valores: number[] }

type Props = {
  titulo: string
  series: Serie[]
  pontos: Ponto[]
  formatar: (v: number) => string
  altura?: number
  vazio?: string
}

const MARGEM = { topo: 12, direita: 8, base: 26, esquerda: 56 }

// Topo "redondo" para o eixo: 1, 2, 2.5, 5, 10 × potência de 10
function tetoBonito(max: number) {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

// Barra com os cantos de cima arredondados (4px) e base reta no eixo
function barra(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function useLargura() {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(260, Math.floor(e.contentRect.width))))
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return { ref, largura }
}

export default function BarChart({ titulo, series, pontos, formatar, altura = 220, vazio = 'Sem movimento no período' }: Props) {
  const { ref, largura } = useLargura()
  const [ativo, setAtivo] = useState<number | null>(null)
  const [verTabela, setVerTabela] = useState(false)

  const max = tetoBonito(Math.max(0, ...pontos.flatMap((p) => p.valores)))
  const temDados = pontos.some((p) => p.valores.some((v) => v > 0))
  const w = largura - MARGEM.esquerda - MARGEM.direita
  const h = altura - MARGEM.topo - MARGEM.base
  const grupo = pontos.length ? w / pontos.length : w
  const ns = series.length
  const larguraBarra = Math.max(2, Math.min(28, (grupo * 0.72 - (ns - 1) * 2) / ns))
  const y = (v: number) => MARGEM.topo + h - (v / max) * h
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  // Rótulos do eixo X espaçados para não se sobreporem (~56px cada)
  const passo = Math.max(1, Math.ceil(pontos.length / Math.max(1, Math.floor(w / 56))))

  return (
    <div ref={ref} className="viz-root">
      {/* O título aparece no cartão; aqui ele só descreve o gráfico para leitores de tela */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-4">
          {ns > 1 && (
            <ul className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300" aria-label="Legenda">
              {series.map((s) => (
                <li key={s.nome} className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: `var(${s.cor})` }} />
                  {s.nome}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setVerTabela((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {verTabela ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </div>

      {verTabela ? (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="py-1.5 pr-4 font-medium">Período</th>
                {series.map((s) => <th key={s.nome} className="py-1.5 pr-4 font-medium text-right">{s.nome}</th>)}
              </tr>
            </thead>
            <tbody>
              {pontos.map((p) => (
                <tr key={p.rotulo} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1.5 pr-4">{p.rotuloLongo || p.rotulo}</td>
                  {p.valores.map((v, i) => <td key={i} className="py-1.5 pr-4 text-right">{formatar(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg width={largura} height={altura} role="img" aria-label={titulo} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={MARGEM.esquerda - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-axis)">
                  {formatar(t)}
                </text>
              </g>
            ))}
            {pontos.map((p, i) => {
              const x0 = MARGEM.esquerda + i * grupo + (grupo - (ns * larguraBarra + (ns - 1) * 2)) / 2
              return (
                <g key={p.rotulo}>
                  {p.valores.map((v, s) => v > 0 && (
                    <path
                      key={s}
                      d={barra(x0 + s * (larguraBarra + 2), y(v), larguraBarra, MARGEM.topo + h - y(v))}
                      fill={`var(${series[s].cor})`}
                      opacity={ativo === null || ativo === i ? 1 : 0.45}
                    />
                  ))}
                  {i % passo === 0 && (
                    <text x={MARGEM.esquerda + i * grupo + grupo / 2} y={altura - 8} textAnchor="middle" fontSize={11} fill="var(--viz-axis)">
                      {p.rotulo}
                    </text>
                  )}
                  {/* Área de toque: a coluna inteira, maior que a barra */}
                  <rect
                    x={MARGEM.esquerda + i * grupo}
                    y={MARGEM.topo}
                    width={grupo}
                    height={h}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${p.rotuloLongo || p.rotulo}: ${series.map((s, k) => `${s.nome} ${formatar(p.valores[k])}`).join(', ')}`}
                    onPointerEnter={() => setAtivo(i)}
                    onPointerLeave={() => setAtivo(null)}
                    onFocus={() => setAtivo(i)}
                    onBlur={() => setAtivo(null)}
                    style={{ outline: 'none' }}
                  />
                </g>
              )
            })}
            <line x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={MARGEM.topo + h} y2={MARGEM.topo + h} stroke="var(--viz-axis)" strokeWidth={1} />
          </svg>

          {!temDados && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 pointer-events-none">{vazio}</p>
          )}

          {ativo !== null && pontos[ativo] && (
            <div
              className="absolute z-10 pointer-events-none rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg px-3 py-2 text-sm"
              style={{
                left: Math.min(largura - 170, Math.max(0, MARGEM.esquerda + ativo * grupo + grupo / 2 - 85)),
                top: 0,
                width: 170,
              }}
            >
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{pontos[ativo].rotuloLongo || pontos[ativo].rotulo}</p>
              {series.map((s, k) => (
                <p key={s.nome} className="flex items-center gap-2">
                  <span className="inline-block w-3 h-0.5 rounded" style={{ background: `var(${s.cor})` }} />
                  <strong className="tabular-nums text-gray-900 dark:text-gray-100">{formatar(pontos[ativo].valores[k])}</strong>
                  {ns > 1 && <span className="text-gray-500 dark:text-gray-400 text-xs">{s.nome}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
