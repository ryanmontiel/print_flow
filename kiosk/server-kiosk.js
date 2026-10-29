import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: process.env.KIOSK_ENV_FILE || path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.KIOSK_PORT || 4003;
const MAIN_SERVER = process.env.MAIN_SERVER || 'https://tcc-printflow.vercel.app';
const BIND_ADDRESS = process.env.KIOSK_BIND || '127.0.0.1';
const CUPS_PRINTER = process.env.CUPS_PRINTER || 'printflow';
const CUPS_IPP_URL = process.env.CUPS_IPP_URL || '';
const CACHE_DIR = process.env.KIOSK_CACHE_DIR || path.join(__dirname, 'cache');

// Jobs em andamento (em memória: se o kiosk reiniciar, jobs em curso não são debitados)
const printJobs = new Map();
const JOB_POLL_MS = 3000;
const JOB_MAX_AGE_MS = 60 * 60 * 1000;

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

app.use(express.json());

const fetchWithTimeout = async (url, options = {}, ms = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const bearerToken = (req) => /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1] || '';

const postMain = async (endpoint, body, token) => {
  const response = await fetchWithTimeout(`${MAIN_SERVER}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Servidor principal respondeu ${response.status}`);
    err.status = response.status;
    err.code = data.code;
    throw err;
  }
  return data;
};

// ── Warm-up & keep-alive ──────────────────────────────────────────────

async function pingMainServer() {
  try {
    await fetchWithTimeout(`${MAIN_SERVER}/api/health`, {}, 10000);
    console.log(`[keepalive] Main server pinged OK`);
  } catch (err) {
    console.log(`[keepalive] Main server ping (expected if sleeping): ${err.message}`);
  }
}

// Warm-up on startup
pingMainServer();
setInterval(pingMainServer, 5 * 60 * 1000);

// ── Health check for frontend warm-up ────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const r = await fetchWithTimeout(`${MAIN_SERVER}/api/health`);
    res.json({ status: r.ok ? 'ok' : 'warming' });
  } catch {
    res.json({ status: 'warming' });
  }
});

// ── CUPS print endpoints ──────────────────────────────────────────────

// "1-3,5" -> 4
const countRanges = (ranges) =>
  ranges.split(',').reduce((sum, part) => {
    const [a, b = a] = part.split('-').map(Number);
    return sum + Math.max(0, b - a + 1);
  }, 0);

const runFile = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (error, stdout, stderr) => resolve({ error, stdout: stdout || '', stderr: stderr || '' }));
  });

// Estado de um job no CUPS: 'queued' (ainda na fila), 'completed' (impresso) ou 'failed'
const cupsJobState = async (jobId) => {
  const active = await runFile('lpstat', ['-o', CUPS_PRINTER]);
  if (active.error) return 'unknown';
  if (active.stdout.split('\n').some((line) => line.split(/\s+/)[0] === jobId)) return 'queued';

  const done = await runFile('lpstat', ['-W', 'completed', '-l', '-o', CUPS_PRINTER]);
  if (done.error) return 'unknown';
  const block = [];
  let inBlock = false;
  for (const line of done.stdout.split('\n')) {
    if (!line.startsWith('\t') && !line.startsWith(' ')) inBlock = line.split(/\s+/)[0] === jobId;
    if (inBlock) block.push(line);
  }
  if (!block.length) return 'unknown';
  return block.some((l) => l.includes('job-completed-successfully')) ? 'completed' : 'failed';
};

// Debita os créditos no servidor principal. clientRef torna o débito idempotente.
const debitJob = async (job) => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const data = await postMain('/api/print', {
        documentId: job.documentId,
        documentName: job.documentName,
        pages: job.pages,
        color: job.color,
        duplex: job.duplex,
        clientRef: job.clientRef,
      }, job.token);
      return data;
    } catch (err) {
      console.error(`[print] débito falhou (tentativa ${attempt}) job ${job.jobId}:`, err.message);
      if (err.status && err.status < 500) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error('Servidor principal indisponível');
};

// Acompanha o job até o fim e debita sozinho, mesmo que a tela tenha saído.
const watchJob = (job) => {
  const timer = setInterval(async () => {
    if (job.checking) return;
    job.checking = true;
    try {
      const state = await cupsJobState(job.jobId);
      if (state === 'queued') {
        job.status = 'printing';
      } else if (state === 'completed') {
        clearInterval(timer);
        job.status = 'debiting';
        try {
          const data = await debitJob(job);
          job.credits = data.credits;
          job.status = 'completed';
          console.log(`[print] job ${job.jobId} impresso e debitado`);
        } catch (err) {
          job.status = 'error';
          job.error = `Impresso, mas falha ao debitar créditos: ${err.message}`;
        }
      } else if (state === 'failed') {
        clearInterval(timer);
        job.status = 'error';
        job.error = 'A impressão foi cancelada ou falhou na impressora. Nenhum crédito foi debitado.';
        console.log(`[print] job ${job.jobId} cancelado/falhou`);
      }
    } finally {
      job.checking = false;
    }
    if (Date.now() - job.createdAt > JOB_MAX_AGE_MS) clearInterval(timer);
  }, JOB_POLL_MS);
};

// Limpa jobs antigos da memória
setInterval(() => {
  for (const [id, job] of printJobs) {
    if (Date.now() - job.createdAt > JOB_MAX_AGE_MS * 2) printJobs.delete(id);
  }
}, 10 * 60 * 1000);

// Start print job: confere saldo, envia ao CUPS e passa a acompanhar o job
app.post('/api/print/start', async (req, res) => {
  const { fileUrl, color, duplex, documentId, documentName, pages, copies, pageRanges } = req.body;
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', code: 'SESSION_EXPIRED' });
  if (!fileUrl || !documentId) return res.status(400).json({ error: 'fileUrl e documentId são obrigatórios' });

  const numCopies = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 99);
  const hasRanges = typeof pageRanges === 'string' && /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(pageRanges);
  // Com intervalo de páginas, o total cobrado é calculado aqui, não confiado à tela
  const totalPages = hasRanges ? countRanges(pageRanges) * numCopies : Math.max(parseInt(pages, 10) || 1, 1);
  const printColor = color === 'color' ? 'color' : 'bw';
  const printDuplex = duplex === 'duplex' ? 'duplex' : 'single';

  let tempFile;
  try {
    const quote = await postMain('/api/print/quote', { pages: totalPages, color: printColor, duplex: printDuplex }, token);
    if (!quote.enough) return res.status(402).json({ error: 'Créditos insuficientes para esta impressão' });

    const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${MAIN_SERVER}${fileUrl}`;
    const fileResponse = await fetchWithTimeout(absoluteUrl, {}, 60000);
    if (!fileResponse.ok) throw new Error('Falha ao baixar o arquivo do servidor principal');

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    // A extensão vem da URL (controlada pelo aluno): só aceita formatos simples
    const urlExt = path.extname(new URL(absoluteUrl).pathname).toLowerCase();
    const ext = /^\.[a-z0-9]{1,5}$/.test(urlExt) ? urlExt : '.pdf';
    tempFile = path.join(os.tmpdir(), `pf-${Date.now()}${ext}`);
    fs.writeFileSync(tempFile, buffer);

    const dest = CUPS_IPP_URL || CUPS_PRINTER;
    const colorModel = printColor === 'color' ? 'RGB' : 'Gray';
    const sides = printDuplex === 'duplex' ? 'two-sided-long-edge' : 'one-sided';
    // execFile: argumentos vão direto pro lp, sem passar por shell
    const args = ['-d', dest, '-n', String(numCopies), '-o', `ColorModel=${colorModel}`, '-o', `sides=${sides}`];
    if (hasRanges) args.push('-o', `page-ranges=${pageRanges}`);
    args.push('--', tempFile);

    const { error, stdout, stderr } = await runFile('lp', args);
    if (error) {
      console.error('CUPS error:', stderr || error.message);
      return res.status(500).json({ error: `Falha ao enviar para impressora: ${stderr || error.message}` });
    }

    // stdout: "request id is printflow-23 (1 file(s))"
    const jobId = stdout.match(/request id is (\S+)/)?.[1] || stdout.trim();
    console.log('CUPS job sent:', jobId, `(${numCopies} cópia(s)${hasRanges ? `, páginas ${pageRanges}` : ''}, ${totalPages} pág. cobradas)`);

    const job = {
      jobId,
      clientRef: `kiosk-${os.hostname()}-${jobId}-${Date.now()}`,
      documentId,
      documentName,
      pages: totalPages,
      color: printColor,
      duplex: printDuplex,
      token,
      status: 'printing',
      createdAt: Date.now(),
    };
    printJobs.set(jobId, job);
    watchJob(job);

    res.json({ message: 'Documento enviado para impressão', jobId, cost: quote.cost });
  } catch (err) {
    console.error('CUPS print error:', err.message);
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? `Erro ao processar impressão: ${err.message}` : err.message, code: err.code });
  } finally {
    // O CUPS copia o arquivo ao aceitar o job, então já pode apagar
    if (tempFile) fs.unlink(tempFile, () => {});
  }
});

// Poll print job status
app.get('/api/print/status/:jobId', (req, res) => {
  const job = printJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  // 'debiting' ainda não terminou para a tela
  const status = job.status === 'debiting' ? 'printing' : job.status;
  res.json({ status, jobId: job.jobId, error: job.error });
});

// Resultado do job (o débito já foi feito pelo watchJob)
app.post('/api/print/complete', (req, res) => {
  const job = printJobs.get(req.body?.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  if (job.status === 'error') return res.status(500).json({ error: job.error });
  if (job.status !== 'completed') return res.status(400).json({ error: 'Job ainda não concluído' });
  res.json({ message: 'Impressão concluída e créditos debitados', credits: job.credits });
});

// ── Proxy /uploads with local cache ──────────────────────────────────
app.all('/uploads/*', async (req, res) => {
  const cacheKey = req.originalUrl.replace(/\//g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const cachePath = path.join(CACHE_DIR, cacheKey);

  // Serve from cache if available
  if (fs.existsSync(cachePath)) {
    const ext = path.extname(req.originalUrl).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };
    res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(cachePath);
  }

  try {
    const targetUrl = `${MAIN_SERVER}${req.originalUrl}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save to local cache (async, don't block response)
    fs.writeFile(cachePath, buffer, () => {});

    res.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Kiosk uploads proxy error:', err.message);
    res.status(504).json({ error: 'Falha ao baixar arquivo do servidor principal' });
  }
});

// Proxy all /api requests to the main server
app.all('/api/*', async (req, res) => {
  // Skip internal routes
  if (req.path === '/api/health' || req.path.startsWith('/api/print/')) return;

  try {
    const targetUrl = `${MAIN_SERVER}${req.originalUrl}`;
    const headers = { 'Content-Type': 'application/json' };
    if (req.get('authorization')) headers.Authorization = req.get('authorization');
    const fetchOptions = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    res.status(response.status).set('Content-Type', 'application/json').send(data);
  } catch (err) {
    console.error('Kiosk proxy error:', err.message);
    res.status(502).json({ error: 'Falha ao conectar ao servidor principal. Verifique se ele está rodando.' });
  }
});

// Serve built kiosk SPA
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Kiosk server running on http://${BIND_ADDRESS}:${PORT}`);
  console.log(`Proxying /api to ${MAIN_SERVER}`);
  console.log(`CUPS printer: ${CUPS_PRINTER}`);
  console.log(`File cache: ${CACHE_DIR}`);
});
