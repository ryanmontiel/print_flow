import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
const port = process.env.PORT || 4002;

// ── Middleware ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  return next(error);
});

// ── Tipos de arquivo aceitos no upload ───────────────────────────────
const allowedMimes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/rtf', 'application/vnd.oasis.opendocument.text',
];
const isAllowedMime = (mime) => typeof mime === 'string' && (mime.startsWith('image/') || allowedMimes.includes(mime));

// ── Sheetlabs Admin API ──────────────────────────────────────────────
const ADMIN_API_BASE = 'https://sheetlabs.com';
const SHEET_ORG = 'PTFL';
const DATATABLE_NAME = 'printflow';

const getBasicAuthHeader = () => {
  const b64 = Buffer.from(`${process.env.SHEET_USERNAME}:${process.env.SHEET_TOKEN}`).toString('base64');
  return 'Basic ' + b64;
};

const FETCH_TIMEOUT = 30000;

const fetchWithTimeout = async (url, options = {}) => {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
};

const safeJson = async (r) => {
  try { return await r.json(); } catch { return null; }
};

// ── Cloudflare R2 (S3-compatível) ─────────────────────────────────────
// Credenciais só via variáveis de ambiente (.env local / painel da Vercel)
for (const name of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) console.error(`[config] ${name} não definida: uploads para o R2 vão falhar`);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const R2_BUCKET = process.env.R2_BUCKET || 'printflow';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-594eef513fd44bdc8069da8e0017a777.r2.dev';

// ── Limite de armazenamento por aluno (50 MB) ────────────────────────
const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
const PER_FILE_LIMIT_BYTES = 10 * 1024 * 1024;

// Segredo do servidor para assinar chaves de upload (e, depois, sessões).
const APP_SECRET = process.env.APP_SECRET || process.env.R2_SECRET_ACCESS_KEY || '';
if (!process.env.APP_SECRET) console.warn('[config] APP_SECRET não definida: usando R2_SECRET_ACCESS_KEY como segredo');

const hmac = (data) => crypto.createHmac('sha256', APP_SECRET).update(data).digest('hex');
const UPLOAD_KEY_MAX_AGE_MS = 60 * 60 * 1000;

// uploads/<timestamp>-<tag>-<nome>, onde tag = HMAC(email, timestamp, nome).
// Só quem pediu o upload consegue registrar a chave como documento, e a URL não é adivinhável.
const uploadTag = (email, ts, safeName) => hmac(`upload|${normalizeEmail(email)}|${ts}|${safeName}`).slice(0, 20);

const buildR2Key = (email, fileName) => {
  const ts = Date.now();
  const safeName = String(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  return `uploads/${ts}-${uploadTag(email, ts, safeName)}-${safeName}`;
};

const verifyUploadKey = (email, key) => {
  const m = /^uploads\/(\d+)-([0-9a-f]{20})-([a-zA-Z0-9._-]+)$/.exec(String(key || ''));
  if (!m) return false;
  const [, ts, tag, safeName] = m;
  if (Date.now() - Number(ts) > UPLOAD_KEY_MAX_AGE_MS) return false;
  const expected = uploadTag(email, ts, safeName);
  return crypto.timingSafeEqual(Buffer.from(tag), Buffer.from(expected));
};

const publicUrlForKey = (key) => `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

const isOwnDoc = (doc) => !!doc && !doc.compartilhado_de_email;

// Alguns deploys (ex.: Render) não tinham R2_PUBLIC_URL e salvavam documentos
// em um host inexistente (printflow.printflow.r2.dev). Reescreve qualquer
// *.r2.dev inválido para o host público correto para que o preview volte a funcionar.
const R2_PUBLIC_ORIGIN = (() => {
  try { return new URL(R2_PUBLIC_URL).origin; } catch { return ''; }
})();

const normalizeDocUrl = (doc) => {
  if (!doc || typeof doc.url !== 'string' || !doc.url || !R2_PUBLIC_ORIGIN) return doc;
  try {
    const u = new URL(doc.url);
    if (u.hostname.endsWith('.r2.dev') && u.origin !== R2_PUBLIC_ORIGIN) {
      return { ...doc, url: `${R2_PUBLIC_ORIGIN}${u.pathname}`, filename: `${R2_PUBLIC_ORIGIN}${u.pathname}` };
    }
  } catch {}
  return doc;
};

const normalizeDocUrls = (docs) => (Array.isArray(docs) ? docs : []).map(normalizeDocUrl);

const getUsedStorageBytes = (docs) =>
  (Array.isArray(docs) ? docs : [])
    .filter(isOwnDoc)
    .reduce((sum, doc) => sum + (Number(doc.size) || 0), 0);

const r2KeyFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    // Só URLs do nosso bucket (antes qualquer domínio com /uploads/... servia)
    if (!u.hostname.endsWith('.r2.dev')) return null;
    const pathname = u.pathname.replace(/^\//, '');
    return pathname.startsWith('uploads/') ? pathname : null;
  } catch {
    return null;
  }
};

const deleteFromR2 = async (url) => {
  const key = r2KeyFromUrl(url);
  if (!key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    console.log('R2 delete OK:', key);
  } catch (err) {
    console.error('R2 delete failed:', key, err?.message || err);
  }
};

const storageLimitReached = (usedBytes, incomingBytes) =>
  usedBytes + (Number(incomingBytes) || 0) > STORAGE_LIMIT_BYTES;

const storageErrorResponse = (res) =>
  res.status(413).json({
    error: 'Limite de armazenamento de 50 MB atingido. Exclua arquivos para enviar novos.',
    code: 'STORAGE_LIMIT',
    limitBytes: STORAGE_LIMIT_BYTES,
  });

// ── Email (Gmail SMTP via Nodemailer) ───────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || (SMTP_USER ? `PrintFlow <${SMTP_USER}>` : 'PrintFlow <noreply@printflow.local>');

const printCodeToConsole = (email, code) => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  CÓDIGO DE VERIFICAÇÃO               ║`);
  console.log(`║  Email: ${email}`);
  console.log(`║  Código: ${code}`);
  console.log(`╚══════════════════════════════════════╝\n`);
};

const sendVerificationEmail = async (email, code) => {
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
const html = `<div style="font-family:system-ui,-apple-system,sans-serif;padding:24px;background:#f6f6f6"><div style="max-width:420px;margin:auto;background:#fff;border-radius:12px;padding:24px"><h2 style="margin-top:0;color:#4F46E5">PrintFlow</h2><p>Seu código de verificação do PrintFlow é:</p><div style="font-size:40px;letter-spacing:8px;font-weight:700;text-align:center;margin:24px 0;padding:16px;background:#f2f7ff;border-radius:8px;color:#2563eb">${code}</div><p style="color:#999;font-size:12px">Expira em 10 minutos. Se você não solicitou, ignore este email.</p></div></div>`;
      await transporter.sendMail({ from: FROM_EMAIL, to: [email], subject: 'PrintFlow - Código de verificação', text: `PrintFlow\n\nSeu código de verificação é: ${code}\n\nExpira em 10 minutos. Se você não solicitou, ignore este email.`, html });
      console.log(`Email enviado para ${email} via ${SMTP_HOST}`);
      return true;
    } catch (err) {
      console.error('SMTP error:', err.message);
      console.error('Nodemailer config:', JSON.stringify({ host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, passSet: Boolean(SMTP_PASS) }));
      return false;
    }
  }
  // Sem SMTP configurado: só em desenvolvimento local o código vai para o console
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.error('[email] SMTP não configurado: código de verificação não enviado');
    return false;
  }
  printCodeToConsole(email, code);
  return true;
};

const sendPasswordResetEmail = async (email, token) => {
const frontend = process.env.FRONTEND_URL || '';
  let resetUrl;
  if (frontend.startsWith('http')) {
    resetUrl = `${frontend.replace(/\/$/, '')}/reset-password?code=${encodeURIComponent(token)}`;
  } else {
    resetUrl = `https://tcc-printflow.vercel.app/reset-password?code=${encodeURIComponent(token)}`;
  }
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
const html = `<div style="font-family:system-ui,-apple-system,sans-serif;padding:24px;background:#f6f6f6"><div style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:24px"><h2 style="margin-top:0;color:#4F46E5">PrintFlow</h2><p>Recebemos uma solicitação para redefinir sua senha.</p><p>Clique no botão abaixo para criar uma nova senha:</p><div style="text-align:center;margin:32px 0"><a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Redefinir senha</a></div><p style="color:#666;font-size:14px">Ou copie este link:</p><p style="word-break:break-all;font-size:12px;color:#2563eb">${resetUrl}</p><p style="color:#999;font-size:12px;margin-top:24px">Expira em 15 minutos. Se não foi você, ignore este email.</p></div></div>`;
      await transporter.sendMail({ from: FROM_EMAIL, to: [email], subject: 'PrintFlow - Recuperação de senha', text: `PrintFlow\n\nRecebemos uma solicitação para redefinir sua senha.\n\nAcesse o link abaixo para criar uma nova senha:\n${resetUrl}\n\nExpira em 15 minutos. Se não foi você, ignore este email.`, html });
      return true;
    } catch (err) {
      console.error('SMTP reset error:', err.message);
      return false;
    }
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.error('[email] SMTP não configurado: link de recuperação não enviado');
    return false;
  }
  console.log('Reset link:', resetUrl);
  return true;
};

// ── DB helpers ───────────────────────────────────────────────────────

// Resolve the numeric data-table id for DATATABLE_NAME (cached).
let cachedDatatableId = process.env.SHEET_DATATABLE_ID ? Number(process.env.SHEET_DATATABLE_ID) : null;

const getDatatableId = async () => {
  if (cachedDatatableId) return cachedDatatableId;
  const resp = await fetchWithTimeout(`${ADMIN_API_BASE}/datatables/${SHEET_ORG}`, {
    headers: { 'Authorization': getBasicAuthHeader() },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const table = Array.isArray(data) ? data.find((t) => t.name === DATATABLE_NAME) : null;
  cachedDatatableId = table ? table.id : null;
  return cachedDatatableId;
};

const recordsUrl = async () => {
  const id = await getDatatableId();
  return `${ADMIN_API_BASE}/records/${SHEET_ORG}/${id}`;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const listAllRecords = async () => {
  const resp = await fetchWithTimeout(await recordsUrl(), {
    headers: { 'Authorization': getBasicAuthHeader() },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
};

const findUserByEmail = async (email) => {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const resp = await fetchWithTimeout(`${await recordsUrl()}?email=${encodeURIComponent(norm)}`, {
    headers: { 'Authorization': getBasicAuthHeader() },
  });
  if (resp.ok) {
    const data = await resp.json();
    const arr = Array.isArray(data) ? data : [];
    const match = arr.find((r) => normalizeEmail(r.email) === norm);
    if (match) return match;
  }
  const records = await listAllRecords();
  return records.find((r) => normalizeEmail(r.email) === norm) || null;
};

const createUserRecord = async (fields) => {
  const resp = await fetchWithTimeout(await recordsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) {
    console.error('[createUserRecord] failed:', resp.status, await resp.text().catch(() => ''));
  }
  return resp.ok;
};

const updateUserRecord = async (recordId, fields) => {
  if (recordId === undefined || recordId === null) {
    console.error('[updateUserRecord] missing recordId for', fields && fields.email);
    return false;
  }
  const clean = { ...fields };
  delete clean.__id;
  const resp = await fetchWithTimeout(`${await recordsUrl()}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify(clean),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[updateUserRecord] PATCH failed:', resp.status, text);
    return false;
  }
  return true;
};

const deleteUserRecord = async (recordId) => {
  if (recordId === undefined || recordId === null) return false;
  const resp = await fetchWithTimeout(`${await recordsUrl()}/${recordId}`, {
    method: 'DELETE',
    headers: { 'Authorization': getBasicAuthHeader() },
  });
  return resp.ok;
};

const parseJsonField = (value, fallback) => {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
};

const parsePrinterPreferences = (value) => {
  try {
    const parsed = JSON.parse(value || '{}');
    return {
      color: parsed.color || 'bw',
      duplex: parsed.duplex || 'single',
    };
  } catch {
    return { color: 'bw', duplex: 'single' };
  }
};

// ── Auth helper ──────────────────────────────────────────────────────

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const authenticateUser = async (email, senha) => {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const stored = String(user.senhahash || '');
  const senhaStr = String(senha || '');
  if (!stored || !senhaStr) return null;
  if (stored.startsWith('$2')) {
    try { return (await bcrypt.compare(senhaStr, stored)) ? user : null; } catch { return null; }
  }
  // Contas antigas (texto puro ou sha256): confere e migra para bcrypt.
  // Antes, mandar o próprio hash como senha também logava.
  const legacyOk = /^[0-9a-f]{64}$/i.test(stored)
    ? safeEqual(crypto.createHash('sha256').update(senhaStr).digest('hex'), stored.toLowerCase())
    : safeEqual(senhaStr, stored);
  if (!legacyOk) return null;
  const senhahash = await bcrypt.hash(senhaStr, 10);
  if (await updateUserRecord(user.__id, { senhahash })) user.senhahash = senhahash;
  return user;
};

// ── Sessões ───────────────────────────────────────────────────────────
// Token assinado (HMAC) com email, validade e uma "impressão" do hash da senha:
// trocar a senha invalida todos os tokens antigos. A senha não trafega mais
// a cada requisição, só no login.
const SESSION_TTL_MS = {
  web: 24 * 60 * 60 * 1000,
  webRemember: 30 * 24 * 60 * 60 * 1000,
  kiosk: 2 * 60 * 60 * 1000,
};

const passwordStamp = (user) => hmac(`pw|${user.senhahash || ''}`).slice(0, 16);

const createSessionToken = (user, ttlMs) => {
  const payload = Buffer.from(JSON.stringify({ e: normalizeEmail(user.email), x: Date.now() + ttlMs, p: passwordStamp(user) })).toString('base64url');
  return `${payload}.${hmac(`session|${payload}`)}`;
};

const verifySessionToken = async (token) => {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(`session|${payload}`))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data?.e || !(Number(data.x) > Date.now())) return null;
  const user = await findUserByEmail(data.e);
  if (!user || !safeEqual(String(data.p || ''), passwordStamp(user))) return null;
  return user;
};

const requireAuth = async (req, res, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  try {
    const user = m ? await verifySessionToken(m[1]) : null;
    if (!user) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', code: 'SESSION_EXPIRED' });
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Falha na autenticação' });
  }
};

const generateCode = () => crypto.randomInt(100000, 1000000).toString();


// ── Validation rules ─────────────────────────────────────────────────
const INSTITUTIONAL_EMAIL_RE = /@(?:academico\.)?ifsul\.edu\.br$/i;
const PASSWORD_STRENGTH_RE = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

const isInstitutionalEmail = (email) => INSTITUTIONAL_EMAIL_RE.test(String(email || '').trim().toLowerCase());
const isValidPassword = (senha) => PASSWORD_STRENGTH_RE.test(String(senha || ''));

// ── Print pricing (BRL per page) ──────────────────────────────────────
const PRINT_PRICES = {
  bw: { single: 0.5, duplex: 0.35 },
  color: { single: 0.75, duplex: 0.6 },
};
const getUnitPrice = (color, duplex) => {
  const p = PRINT_PRICES[color] || PRINT_PRICES.bw;
  return p && p[duplex] != null ? p[duplex] : PRINT_PRICES.bw.single;
};
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
// "single" = preço por página; "duplex" = preço por folha (2 páginas por folha).
const getPrintCost = (color, duplex, pages) => {
  const price = getUnitPrice(color, duplex);
  const n = Number(pages) || 1;
  return round2(n * price);
};

// ═══════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── Health ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// ── Register ─────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, nome, senha } = req.body;
  if (!email || !nome || !senha) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  const normEmail = String(email).trim().toLowerCase();
  if (!normEmail.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  if (!isInstitutionalEmail(normEmail)) {
    return res.status(400).json({ error: 'Email deve ser institucional (@academico.ifsul.edu.br ou @ifsul.edu.br)' });
  }
  if (!isValidPassword(senha)) {
    return res.status(400).json({ error: 'Senha fraca. Use no mínimo 8 caracteres, uma letra maiúscula, um número e um símbolo especial.' });
  }

  try {
    const existing = await findUserByEmail(normEmail);
    if (existing) return res.status(409).json({ error: 'Email já cadastrado' });

    const senhaHash = await bcrypt.hash(senha, 10);
    const code = generateCode();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const ok = await createUserRecord({
      email: normEmail,
      nome,
      senhahash: senhaHash,
      creditos: '0',
      verificado: 'false',
      codigoverificacao: code,
      codigoexpiraem: expires,
      documentos: '[]',
      notificacoes: '[]',
      transacoes: '[]',
      historicoimpressao: '[]',
      pagamentospendentes: '{}',
      criadoem: now,
      ultimologinem: '',
    });

    if (!ok) return res.status(500).json({ error: 'Falha ao criar conta' });

    const emailSent = await sendVerificationEmail(normEmail, code);
    res.status(201).json({
      message: emailSent ? 'Conta criada. Verifique seu email.' : 'Conta criada, mas não foi possível enviar o email. Use "Reenviar código".',
      emailSent,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Falha no registro' });
  }
});

// ── Verify email ─────────────────────────────────────────────────────
app.post('/api/verify-email', async (req, res) => {
  const { email, codigo } = req.body;
  if (!email || !codigo) return res.status(400).json({ error: 'Email e código são obrigatórios' });
  const normEmail = String(email).trim().toLowerCase();

  try {
    const user = await findUserByEmail(normEmail);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (String(user.verificado).toLowerCase() === 'true') return res.json({ message: 'Email já verificado' });

    const storedCode = String(user.codigoverificacao || '');
    const expires = new Date(user.codigoexpiraem || 0);
    if (storedCode !== String(codigo)) return res.status(400).json({ error: 'Código inválido' });
    if (new Date() > expires) return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });

    await updateUserRecord(user.__id, {
      verificado: 'true',
      codigoverificacao: '',
      codigoexpiraem: '',
    });

    res.json({ message: 'Email verificado com sucesso' });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Falha na verificação' });
  }
});

// ── Resend code ──────────────────────────────────────────────────────
app.post('/api/resend-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });
  const normEmail = String(email).trim().toLowerCase();

  try {
    const user = await findUserByEmail(normEmail);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (String(user.verificado).toLowerCase() === 'true') return res.json({ message: 'Email já verificado' });

    const code = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await updateUserRecord(user.__id, { codigoverificacao: code, codigoexpiraem: expires });
    if (!(await sendVerificationEmail(normEmail, code))) {
      return res.status(502).json({ error: 'Não foi possível enviar o email. Tente novamente em instantes.' });
    }
    res.json({ message: 'Código reenviado' });
  } catch (err) {
    console.error('Resend code error:', err);
    res.status(500).json({ error: 'Falha ao reenviar código' });
  }
});

// ── Login ────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, senha, remember, client } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  const normEmail = String(email).trim().toLowerCase();

  try {
    const user = await authenticateUser(normEmail, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (String(user.verificado).toLowerCase() !== 'true') {
      return res.status(403).json({ error: 'Email não verificado. Verifique sua caixa de entrada.' });
    }
    await updateUserRecord(user.__id, { ultimologinem: new Date().toISOString() });
    const prefs = parsePrinterPreferences(user.printerpreferences);
    const ttl = client === 'kiosk' ? SESSION_TTL_MS.kiosk : remember ? SESSION_TTL_MS.webRemember : SESSION_TTL_MS.web;
    res.json({
      message: 'Login efetuado com sucesso',
      token: createSessionToken(user, ttl),
      email: normalizeEmail(user.email),
      displayName: user.nome || normEmail,
      printColor: prefs.color,
      printDuplex: prefs.duplex,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Falha no login' });
  }
});

// ── Users search (autocomplete do compartilhamento) ──────────────────
// Antes era GET /api/users sem login, que devolvia nome e email de todos os alunos.
app.post('/api/users/search', requireAuth, async (req, res) => {
  const q = String(req.body.q || '').trim().toLowerCase();
  if (q.length < 3) return res.json({ users: [] });
  try {
    const { user } = req;
    const records = await listAllRecords();
    const users = records
      .filter((r) => r.email && String(r.verificado).toLowerCase() === 'true' && normalizeEmail(r.email) !== normalizeEmail(user.email))
      .filter((r) => normalizeEmail(r.email).includes(q) || String(r.nome || '').toLowerCase().includes(q))
      .slice(0, 5)
      .map((r) => ({ email: String(r.email), nome: String(r.nome || r.email) }));
    res.json({ users });
  } catch (err) {
    console.error('Search users error:', err);
    res.status(500).json({ error: 'Falha ao buscar usuários' });
  }
});

// ── Documents ────────────────────────────────────────────────────────
app.post('/api/documents', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const docs = normalizeDocUrls(parseJsonField(user.documentos, []));
    res.json({
      documents: docs,
      usedBytes: getUsedStorageBytes(docs),
      limitBytes: STORAGE_LIMIT_BYTES,
    });
  } catch (err) {
    console.error('Get documents error:', err);
    res.status(500).json({ error: 'Falha ao obter documentos' });
  }
});

// ── Presigned upload (arquivos grandes direto para o R2, sem passar pela Vercel) ──
app.post('/api/upload/presign', requireAuth, async (req, res) => {
  const { filename, contentType, size } = req.body;
  const fileSize = Number(size) || 0;
  if (!filename) return res.status(400).json({ error: 'Nome do arquivo ausente' });
  if (!isAllowedMime(contentType)) return res.status(400).json({ error: 'Tipo de arquivo inválido.' });
  if (fileSize > PER_FILE_LIMIT_BYTES) {
    return res.status(413).json({
      error: `Arquivo muito grande. O limite é ${PER_FILE_LIMIT_BYTES / (1024 * 1024)} MB por arquivo.`,
      code: 'FILE_TOO_LARGE',
      limitBytes: PER_FILE_LIMIT_BYTES,
    });
  }
  try {
    const { user } = req;
    const docs = parseJsonField(user.documentos, []);
    if (storageLimitReached(getUsedStorageBytes(docs), fileSize)) return storageErrorResponse(res);

    const key = buildR2Key(user.email, filename);
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 },
    );
    return res.json({
      message: 'URL de upload gerada',
      uploadUrl,
      url: publicUrlForKey(key),
      key,
      expiresIn: 600,
      limitBytes: PER_FILE_LIMIT_BYTES,
    });
  } catch (err) {
    console.error('Presign error:', err);
    return res.status(500).json({ error: 'Falha ao preparar upload' });
  }
});

// Serve fallback uploads (legacy local files)
app.get('/uploads/:file', (req, res) => {
  const file = path.basename(req.params.file || '');
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
  for (const dir of [path.join(__dirname, 'uploads'), path.join(process.cwd(), 'uploads')]) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return res.sendFile(candidate);
  }
  return res.status(404).json({ error: 'Arquivo não encontrado' });
});

// ── Add document ─────────────────────────────────────────────────────
app.post('/api/add-document', requireAuth, async (req, res) => {
  const { documentName, originalname, url } = req.body;
  if (!documentName || !url) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const { user } = req;

    // A URL tem que ser de um upload que este aluno acabou de pedir via presign
    const key = r2KeyFromUrl(url);
    if (!key || url !== publicUrlForKey(key) || !verifyUploadKey(user.email, key)) {
      return res.status(400).json({ error: 'Arquivo inválido. Envie o arquivo novamente.' });
    }

    const docs = parseJsonField(user.documentos, []);
    if (docs.some((d) => d.url === url)) return res.status(409).json({ error: 'Documento já adicionado' });

    // Tamanho e tipo reais vêm do R2, não do que o cliente informou
    let head;
    try {
      head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } catch {
      return res.status(400).json({ error: 'Arquivo não encontrado no armazenamento. Envie novamente.' });
    }
    const size = Number(head.ContentLength) || 0;
    if (size > PER_FILE_LIMIT_BYTES) {
      await deleteFromR2(url);
      return res.status(413).json({ error: `Arquivo muito grande. O limite é ${PER_FILE_LIMIT_BYTES / (1024 * 1024)} MB por arquivo.`, code: 'FILE_TOO_LARGE', limitBytes: PER_FILE_LIMIT_BYTES });
    }

    const newDoc = {
      id: Date.now().toString(),
      name: String(documentName).slice(0, 200),
      filename: url,
      originalname: String(originalname || '').slice(0, 200),
      mimetype: head.ContentType || 'application/octet-stream',
      size,
      url,
      uploadedAt: new Date().toISOString(),
    };

    // Enforce 50 MB per-user storage quota (own documents only)
    if (storageLimitReached(getUsedStorageBytes(docs), size)) {
      await deleteFromR2(url);
      return storageErrorResponse(res);
    }

    docs.push(newDoc);
    const ok = await updateUserRecord(user.__id, { documentos: JSON.stringify(docs) });
    if (!ok) throw new Error('Falha ao atualizar usuário');
    res.json({ message: 'Documento adicionado', document: newDoc });
  } catch (err) {
    console.error('Add document error:', err);
    res.status(500).json({ error: 'Falha ao adicionar documento' });
  }
});

// ── Delete document ──────────────────────────────────────────────────
app.post('/api/delete-document', requireAuth, async (req, res) => {
  const { documentId } = req.body;
  if (!documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const { user } = req;

    let docs = parseJsonField(user.documentos, []);
    const idx = docs.findIndex((d) => d.id === documentId);
    if (idx === -1) return res.status(404).json({ error: 'Documento não encontrado' });
    const [removed] = docs.splice(idx, 1);
    await updateUserRecord(user.__id, { documentos: JSON.stringify(docs) });
    if (isOwnDoc(removed)) await deleteFromR2(removed && removed.url);
    res.json({ message: 'Documento excluído' });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Falha ao excluir documento' });
  }
});

// ── Credits ──────────────────────────────────────────────────────────
app.get('/api/credits', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const credits = Number(user.creditos || 0);
    const transactions = parseJsonField(user.transacoes, []);
    res.json({ credits, transactions });
  } catch (err) {
    console.error('Get credits error:', err);
    res.status(500).json({ error: 'Falha ao obter créditos' });
  }
});

// ── Print Preferences ────────────────────────────────────────────────
app.post('/api/user/print-preferences', requireAuth, async (req, res) => {
  const { printColor, printDuplex } = req.body;
  if (!['color', 'bw'].includes(printColor) || !['single', 'duplex'].includes(printDuplex)) {
    return res.status(400).json({ error: 'Valores inválidos para preferências' });
  }
  try {
    const { user } = req;

    const prefs = JSON.stringify({ color: printColor, duplex: printDuplex });
    const ok = await updateUserRecord(user.__id, { printerpreferences: prefs });
    if (!ok) throw new Error('Falha ao salvar preferências');
    res.json({ message: 'Preferências salvas', printColor, printDuplex });
  } catch (err) {
    console.error('Save print preferences error:', err);
    res.status(500).json({ error: 'Falha ao salvar preferências' });
  }
});

app.get('/api/user/print-preferences', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const prefs = parsePrinterPreferences(user.printerpreferences);
    res.json({ printColor: prefs.color, printDuplex: prefs.duplex });
  } catch (err) {
    console.error('Get print preferences error:', err);
    res.status(500).json({ error: 'Falha ao obter preferências' });
  }
});

// ── Print ────────────────────────────────────────────────────────────
// O preço é sempre calculado aqui; o "cost" enviado pelo cliente é ignorado.
const resolvePrint = (user, { pages, color, duplex }) => {
  const prefs = parsePrinterPreferences(user.printerpreferences);
  const printColor = color === 'color' || color === 'bw' ? color : prefs.color;
  const printDuplex = duplex === 'duplex' || duplex === 'single' ? duplex : prefs.duplex;
  const n = Number(pages);
  if (!Number.isInteger(n) || n < 1 || n > 2000) return { error: 'Número de páginas inválido' };
  if (printDuplex === 'duplex' && n < 2) return { error: 'Frente e verso requer pelo menos 2 páginas' };
  return { printColor, printDuplex, pages: n, cost: getPrintCost(printColor, printDuplex, n) };
};

app.post('/api/print/quote', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const job = resolvePrint(user, req.body);
    if (job.error) return res.status(400).json({ error: job.error });
    const credits = Number(user.creditos || 0);
    res.json({ cost: job.cost, credits, enough: credits >= job.cost });
  } catch (err) {
    console.error('Print quote error:', err);
    res.status(500).json({ error: 'Falha ao calcular impressão' });
  }
});

app.post('/api/print', requireAuth, async (req, res) => {
  const { documentId, documentName, clientRef } = req.body;
  if (!documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const { user } = req;

    const job = resolvePrint(user, req.body);
    if (job.error) return res.status(400).json({ error: job.error });
    const { printColor, printDuplex, pages, cost: printCost } = job;

    const history = parseJsonField(user.historicoimpressao, []);
    // Reenvio do mesmo débito (ex.: kiosk repetindo após falha de rede) não cobra de novo
    const ref = clientRef ? String(clientRef).slice(0, 100) : '';
    const previous = ref && history.find((h) => h.clientRef === ref);
    if (previous) return res.json({ message: 'Impressão já registrada', printRecord: previous, credits: Number(user.creditos || 0) });

    const current = Number(user.creditos || 0);
    if (current < printCost) return res.status(402).json({ error: 'Créditos insuficientes' });

    const printRecord = {
      id: Date.now().toString(),
      documentId,
      documentName: documentName || 'Unknown',
      pages,
      color: printColor,
      duplex: printDuplex,
      cost: printCost,
      status: 'completed',
      printedAt: new Date().toISOString(),
      ...(ref ? { clientRef: ref } : {}),
    };

    history.push(printRecord);

    const transactions = parseJsonField(user.transacoes, []);
    const configLabel = printColor === 'color' ? 'colorida' : 'preto e branco';
    transactions.push({ amount: -printCost, description: `Impressão: ${documentName || 'Documento'} (${printDuplex === 'duplex' ? 'frente e verso, ' : ''}${configLabel})`, type: 'debit', createdAt: new Date().toISOString() });

    const newBalance = round2(current - printCost);
    const ok = await updateUserRecord(user.__id, {
      creditos: String(newBalance),
      historicoimpressao: JSON.stringify(history),
      transacoes: JSON.stringify(transactions),
    });
    if (!ok) throw new Error('Falha ao gravar débito');

    res.json({ message: 'Impressão concluída', printRecord, credits: newBalance });
  } catch (err) {
    console.error('Print error:', err);
    res.status(500).json({ error: 'Falha ao processar impressão' });
  }
});

// ── Print history ────────────────────────────────────────────────────
app.get('/api/print-history', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const history = parseJsonField(user.historicoimpressao, []);
    history.sort((a, b) => new Date(b.printedAt) - new Date(a.printedAt));
    res.json({ printHistory: history });
  } catch (err) {
    console.error('Print history error:', err);
    res.status(500).json({ error: 'Falha ao obter histórico' });
  }
});

// ── Share document ───────────────────────────────────────────────────
app.post('/api/share-document', requireAuth, async (req, res) => {
  const { targetEmail, documentId, documentName, message } = req.body;
  if (!targetEmail || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const sender = req.user;
    const email = sender.email;
    const senderName = sender.nome || email;

    // Find document in sender
    const senderDocs = parseJsonField(sender.documentos, []);
    const sourceDoc = senderDocs.find((d) => d.id === documentId);
    if (!sourceDoc) return res.status(404).json({ error: 'Documento não encontrado' });

    // Find target user
    const target = await findUserByEmail(targetEmail);
    if (!target) return res.status(404).json({ error: 'Usuário de destino não encontrado' });

    // Add document to target
    const targetDocs = parseJsonField(target.documentos, []);
    const newDocId = Date.now().toString();
    targetDocs.push({
      id: newDocId,
      name: documentName || sourceDoc.name,
      filename: sourceDoc.filename,
      originalname: sourceDoc.originalname,
      mimetype: sourceDoc.mimetype,
      size: sourceDoc.size,
      url: sourceDoc.url,
      uploadedAt: new Date().toISOString(),
      compartilhado_de_email: email,
      compartilhado_de_nome: senderName,
      mensagem_compartilhamento: message || '',
    });

    // Add notification
    const notifications = parseJsonField(target.notificacoes, []);
    notifications.push({
      id: Date.now().toString() + '-n',
      tipo: 'share_request',
      de_email: email,
      de_nome: senderName,
      documento_id: newDocId,
      documento_nome: documentName || sourceDoc.name,
      mensagem: message || '',
      status: 'pending',
      criado_em: new Date().toISOString(),
    });

    await updateUserRecord(target.__id, {
      documentos: JSON.stringify(targetDocs),
      notificacoes: JSON.stringify(notifications),
    });

    res.json({ message: 'Documento compartilhado com sucesso' });
  } catch (err) {
    console.error('Share document error:', err);
    res.status(500).json({ error: 'Falha ao compartilhar documento' });
  }
});

// ── Handle share ─────────────────────────────────────────────────────
app.post('/api/handle-share', requireAuth, async (req, res) => {
  const { notificationId, action } = req.body;
  if (!notificationId || !action) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Ação inválida' });
  try {
    const { user } = req;

    const notifications = parseJsonField(user.notificacoes, []);
    const notifIdx = notifications.findIndex((n) => n.id === notificationId);
    if (notifIdx === -1) return res.status(404).json({ error: 'Notificação não encontrada' });

    notifications[notifIdx].status = action;

    if (action === 'rejected') {
      // Remove shared document
      const docs = parseJsonField(user.documentos, []);
      const docId = notifications[notifIdx].documento_id;
      const filtered = docs.filter((d) => d.id !== docId);
      await updateUserRecord(user.__id, {
        notificacoes: JSON.stringify(notifications),
        documentos: JSON.stringify(filtered),
      });
    } else {
      await updateUserRecord(user.__id, {
        notificacoes: JSON.stringify(notifications),
      });
    }

    res.json({ message: action === 'accepted' ? 'Compartilhamento aceito' : 'Compartilhamento recusado' });
  } catch (err) {
    console.error('Handle share error:', err);
    res.status(500).json({ error: 'Falha ao processar compartilhamento' });
  }
});

// ── Notifications ────────────────────────────────────────────────────
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const { user } = req;
    const notifications = parseJsonField(user.notificacoes, []);
    notifications.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
    res.json({ notifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Falha ao obter notificações' });
  }
});

// ── InfinitePay ──────────────────────────────────────────────────────
const INFINITE_HANDLE = 'ryan-montiel';
const INFINITE_API = 'https://api.checkout.infinitepay.io';

const readPendingForUser = (user) => parseJsonField(user.pagamentospendentes, {});

const writePendingForUser = async (user, pending) => {
  const resp = await fetchWithTimeout(`${await recordsUrl()}/${user.__id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify({ pagamentospendentes: JSON.stringify(pending) }),
  });
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text().catch(() => '');
    console.error('[writePendingForUser] patch failed:', resp.status, text);
    return false;
  }
  return true;
};

const findPendingPaymentOwner = async (order_nsu) => {
  const records = await listAllRecords();
  for (const record of records) {
    const pending = parseJsonField(record.pagamentospendentes, {});
    if (pending && pending[order_nsu]) return record;
  }
  return null;
};

// Consulta a InfinitePay. Retorna os dados só se o pagamento estiver confirmado.
const checkInfinitePay = async (order_nsu, { slug, transaction_nsu } = {}) => {
  const checkPayload = { handle: INFINITE_HANDLE, order_nsu };
  if (slug) checkPayload.slug = slug;
  if (transaction_nsu) checkPayload.transaction_nsu = transaction_nsu;
  const resp = await fetchWithTimeout(`${INFINITE_API}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkPayload),
  });
  if (!resp.ok) {
    console.error('[checkInfinitePay] status', resp.status, 'order', order_nsu);
    return null;
  }
  const data = await safeJson(resp);
  return data?.paid ? data : null;
};

// Confirma um pagamento pendente na InfinitePay e credita o aluno uma única vez.
// Créditos e status do pedido são gravados no mesmo PATCH, a partir de um registro
// recém-lido, para que webhook e check-payment simultâneos não creditem em dobro.
const confirmPayment = async (ownerEmail, order_nsu, hints = {}) => {
  const user = await findUserByEmail(ownerEmail);
  if (!user) return { status: 'not_found' };
  const pending = readPendingForUser(user);
  const payment = pending[order_nsu];
  if (!payment) return { status: 'not_found' };
  if (payment.status === 'completed') return { status: 'already', amount: round2(payment.amount) };

  const checkData = await checkInfinitePay(order_nsu, hints);
  if (!checkData) return { status: 'unpaid' };

  const transactions = parseJsonField(user.transacoes, []);
  if (transactions.some((t) => t.order_nsu === order_nsu)) {
    return { status: 'already', amount: round2(payment.amount) };
  }

  const creditAmount = round2(Number(payment.amount));
  const transaction_nsu = checkData.transaction_nsu || hints.transaction_nsu || '';
  transactions.push({
    amount: creditAmount,
    description: `Créditos via InfinitePay (${transaction_nsu || order_nsu})`,
    type: 'credit',
    order_nsu,
    createdAt: new Date().toISOString(),
  });
  pending[order_nsu] = {
    ...payment,
    status: 'completed',
    paidAt: new Date().toISOString(),
    transaction_nsu,
    capture_method: checkData.capture_method || hints.capture_method || '',
  };
  const newBalance = round2(Number(user.creditos || 0) + creditAmount);

  const ok = await updateUserRecord(user.__id, {
    creditos: String(newBalance),
    transacoes: JSON.stringify(transactions),
    pagamentospendentes: JSON.stringify(pending),
  });
  if (!ok) throw new Error('Falha ao gravar créditos');
  console.log('[confirmPayment] credited', creditAmount, 'order', order_nsu);
  return { status: 'credited', amount: creditAmount };
};

app.post('/api/create-payment-link', requireAuth, async (req, res) => {
  const { redirect_url } = req.body;
  const amount = round2(Number(req.body.amount));
  if (!(amount >= 1) || amount > 500) return res.status(400).json({ error: 'Valor inválido (mínimo R$ 1, máximo R$ 500)' });
  try {
    const { user } = req;

    const order_nsu = `pf-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const priceInCents = Math.round(amount * 100);
    const defaultRedirect = redirect_url || `${req.protocol}://${req.get('host')}/credits`;

    const webhookUrl = process.env.WEBHOOK_URL || `${req.protocol}://${req.get('host')}/api/webhook-infinitepay`;
    const payload = {
      handle: INFINITE_HANDLE,
      items: [{ quantity: 1, price: priceInCents, description: `Créditos PrintFlow - R$ ${amount.toFixed(2)}` }],
      order_nsu,
      redirect_url: defaultRedirect,
      webhook_url: webhookUrl,
      payment_methods: ['pix'],
    };

    const resp = await fetchWithTimeout(`${INFINITE_API}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[create-payment-link] infinitepay error:', resp.status, text);
      return res.status(502).json({ error: `InfinitePay recusou (${resp.status}): ${text.slice(0, 200)}` });
    }

    const data = await safeJson(resp);
    if (!data?.url) return res.status(502).json({ error: 'Resposta inválida da InfinitePay' });

    const pending = readPendingForUser(user);
    pending[order_nsu] = { email: user.email, amount, status: 'pending', createdAt: new Date().toISOString() };
    const saved = await writePendingForUser(user, pending);
    if (!saved) return res.status(500).json({ error: 'Falha ao registrar pagamento pendente' });

    return res.json({ url: data.url, order_nsu });
  } catch (err) {
    console.error('[create-payment-link] error:', err);
    res.status(500).json({ error: 'Falha ao criar link de pagamento' });
  }
});

app.post('/api/check-payment', requireAuth, async (req, res) => {
  const { order_nsu, slug, transaction_nsu } = req.body;
  if (!order_nsu) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const { user } = req;

    const result = await confirmPayment(user.email, String(order_nsu), { slug, transaction_nsu });
    if (result.status === 'not_found') return res.status(404).json({ error: 'Pagamento não encontrado' });
    if (result.status === 'unpaid') return res.json({ received: true });
    return res.json({ paid: true, amount: result.amount });
  } catch (err) {
    console.error('[check-payment] error:', err);
    res.status(500).json({ error: 'Falha ao verificar pagamento' });
  }
});

app.post('/api/reprocess-payment', requireAuth, async (req, res) => {
  const { order_nsu } = req.body;
  if (!order_nsu) return res.status(400).json({ error: 'Campos obrigatórios' });
  try {
    const { user } = req;

    const result = await confirmPayment(user.email, String(order_nsu));
    if (result.status === 'not_found') return res.status(404).json({ error: 'Pagamento não encontrado' });
    if (result.status === 'unpaid') return res.json({ paid: false, message: 'Pagamento ainda não confirmado' });
    if (result.status === 'already') return res.json({ message: 'Já processado', paid: true, amount: result.amount });
    return res.json({ paid: true, amount: result.amount, message: 'Reprocessado com sucesso' });
  } catch (err) {
    console.error('[reprocess-payment] error:', err);
    res.status(500).json({ error: 'Falha ao reprocessar' });
  }
});

// O webhook não é autenticado: ele só serve de aviso. O crédito só acontece
// depois que confirmPayment confirma o pagamento direto na InfinitePay.
app.post('/api/webhook-infinitepay', async (req, res) => {
  try {
    const { order_nsu, transaction_nsu, slug, capture_method } = req.body || {};
    if (!order_nsu) return res.status(400).json({ error: 'Missing order_nsu' });

    const owner = await findPendingPaymentOwner(String(order_nsu));
    if (!owner) return res.status(404).json({ error: 'Order not found' });

    const result = await confirmPayment(owner.email, String(order_nsu), { transaction_nsu, slug, capture_method });
    if (result.status === 'unpaid') console.warn('[webhook-infinitepay] not confirmed by InfinitePay:', order_nsu);
    return res.json({ received: true });
  } catch (err) {
    console.error('[webhook-infinitepay] error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Password reset ───────────────────────────────────────────────────
// Link assinado (não depende de memória do servidor, que se perde entre instâncias
// da Vercel). Leva a "impressão" da senha atual: depois de usado, deixa de valer.
const RESET_TTL_MS = 15 * 60 * 1000;

const createResetCode = (user) => {
  const payload = Buffer.from(JSON.stringify({ e: normalizeEmail(user.email), x: Date.now() + RESET_TTL_MS, p: passwordStamp(user) })).toString('base64url');
  return `${payload}.${hmac(`reset|${payload}`).slice(0, 32)}`;
};

const verifyResetCode = async (code) => {
  const [payload, sig] = String(code || '').split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(`reset|${payload}`).slice(0, 32))) return { error: 'Link invalido' };
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return { error: 'Link invalido' }; }
  if (!(Number(data.x) > Date.now())) return { error: 'Link expirado' };
  const user = await findUserByEmail(data.e);
  if (!user || !safeEqual(String(data.p || ''), passwordStamp(user))) return { error: 'Link invalido ou ja utilizado' };
  return { user };
};

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatorio' });
  // Mesma resposta exista ou não a conta (não revela quem está cadastrado)
  const generic = { message: 'Se o email estiver cadastrado, enviaremos um link de recuperação.' };
  try {
    const user = await findUserByEmail(normalizeEmail(email));
    if (!user) return res.json(generic);
    const sent = await sendPasswordResetEmail(normalizeEmail(user.email), createResetCode(user));
    if (!sent) return res.status(502).json({ error: 'Não foi possível enviar o email. Tente novamente em instantes.' });
    res.json(generic);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/reset-password', async (req, res) => {
  const { code, senha } = req.body;
  if (!code || !senha) return res.status(400).json({ error: 'Campos obrigatorios' });
  if (!isValidPassword(senha)) return res.status(400).json({ error: 'Senha fraca' });
  try {
    const { user, error } = await verifyResetCode(code);
    if (error) return res.status(400).json({ error });
    const hash = await bcrypt.hash(senha, 10);
    const ok = await updateUserRecord(user.__id, { senhahash: hash });
    if (!ok) throw new Error('Falha ao salvar senha');
    res.json({ message: 'Senha redefinida' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro' }); }
});

// ── Serve built frontend ─────────────────────────────────────────────
const __dist = path.join(__dirname, 'dist');
if (fs.existsSync(__dist)) {
  app.use(express.static(__dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(__dist, 'index.html'));
  });
}

// ── Export + Listen ──────────────────────────────────────────────────
export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

// Rota de API inexistente: responde em vez de deixar a requisição pendurada
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
