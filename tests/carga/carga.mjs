// Bateria 4: testes de carga. Sobe tests/carga/servidor.mjs num processo separado e
// simula alunos usando o site. Grava os resultados em tests/resultados/carga.json.
//
// Uso: node tests/carga/carga.mjs [cenário...]   (padrão: todos)
//   PF_SHEET_CAP=20 limita o banco simulado a 20 requisições simultâneas
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const ALUNOS = 500;
const CENARIOS = {
  normal: { usuarios: 50, duracao: 90, pausa: [3, 8], desc: '50 usuários navegando (≈10% dos alunos)' },
  pico: { usuarios: 200, duracao: 90, pausa: [3, 8], desc: '200 usuários navegando (pico de uso)' },
  estresse: { usuarios: 500, duracao: 90, pausa: [1, 3], desc: '500 usuários navegando sem parar (todos ao mesmo tempo)' },
  rajada: { usuarios: 500, rajadaLogin: 10, desc: '500 logins em 10 segundos' },
};
const LIMITES = { navegacao: 2000, login: 3000, erros: 0.01 };

const escolhidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CENARIOS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

async function subirServidor(metricas) {
  const proc = spawn(process.execPath, [path.join(DIR, 'servidor.mjs'), String(ALUNOS), metricas], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', (d) => { buf += d; const m = /PRONTO (\S+)/.exec(buf); if (m) resolve(m[1]); });
    proc.on('exit', (c) => reject(new Error('servidor saiu ' + c)));
  });
  return { proc, base };
}

function medidor() {
  const porRota = {};
  return {
    async chamar(base, rota, { method = 'POST', body, token } = {}) {
      const t = performance.now();
      let status = 0;
      try {
        const r = await fetch(base + rota, {
          method,
          headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        status = r.status;
        const data = await r.json().catch(() => null);
        return { status, data };
      } catch {
        status = 0; // timeout / conexão recusada
        return { status };
      } finally {
        const ms = performance.now() - t;
        const nome = rota.split('?')[0];
        (porRota[nome] ||= { ms: [], erros: 0 }).ms.push(ms);
        if (status === 0 || status >= 500) porRota[nome].erros++;
      }
    },
    resumo() {
      const out = {};
      for (const [rota, { ms, erros }] of Object.entries(porRota)) {
        ms.sort((a, b) => a - b);
        out[rota] = { requisicoes: ms.length, erros, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms.at(-1)) };
      }
      return out;
    },
  };
}

async function usuario(base, m, i, fim, pausa) {
  const login = await m.chamar(base, '/api/login', { body: { email: `carga${i}@academico.ifsul.edu.br`, senha: 'Senha@123' } });
  const token = login.data?.token;
  if (!token) return;
  const acoes = [
    () => m.chamar(base, '/api/documents', { body: {}, token }),
    () => m.chamar(base, '/api/credits', { method: 'GET', token }),
    () => m.chamar(base, '/api/notifications', { method: 'GET', token }),
    () => m.chamar(base, '/api/print-history', { method: 'GET', token }),
  ];
  while (Date.now() < fim) {
    await acoes[Math.floor(Math.random() * acoes.length)]();
    await sleep(rand(...pausa) * 1000);
  }
}

async function rodar(nome) {
  const c = CENARIOS[nome];
  const metricas = path.join(os.tmpdir(), `pf-carga-${nome}-${process.pid}.json`);
  const { proc, base } = await subirServidor(metricas);
  const m = medidor();
  const inicio = Date.now();
  console.error(`▶ ${nome}: ${c.desc}`);

  if (c.rajadaLogin) {
    const intervalo = (c.rajadaLogin * 1000) / c.usuarios;
    const reqs = [];
    for (let i = 1; i <= c.usuarios; i++) {
      reqs.push(m.chamar(base, '/api/login', { body: { email: `carga${i}@academico.ifsul.edu.br`, senha: 'Senha@123' } }));
      await sleep(intervalo);
    }
    await Promise.all(reqs);
  } else {
    const fim = Date.now() + Number(process.env.PF_CARGA_DURACAO || c.duracao) * 1000;
    // Usuários entram aos poucos ao longo dos primeiros 10 s
    await Promise.all(Array.from({ length: c.usuarios }, (_, i) => sleep((i / c.usuarios) * 10_000).then(() => usuario(base, m, i + 1, fim, c.pausa))));
  }

  const duracao = (Date.now() - inicio) / 1000;
  await sleep(1500);
  proc.kill();
  const amostras = JSON.parse(fs.readFileSync(metricas, 'utf8'));
  fs.unlinkSync(metricas);

  const rotas = m.resumo();
  const total = Object.values(rotas).reduce((s, r) => s + r.requisicoes, 0);
  const erros = Object.values(rotas).reduce((s, r) => s + r.erros, 0);
  const navegacao = Object.entries(rotas).filter(([r]) => r !== '/api/login');
  const p95Nav = Math.max(0, ...navegacao.map(([, r]) => r.p95));
  const p95Login = rotas['/api/login']?.p95 ?? 0;
  const aprovado = erros / total < LIMITES.erros && p95Nav <= LIMITES.navegacao && p95Login <= LIMITES.login;
  const ultimo = amostras.at(-1)?.sheet ?? {};
  return {
    cenario: nome,
    descricao: c.desc,
    usuarios: c.usuarios,
    duracaoS: Math.round(duracao),
    requisicoes: total,
    reqPorSegundo: +(total / duracao).toFixed(1),
    taxaErro: `${((erros / total) * 100).toFixed(2)}%`,
    p95NavegacaoMs: p95Nav,
    p95LoginMs: p95Login,
    cpuMaxPct: Math.max(...amostras.map((a) => a.cpu)),
    cpuMediaPct: Math.round(amostras.reduce((s, a) => s + a.cpu, 0) / amostras.length),
    memoriaMaxMB: Math.max(...amostras.map((a) => a.memMB)),
    consultasAoBanco: ultimo.sheetRequests,
    maxConsultasSimultaneasAoBanco: ultimo.maxConcurrentSheet,
    aprovado,
    rotas,
  };
}

const resultados = [];
for (const nome of escolhidos) {
  const r = await rodar(nome);
  resultados.push(r);
  console.error(`  ${r.aprovado ? 'APROVADO' : 'REPROVADO'}: ${r.requisicoes} req, ${r.reqPorSegundo} req/s, erros ${r.taxaErro}, p95 navegação ${r.p95NavegacaoMs} ms, p95 login ${r.p95LoginMs} ms, CPU máx ${r.cpuMaxPct}%, mem ${r.memoriaMaxMB} MB`);
}

const arquivo = path.join(DIR, '../resultados', `carga${process.env.PF_SHEET_CAP ? `-limite${process.env.PF_SHEET_CAP}` : ''}.json`);
fs.writeFileSync(arquivo, JSON.stringify({ data: new Date().toISOString(), latenciaBanco: process.env.PF_SHEET_LATENCY, limiteBanco: process.env.PF_SHEET_CAP || null, criterios: LIMITES, resultados }, null, 2));
console.error(`resultados em ${arquivo}`);
