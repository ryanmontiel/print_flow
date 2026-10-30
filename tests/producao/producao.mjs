// Bateria 5: verificação do site em produção (Vercel). Só usa rotas que não
// tocam no banco de dados, para não afetar os alunos.
//
// Uso: node tests/producao/producao.mjs [url]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'https://tcc-printflow.vercel.app';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

async function medir(url, init) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    await r.arrayBuffer();
    return { ms: performance.now() - t, status: r.status, headers: r.headers };
  } catch {
    return { ms: performance.now() - t, status: 0 };
  }
}

async function carga(nome, url, conexoes, segundos) {
  const ms = [];
  let erros = 0;
  const fim = Date.now() + segundos * 1000;
  await Promise.all(Array.from({ length: conexoes }, async () => {
    while (Date.now() < fim) {
      const r = await medir(url);
      ms.push(r.ms);
      if (r.status !== 200) erros++;
    }
  }));
  ms.sort((a, b) => a - b);
  return { nome, conexoes, segundos, requisicoes: ms.length, reqPorSegundo: +(ms.length / segundos).toFixed(1), erros, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), max: Math.round(ms.at(-1)) };
}

const resultado = { data: new Date().toISOString(), base: BASE };

// 1) Disponibilidade e primeira resposta
const primeiras = [];
for (const rota of ['/', '/login', '/api/health']) {
  const r = await medir(BASE + rota);
  primeiras.push({ rota, status: r.status, ms: Math.round(r.ms) });
}
resultado.disponibilidade = primeiras;

// 2) Rotas protegidas recusam acesso sem login, e rotas removidas não existem
const protegidas = [['GET', '/api/credits'], ['POST', '/api/documents'], ['POST', '/api/print'], ['GET', '/api/notifications'], ['POST', '/api/users/search'], ['POST', '/api/create-payment-link']];
const removidas = [['POST', '/api/credits/add'], ['POST', '/api/debug/add-credits'], ['GET', '/api/users']];
resultado.protecao = [];
for (const [method, rota] of protegidas) {
  const r = await medir(BASE + rota, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  resultado.protecao.push({ rota: `${method} ${rota}`, esperado: 401, status: r.status, ok: r.status === 401 });
}
for (const [method, rota] of removidas) {
  const r = await medir(BASE + rota, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  resultado.protecao.push({ rota: `${method} ${rota}`, esperado: 404, status: r.status, ok: r.status === 404 });
}

// 3) HTTPS e cabeçalhos de segurança
const http = await medir(BASE.replace('https://', 'http://') + '/', { redirect: 'manual' });
const site = await medir(BASE + '/');
const h = site.headers;
resultado.cabecalhos = {
  'HTTP redireciona para HTTPS': [301, 302, 307, 308].includes(http.status),
  'Strict-Transport-Security (HSTS)': h.get('strict-transport-security') || null,
  'X-Content-Type-Options': h.get('x-content-type-options') || null,
  'X-Frame-Options / frame-ancestors': h.get('x-frame-options') || (h.get('content-security-policy') || '').match(/frame-ancestors[^;]*/)?.[0] || null,
  'Content-Security-Policy': h.get('content-security-policy') || null,
  'Referrer-Policy': h.get('referrer-policy') || null,
};

// 4) Carga leve em rotas que não usam o banco
resultado.carga = [
  await carga('Página do site (/)', BASE + '/', 20, 30),
  await carga('API sem banco (/api/health)', BASE + '/api/health', 20, 30),
];

fs.writeFileSync(path.join(DIR, '../resultados/producao.json'), JSON.stringify(resultado, null, 2));
console.log(JSON.stringify(resultado, null, 2));
