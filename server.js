import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 4002;

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  return next(error);
});

// ── Multer (memory → Catbox) ─────────────────────────────────────────
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || allowedMimes.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo inválido.'));
  },
});

// ── Sheetlabs Admin API ──────────────────────────────────────────────
const ADMIN_API_BASE = 'https://sheetlabs.com';
const SHEET_ORG = 'PTFL';
const DATATABLE_ID = process.env.DATATABLE_ID || '38080';

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
      const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;text-align:center">
        <h2 style="color:#4F46E5;margin-bottom:4px">PrintFlow</h2>
        <p style="color:#555;font-size:14px">Seu código de verificação:</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:10px;margin:20px 0;color:#111">${code}</p>
        <p style="color:#999;font-size:12px">Expira em 10 minutos. Se você não solicitou, ignore este email.</p>
      </div>`;
      await transporter.sendMail({ from: FROM_EMAIL, to: [email], subject: 'PrintFlow - Código de verificação', html });
      console.log(`Email enviado para ${email} via ${SMTP_HOST}`);
      return true;
    } catch (err) {
      console.error('SMTP error:', err.message);
      console.error('Nodemailer config:', JSON.stringify({ host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, passSet: Boolean(SMTP_PASS) }));
      printCodeToConsole(email, code);
      return true;
    }
  }
  printCodeToConsole(email, code);
  return true;
};

// ── DB helpers ───────────────────────────────────────────────────────

const listAllRecords = async () => {
  const resp = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, {
    headers: { 'Authorization': getBasicAuthHeader() },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
};

const findUserByEmail = async (email) => {
  const records = await listAllRecords();
  const norm = String(email).trim().toLowerCase();
  return records.find((r) => String(r.email || '').trim().toLowerCase() === norm) || null;
};

const createUserRecord = async (fields) => {
  const resp = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify(fields),
  });
  return resp.ok;
};

const updateUserRecord = async (recordId, fields) => {
  const clean = { ...fields };
  delete clean.__id;
  const resp = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify(clean),
  });
  return resp.ok || resp.status === 204;
};

const parseJsonField = (value, fallback) => {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
};

// ── Auth helper ──────────────────────────────────────────────────────

const authenticateUser = async (email, senha) => {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const stored = String(user.senhahash || '');
  const senhaStr = String(senha);
  if (!stored) return null;
  if (stored === senhaStr) return user;
  const sha256 = crypto.createHash('sha256').update(senhaStr).digest('hex');
  if (stored === sha256) return user;
  if (stored.startsWith('$2')) {
    try { if (await bcrypt.compare(senhaStr, stored)) return user; } catch { /* no-op */ }
  }
  return null;
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── Validation rules ─────────────────────────────────────────────────
const INSTITUTIONAL_EMAIL_RE = /@(?:academico\.)?ifsul\.edu\.br$/i;
const PASSWORD_STRENGTH_RE = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

const isInstitutionalEmail = (email) => INSTITUTIONAL_EMAIL_RE.test(String(email || '').trim().toLowerCase());
const isValidPassword = (senha) => PASSWORD_STRENGTH_RE.test(String(senha || ''));

// ── Print pricing (BRL per page) ──────────────────────────────────────
const PRINT_PRICES = {
  bw: { single: 0.5, duplex: 1.0 },
  color: { single: 0.75, duplex: 1.5 },
};
const getUnitPrice = (color, duplex) => {
  const p = PRINT_PRICES[color] || PRINT_PRICES.bw;
  return p && p[duplex] != null ? p[duplex] : PRINT_PRICES.bw.single;
};
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

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

    await sendVerificationEmail(normEmail, code);
    res.status(201).json({ message: 'Conta criada. Verifique seu email.' });
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
    if (user.verificado === 'true') return res.json({ message: 'Email já verificado' });

    const storedCode = String(user.codigoverificacao || '');
    const expires = new Date(user.codigoexpiraem || 0);
    if (storedCode !== String(codigo)) return res.status(400).json({ error: 'Código inválido' });
    if (new Date() > expires) return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });

    await updateUserRecord(user.__id, {
      ...user,
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
    if (user.verificado === 'true') return res.json({ message: 'Email já verificado' });

    const code = generateCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await updateUserRecord(user.__id, { ...user, codigoverificacao: code, codigoexpiraem: expires });
    await sendVerificationEmail(normEmail, code);
    res.json({ message: 'Código reenviado' });
  } catch (err) {
    console.error('Resend code error:', err);
    res.status(500).json({ error: 'Falha ao reenviar código' });
  }
});

// ── Login ────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  const normEmail = String(email).trim().toLowerCase();

  try {
    const user = await authenticateUser(normEmail, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (user.verificado !== 'true') {
      return res.status(403).json({ error: 'Email não verificado. Verifique sua caixa de entrada.' });
    }
    await updateUserRecord(user.__id, { ...user, ultimologinem: new Date().toISOString() });
    res.json({ message: 'Login efetuado com sucesso', displayName: user.nome || normEmail });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Falha no login' });
  }
});

// ── Users list (autocomplete) ────────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  try {
    const records = await listAllRecords();
    const users = records
      .filter((r) => r.email)
      .map((r) => ({ email: String(r.email), nome: String(r.nome || r.email) }));
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Falha ao listar usuários' });
  }
});

// ── Documents ────────────────────────────────────────────────────────
app.post('/api/documents', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    const docs = parseJsonField(user.documentos, []);
    res.json({ documents: docs });
  } catch (err) {
    console.error('Get documents error:', err);
    res.status(500).json({ error: 'Falha ao obter documentos' });
  }
});

// ── Upload (external host chain) ──────────────────────────────────────
const UPLOAD_HOSTS = [
  {
    name: 'uguu',
    upload: async (formData, blob, fileName) => {
      formData.append('files[]', blob, fileName);
      const resp = await fetch('https://uguu.se/upload', { method: 'POST', body: formData, signal: AbortSignal.timeout(12000) });
      if (!resp.ok) return { url: null, detail: `status ${resp.status}` };
      const data = await safeJson(resp);
      const url = data?.files?.[0]?.url;
      return { url: typeof url === 'string' && url.startsWith('https://') ? url : null, detail: JSON.stringify(data).slice(0, 120) };
    },
  },
  {
    name: 'catbox',
    upload: async (formData, blob, fileName) => {
      formData.append('reqtype', 'fileupload');
      formData.append('fileToUpload', blob, fileName);
      const resp = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: formData, signal: AbortSignal.timeout(12000) });
      const text = (await resp.text()).trim();
      return { url: text.startsWith('https://') ? text : null, detail: text.slice(0, 120) };
    },
  },
];

async function uploadToHostChain(fileBuffer, fileName, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const errors = [];
    for (const host of UPLOAD_HOSTS) {
      try {
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
        const result = await host.upload(formData, blob, fileName);
        if (result.url) {
          console.log(`Upload OK via ${host.name} (attempt ${attempt}):`, result.url);
          return result.url;
        }
        errors.push(`${host.name}: ${result.detail}`);
        console.error(`Upload attempt ${attempt} via ${host.name} failed:`, result.detail);
      } catch (err) {
        errors.push(`${host.name}: ${err.message}`);
        console.error(`Upload attempt ${attempt} via ${host.name} error:`, err.message);
      }
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2000));
  }
  console.error('Upload failed. Details:', errors.join(' | '));
  return null;
}

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || 'File upload failed' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const fileUrl = await uploadToHostChain(req.file.buffer, req.file.originalname);
    if (!fileUrl) return res.status(500).json({ error: 'Falha ao enviar arquivo. Tente novamente.' });

    return res.status(200).json({
      message: 'File uploaded successfully',
      file: { filename: fileUrl, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, url: fileUrl },
    });
  });
});

// Serve fallback uploads (legacy local files)
app.get('/uploads/:file', (req, res) => {
  const file = path.basename(req.params.file || '');
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
  for (const dir of [os.tmpdir(), path.join(__dirname, 'uploads'), path.join(process.cwd(), 'uploads')]) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return res.sendFile(candidate);
  }
  return res.status(404).json({ error: 'Arquivo não encontrado' });
});

// ── Vercel Blob (client-side uploads, sem limite de 4.5MB) ────────────
const blobAllowedContentTypes = [...allowedMimes, 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

app.post('/api/blob/upload', async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let email = '', senha = '';
        try {
          const p = JSON.parse(clientPayload || '{}');
          email = p.email || '';
          senha = p.senha || '';
        } catch {}
        const user = await authenticateUser(email, senha);
        if (!user) throw new Error('Não autenticado');
        return {
          allowedContentTypes: blobAllowedContentTypes,
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024,
          tokenPayload: JSON.stringify({ email }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return res.json(jsonResponse);
  } catch (err) {
    console.error('Blob upload error:', err);
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/blob/delete', async (req, res) => {
  const { email, senha, url } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  if (!url) return res.status(400).json({ error: 'URL ausente' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (String(url).includes('blob.vercel-storage.com')) await del(String(url));
    res.json({ ok: true });
  } catch (err) {
    console.error('Blob delete error:', err);
    res.status(500).json({ error: 'Falha ao excluir arquivo' });
  }
});

// ── Add document ─────────────────────────────────────────────────────
app.post('/api/add-document', async (req, res) => {
  const { email, senha, documentName, filename, originalname, mimetype, size, url } = req.body;
  if (!email || !senha || !documentName || !filename) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const docs = parseJsonField(user.documentos, []);
    const newDoc = {
      id: Date.now().toString(),
      name: documentName,
      filename,
      originalname: originalname || '',
      mimetype: mimetype || '',
      size: size || 0,
      url: url || '',
      uploadedAt: new Date().toISOString(),
    };
    docs.push(newDoc);
    await updateUserRecord(user.__id, { ...user, documentos: JSON.stringify(docs) });
    res.json({ message: 'Documento adicionado', document: newDoc });
  } catch (err) {
    console.error('Add document error:', err);
    res.status(500).json({ error: 'Falha ao adicionar documento' });
  }
});

// ── Delete document ──────────────────────────────────────────────────
app.post('/api/delete-document', async (req, res) => {
  const { email, senha, documentId } = req.body;
  if (!email || !senha || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    let docs = parseJsonField(user.documentos, []);
    const idx = docs.findIndex((d) => d.id === documentId);
    if (idx === -1) return res.status(404).json({ error: 'Documento não encontrado' });
    docs.splice(idx, 1);
    await updateUserRecord(user.__id, { ...user, documentos: JSON.stringify(docs) });
    res.json({ message: 'Documento excluído' });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Falha ao excluir documento' });
  }
});

// ── Credits ──────────────────────────────────────────────────────────
app.get('/api/credits', async (req, res) => {
  const { email, senha } = req.query;
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    const credits = Number(user.creditos || 0);
    const transactions = parseJsonField(user.transacoes, []);
    res.json({ credits, transactions });
  } catch (err) {
    console.error('Get credits error:', err);
    res.status(500).json({ error: 'Falha ao obter créditos' });
  }
});

app.post('/api/credits/add', async (req, res) => {
  const { email, senha, amount, description } = req.body;
  if (!email || !senha || !amount) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const creditAmount = round2(Number(amount));
    if (!(creditAmount > 0)) return res.status(400).json({ error: 'Valor inválido' });

    const current = Number(user.creditos || 0);
    const newBalance = round2(current + creditAmount);

    const transactions = parseJsonField(user.transacoes, []);
    transactions.push({ amount: creditAmount, description: description || 'Adição de créditos', type: 'credit', createdAt: new Date().toISOString() });

    await updateUserRecord(user.__id, { ...user, creditos: String(newBalance), transacoes: JSON.stringify(transactions) });
    res.json({ credits: newBalance, transactions });
  } catch (err) {
    console.error('Add credits error:', err);
    res.status(500).json({ error: 'Falha ao adicionar créditos' });
  }
});

// ── Print ────────────────────────────────────────────────────────────
app.post('/api/print', async (req, res) => {
  const { email, senha, documentId, documentName, pages, cost, color, duplex } = req.body;
  if (!email || !senha || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const printColor = color === 'color' ? 'color' : 'bw';
    const printDuplex = duplex === 'duplex' ? 'duplex' : 'single';
    const printCost = round2(Number(cost) > 0 ? cost : getUnitPrice(printColor, printDuplex) * (Number(pages) || 1));
    if (!(printCost > 0)) return res.status(400).json({ error: 'Valor de impressão inválido' });

    const current = Number(user.creditos || 0);
    if (current < printCost) return res.status(402).json({ error: 'Créditos insuficientes' });

    const printRecord = {
      id: Date.now().toString(),
      documentId,
      documentName: documentName || 'Unknown',
      pages: pages || 1,
      color: printColor,
      duplex: printDuplex,
      cost: printCost,
      status: 'completed',
      printedAt: new Date().toISOString(),
    };

    const history = parseJsonField(user.historicoimpressao, []);
    history.push(printRecord);

    const transactions = parseJsonField(user.transacoes, []);
    const configLabel = printColor === 'color' ? 'colorida' : 'preto e branco';
    transactions.push({ amount: -printCost, description: `Impressão: ${documentName || 'Documento'} (${printDuplex === 'duplex' ? 'frente e verso, ' : ''}${configLabel})`, type: 'debit', createdAt: new Date().toISOString() });

    const newBalance = round2(current - printCost);
    await updateUserRecord(user.__id, {
      ...user,
      creditos: String(newBalance),
      historicoimpressao: JSON.stringify(history),
      transacoes: JSON.stringify(transactions),
    });

    res.json({ message: 'Impressão concluída', printRecord, credits: newBalance });
  } catch (err) {
    console.error('Print error:', err);
    res.status(500).json({ error: 'Falha ao processar impressão' });
  }
});

// ── Print history ────────────────────────────────────────────────────
app.get('/api/print-history', async (req, res) => {
  const { email, senha } = req.query;
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    const history = parseJsonField(user.historicoimpressao, []);
    history.sort((a, b) => new Date(b.printedAt) - new Date(a.printedAt));
    res.json({ printHistory: history });
  } catch (err) {
    console.error('Print history error:', err);
    res.status(500).json({ error: 'Falha ao obter histórico' });
  }
});

// ── Share document ───────────────────────────────────────────────────
app.post('/api/share-document', async (req, res) => {
  const { email, senha, targetEmail, documentId, documentName, message } = req.body;
  if (!email || !senha || !targetEmail || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const sender = await authenticateUser(email, senha);
    if (!sender) return res.status(401).json({ error: 'Credenciais inválidas' });
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
      ...target,
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
app.post('/api/handle-share', async (req, res) => {
  const { email, senha, notificationId, action } = req.body;
  if (!email || !senha || !notificationId || !action) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Ação inválida' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

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
        ...user,
        notificacoes: JSON.stringify(notifications),
        documentos: JSON.stringify(filtered),
      });
    } else {
      await updateUserRecord(user.__id, {
        ...user,
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
app.get('/api/notifications', async (req, res) => {
  const { email, senha } = req.query;
  if (!email || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
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

const addCreditsToUser = async (targetEmail, amount, description) => {
  const user = await findUserByEmail(targetEmail);
  if (!user) throw new Error(`Usuário ${targetEmail} não encontrado`);
  const creditAmount = round2(Number(amount));
  const current = Number(user.creditos || 0);
  const newBalance = round2(current + creditAmount);

  const transactions = parseJsonField(user.transacoes, []);
  transactions.push({ amount: creditAmount, description: description || 'Créditos via pagamento', type: 'credit', createdAt: new Date().toISOString() });

  const ok = await updateUserRecord(user.__id, { ...user, creditos: String(newBalance), transacoes: JSON.stringify(transactions) });
  if (!ok) throw new Error('Falha ao atualizar créditos');
};

const readPendingForUser = (user) => parseJsonField(user.pagamentospendentes, {});

const writePendingForUser = async (user, pending) => {
  return updateUserRecord(user.__id, { ...user, pagamentospendentes: JSON.stringify(pending) });
};

const findPendingPaymentOwner = async (order_nsu) => {
  const records = await listAllRecords();
  for (const record of records) {
    const pending = parseJsonField(record.pagamentospendentes, {});
    if (pending[order_nsu]) return record;
  }
  return null;
};

app.post('/api/create-payment-link', async (req, res) => {
  const { email, senha, amount, redirect_url } = req.body;
  if (!email || !senha || !amount || amount <= 0) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const order_nsu = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const priceInCents = Math.round(amount * 100);
    const defaultRedirect = redirect_url || `${req.protocol}://${req.get('host')}/credits`;

    const payload = {
      handle: INFINITE_HANDLE,
      items: [{ quantity: 1, price: priceInCents, description: `Créditos PrintFlow - R$ ${amount.toFixed(2)}` }],
      order_nsu,
      redirect_url: defaultRedirect,
      webhook_url: `${req.protocol}://${req.get('host')}/api/webhook-infinitepay`,
      payment_methods: ['pix'],
    };

    const resp = await fetchWithTimeout(`${INFINITE_API}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return res.status(502).json({ error: `InfinitePay recusou (${resp.status}): ${text.slice(0, 200)}` });
    }

    const data = await safeJson(resp);
    if (!data?.url) return res.status(502).json({ error: 'Resposta inválida da InfinitePay' });

    const pending = readPendingForUser(user);
    pending[order_nsu] = { email, amount, status: 'pending', createdAt: new Date().toISOString() };
    await writePendingForUser(user, pending);

    return res.json({ url: data.url, order_nsu });
  } catch (err) {
    console.error('Create payment link error:', err);
    res.status(500).json({ error: 'Falha ao criar link de pagamento' });
  }
});

app.post('/api/check-payment', async (req, res) => {
  const { email, senha, order_nsu, slug, transaction_nsu } = req.body;
  if (!email || !senha || !order_nsu) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const user = await authenticateUser(email, senha);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const pending = readPendingForUser(user);
    const payment = pending[order_nsu];
    if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado' });

    if (payment.status === 'completed') {
      return res.json({ paid: true, amount: round2(payment.amount) });
    }

    if (slug || transaction_nsu) {
      const checkPayload = { handle: INFINITE_HANDLE, order_nsu };
      if (slug) checkPayload.slug = slug;
      if (transaction_nsu) checkPayload.transaction_nsu = transaction_nsu;
      const checkResp = await fetchWithTimeout(`${INFINITE_API}/payment_check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      });
      if (checkResp.ok) {
        const checkData = await safeJson(checkResp);
        if (checkData?.paid) {
          try {
            await addCreditsToUser(email, payment.amount, `Créditos via InfinitePay (${transaction_nsu || order_nsu})`);
          } catch (e) {
            return res.status(500).json({ error: `Pagamento confirmado, mas falha ao adicionar créditos: ${e.message}` });
          }
          payment.status = 'completed';
          payment.paidAt = new Date().toISOString();
          payment.transaction_nsu = transaction_nsu || '';
          pending[order_nsu] = payment;
          await writePendingForUser(user, pending);
          return res.json({ paid: true, amount: round2(payment.amount) });
        }
      }
    }

    return res.json({ paid: false });
  } catch (err) {
    console.error('Check payment error:', err);
    res.status(500).json({ error: 'Falha ao verificar pagamento' });
  }
});

app.post('/api/webhook-infinitepay', async (req, res) => {
  try {
    const { order_nsu, transaction_nsu, capture_method } = req.body;
    if (!order_nsu) return res.status(400).json({ error: 'Missing order_nsu' });

    const owner = await findPendingPaymentOwner(order_nsu);
    if (!owner || !owner.__id) {
      console.warn('Webhook for unknown order:', order_nsu);
      return res.json({ received: true });
    }

    const pending = readPendingForUser(owner);
    const payment = pending[order_nsu];
    if (!payment || payment.status === 'completed') return res.json({ received: true });

    try {
      await addCreditsToUser(payment.email, payment.amount, `Créditos via InfinitePay (${transaction_nsu || order_nsu})`);
    } catch (e) {
      console.error('Webhook: failed to add credits:', e);
    }

    payment.status = 'completed';
    payment.paidAt = new Date().toISOString();
    payment.transaction_nsu = transaction_nsu || '';
    payment.capture_method = capture_method || '';
    pending[order_nsu] = payment;
    await writePendingForUser(owner, pending);

    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.json({ received: true });
  }
});

// ── Serve built frontend ─────────────────────────────────────────────
const __dist = path.join(__dirname, 'dist');
if (fs.existsSync(__dist)) {
  app.use(express.static(__dist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(path.join(__dist, 'index.html'));
    }
  });
}

// ── Export + Listen ──────────────────────────────────────────────────
export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}
