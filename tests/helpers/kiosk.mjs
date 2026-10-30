// Sobe o servidor real do kiosk (kiosk/server-kiosk.js) apontando para o backend
// simulado, com um intermediário que permite simular falhas do servidor principal.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { base as backend, realFetch } from './backend.mjs';
import { FILA } from './impressora.mjs';
import { gerarPdf } from './pdf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ── Intermediário kiosk → backend, com falhas programáveis ───────────
// falhas.print = [ 'indisponivel' | 'perde-resposta', ... ]: uma por chamada a /api/print
export const falhas = { print: [] };
export const chamadasAoBackend = [];
const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  chamadasAoBackend.push(req.url);
  const falha = req.url === '/api/print' ? falhas.print.shift() : undefined;
  if (falha === 'indisponivel') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"indisponível"}'); }
  const r = await realFetch(backend + req.url, { method: req.method, headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const text = await r.text();
  // O débito acontece no backend, mas a resposta "se perde" no caminho
  if (falha === 'perde-resposta') { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end('{"error":"gateway"}'); }
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(text);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const MAIN = `http://127.0.0.1:${proxy.address().port}`;

// ── Servidor de arquivos (os PDFs que o kiosk baixa para imprimir) ───
export const arquivos = new Map(); // caminho -> Buffer
arquivos.set('/uploads/doc.pdf', gerarPdf({ paginas: 3 }));
const files = http.createServer((req, res) => {
  const buf = arquivos.get(req.url.split('?')[0]);
  if (!buf) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
  res.end(buf);
});
await new Promise((r) => files.listen(0, '127.0.0.1', r));
export const filesBase = `http://127.0.0.1:${files.address().port}`;

// ── Servidor do kiosk ────────────────────────────────────────────────
export const log = [];
let proc;
export let kiosk;

export async function subirKiosk(env = {}) {
  const port = 4100 + Math.floor(Math.random() * 800);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-kiosk-cache-'));
  proc = spawn(process.execPath, [path.join(ROOT, 'kiosk/server-kiosk.js')], {
    env: { ...process.env, MAIN_SERVER: MAIN, KIOSK_PORT: String(port), CUPS_PRINTER: FILA, KIOSK_CACHE_DIR: cache, KIOSK_ENV_FILE: '/nonexistent', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => log.push(String(d)));
  proc.stderr.on('data', (d) => log.push(String(d)));
  kiosk = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await realFetch(kiosk + '/api/print/status/x'); return kiosk; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('kiosk não subiu');
}

export async function derrubarKiosk() {
  if (!proc) return;
  proc.kill('SIGKILL');
  await new Promise((r) => proc.once('exit', r));
  proc = null;
}

export async function encerrar() {
  await derrubarKiosk();
  proxy.close();
  files.close();
}

export async function k(rota, { body, token } = {}) {
  const r = await realFetch(kiosk + rota, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }
    : { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// Espera o trabalho terminar (completed/error) do ponto de vista do kiosk
export async function esperarFim(jobId, timeoutMs = 60_000) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    const r = await k(`/api/print/status/${jobId}`);
    if (['completed', 'error'].includes(r.data?.status)) return r.data;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { status: 'timeout' };
}
