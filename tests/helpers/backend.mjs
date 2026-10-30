// Sobe o backend real (server.js) com os serviços externos simulados em memória:
// Sheetlabs (banco), InfinitePay (pagamentos), Cloudflare R2 (arquivos) e SMTP (email).
//
// Opções (variáveis de ambiente, lidas antes do import):
//   PF_SHEET_LATENCY = 'none' | 'real'   latência do Sheetlabs (padrão: none)
//   PF_SHEET_CAP     = número            máximo de requisições simultâneas ao Sheetlabs
//   PF_BCRYPT_COST   = número            custo do bcrypt dos usuários criados (padrão 4)
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = (p) => path.join(ROOT, 'node_modules', p);

const { default: bcrypt } = await import(mod('bcryptjs/index.js'));

process.env.VERCEL = '1';                 // não chama app.listen
process.env.SHEET_DATATABLE_ID = '1';
process.env.SHEET_USERNAME = 'u';
process.env.SHEET_TOKEN = 't';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_ENDPOINT = 'https://r2.test';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';
process.env.APP_SECRET = 'test-app-secret';
process.env.SMTP_USER = 'teste@gmail.com';
process.env.SMTP_PASS = 'x';

export const APP_SECRET = process.env.APP_SECRET;

// ── Modelo de latência do Sheetlabs ──────────────────────────────────
// Distribuição medida no Sheetlabs real (out/2026, consultas só de leitura):
// ~60% entre 0,2–0,3 s, ~30% entre 0,68–0,76 s, ~8% entre 1,0–1,25 s, ~2% picos de ~6 s.
const LATENCY = process.env.PF_SHEET_LATENCY || 'none';
const CAP = Number(process.env.PF_SHEET_CAP || 0);
const rand = (a, b) => a + Math.random() * (b - a);
const sampleLatency = () => {
  if (LATENCY !== 'real') return 0;
  const r = Math.random();
  if (r < 0.6) return rand(200, 300);
  if (r < 0.9) return rand(680, 760);
  if (r < 0.98) return rand(1000, 1250);
  return rand(6000, 6400);
};

let active = 0;
const waiting = [];
const acquire = () => (!CAP || active < CAP ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const release = () => { if (waiting.length) waiting.shift()(); else active--; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = { sheetRequests: 0, sheetListAll: 0, sheetPatches: 0, maxConcurrentSheet: 0 };
let concurrent = 0;

// ── Estado simulado ──────────────────────────────────────────────────
export const db = new Map();          // __id -> registro
let nextId = 1;
export const paid = new Set();        // order_nsu que a InfinitePay considera pagos
export const r2Objects = new Map();   // chave -> tamanho
export const sentEmails = [];
export const calls = [];

const BCRYPT_COST = Number(process.env.PF_BCRYPT_COST || 4);

export async function addUser(fields) {
  const rec = {
    __id: nextId++, creditos: '0', verificado: 'true', documentos: '[]', notificacoes: '[]',
    transacoes: '[]', historicoimpressao: '[]', pagamentospendentes: '{}', nome: 'Aluno',
    ...fields,
  };
  if (fields.senha) { rec.senhahash = await bcrypt.hash(fields.senha, BCRYPT_COST); delete rec.senha; }
  db.set(rec.__id, rec);
  return rec;
}

export const user = (u) => db.get(u.__id);
export const json = (u, field) => JSON.parse(db.get(u.__id)[field]);

// ── fetch simulado (Sheetlabs e InfinitePay) ─────────────────────────
const realFetch = globalThis.fetch;
export { realFetch };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = (opts.method || 'GET').toUpperCase();
  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (u.hostname === 'sheetlabs.com') {
    await acquire();
    concurrent++; stats.maxConcurrentSheet = Math.max(stats.maxConcurrentSheet, concurrent);
    try {
      stats.sheetRequests++;
      await sleep(sampleLatency());
      const m = u.pathname.match(/^\/records\/PTFL\/1(?:\/(\d+))?$/);
      if (!m) return reply(404, {});
      const id = m[1] && Number(m[1]);
      if (method === 'GET') {
        const email = u.searchParams.get('email');
        if (!email) stats.sheetListAll++;
        const all = [...db.values()].map((r) => ({ ...r }));
        return reply(200, email ? all.filter((r) => r.email === email) : all);
      }
      if (method === 'PATCH') {
        stats.sheetPatches++;
        const body = JSON.parse(opts.body);
        calls.push({ type: 'patch', id, body });
        const rec = db.get(id); if (!rec) return reply(404, {});
        Object.assign(rec, body);
        return reply(204);
      }
      if (method === 'POST') {
        const rec = { __id: nextId++, ...JSON.parse(opts.body) }; db.set(rec.__id, rec); return reply(201, rec);
      }
      return reply(405, {});
    } finally {
      concurrent--;
      release();
    }
  }
  if (u.hostname === 'api.checkout.infinitepay.io') {
    const body = JSON.parse(opts.body || '{}');
    calls.push({ type: 'infinitepay', path: u.pathname, body });
    await sleep(LATENCY === 'real' ? rand(200, 400) : 0);
    if (u.pathname === '/links') return reply(200, { url: `https://pay.test/${body.order_nsu}` });
    if (u.pathname === '/payment_check') {
      return reply(200, paid.has(body.order_nsu) ? { paid: true, transaction_nsu: 'tx-' + body.order_nsu, capture_method: 'pix' } : { paid: false });
    }
  }
  return realFetch(url, opts);
};

// ── R2 simulado (o S3Client não usa fetch) ───────────────────────────
const s3 = await import(mod('@aws-sdk/client-s3/dist-cjs/index.js'));
s3.S3Client.prototype.send = async function (cmd) {
  const name = cmd.constructor.name, key = cmd.input.Key;
  calls.push({ type: 'r2', method: name, key });
  if (name === 'HeadObjectCommand') {
    if (!r2Objects.has(key)) { const e = new Error('NotFound'); e.name = 'NotFound'; throw e; }
    return { ContentLength: r2Objects.get(key), ContentType: 'application/pdf' };
  }
  if (name === 'DeleteObjectCommand') { r2Objects.delete(key); return {}; }
  throw new Error('comando S3 inesperado ' + name);
};

// ── SMTP simulado ────────────────────────────────────────────────────
const { default: nodemailer } = await import(mod('nodemailer/dist/esm/nodemailer.js'));
nodemailer.createTransport = () => ({ sendMail: async (m) => { sentEmails.push(m); return {}; } });

// ── Sobe o servidor ──────────────────────────────────────────────────
const { default: app } = await import(path.join(ROOT, 'server.js'));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
server.keepAliveTimeout = 60000;
export const base = `http://127.0.0.1:${server.address().port}`;
export const close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });

export async function api(p, { method = 'POST', body, headers = {}, token } = {}) {
  const r = await realFetch(base + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

export async function login(email, senha, extra = {}) {
  const r = await api('/api/login', { body: { email, senha, ...extra } });
  if (!r.data?.token) throw new Error('login falhou ' + JSON.stringify(r));
  return r.data.token;
}
