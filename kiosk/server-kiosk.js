import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.KIOSK_PORT || 4003;
const MAIN_SERVER = process.env.MAIN_SERVER || 'https://tcc-printflow.vercel.app';
const BIND_ADDRESS = process.env.KIOSK_BIND || '127.0.0.1';
const CUPS_PRINTER = process.env.CUPS_PRINTER || 'printflow';
const CUPS_IPP_URL = process.env.CUPS_IPP_URL || '';
const CACHE_DIR = process.env.KIOSK_CACHE_DIR || path.join(__dirname, 'cache');

// In-memory job tracking (in production, use Redis or similar)
const printJobs = new Map();

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

app.use(express.json());

// ── Warm-up & keep-alive ──────────────────────────────────────────────

async function pingMainServer() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    await fetch(`${MAIN_SERVER}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'keepalive', senha: 'keepalive' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`[keepalive] Main server pinged OK`);
  } catch (err) {
    console.log(`[keepalive] Main server ping (expected if sleeping): ${err.message}`);
  }
}

// Warm-up on startup
pingMainServer();
// Keep-alive every 5 minutes to prevent Render from sleeping
setInterval(pingMainServer, 5 * 60 * 1000);

// ── Health check for frontend warm-up ────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    await fetch(`${MAIN_SERVER}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'warmup', senha: 'warmup' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    res.json({ status: 'ok' });
  } catch {
    res.json({ status: 'warming' });
  }
});

// ── CUPS print endpoints ──────────────────────────────────────────────

// Start print job (no credit debit yet)
app.post('/api/print/start', async (req, res) => {
  const { fileUrl, color, duplex, documentId, documentName, pages, cost, email, senha } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl é obrigatório' });
  if (!documentId || !email || !senha) return res.status(400).json({ error: 'documentId, email e senha são obrigatórios' });

  try {
    const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${MAIN_SERVER}${fileUrl}`;
    const fileResponse = await fetch(absoluteUrl);
    if (!fileResponse.ok) throw new Error('Falha ao baixar o arquivo do servidor principal');

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const ext = path.extname(fileUrl) || '.pdf';
    const tempFile = path.join(os.tmpdir(), `pf-${Date.now()}${ext}`);
    fs.writeFileSync(tempFile, buffer);

    const dest = CUPS_IPP_URL || CUPS_PRINTER;
    const colorModel = color === 'color' ? 'Color' : 'Gray';
    const sides = duplex === 'duplex' ? 'two-sided-long-edge' : 'one-sided';
    const cmd = `lp -d "${dest}" -o ColorModel=${colorModel} -o sides=${sides} "${tempFile}"`;
    
    exec(cmd, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}

      if (error) {
        console.error('CUPS error:', stderr || error.message);
        return res.status(500).json({ error: `Falha ao enviar para impressora: ${stderr || error.message}` });
      }

      const jobId = stdout?.trim() || '';
      console.log('CUPS job sent:', jobId);

      // Store job metadata for polling
      printJobs.set(jobId, {
        jobId,
        documentId,
        documentName,
        pages,
        cost,
        color,
        duplex,
        email,
        senha,
        status: 'pending',
        createdAt: Date.now(),
      });

      res.json({ message: 'Documento enviado para impressão', jobId });
    });
  } catch (err) {
    console.error('CUPS print error:', err.message);
    res.status(500).json({ error: `Erro ao processar impressão CUPS: ${err.message}` });
  }
});

// Poll print job status
app.get('/api/print/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = printJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado' });
  }

  // Check CUPS status via lpstat
  exec(`lpstat -o ${CUPS_PRINTER} -l`, (error, stdout, stderr) => {
    if (error) {
      console.error('lpstat error:', stderr);
      // Don't fail - maybe CUPS is temporarily unavailable
      return res.json({ status: job.status, jobId });
    }

    // Parse lpstat output to find our job
    const lines = stdout.split('\n');
    let jobFound = false;
    let jobCompleted = false;

    for (const line of lines) {
      if (line.includes(job.jobId)) {
        jobFound = true;
        // Check if job is completed (no longer in queue or has "completed" status)
        if (!line.includes('pending') && !line.includes('processing') && !line.includes('held')) {
          jobCompleted = true;
        }
        break;
      }
    }

    if (!jobFound) {
      // Job not in queue anymore - assume completed
      jobCompleted = true;
    }

    if (jobCompleted && job.status !== 'completed') {
      job.status = 'completed';
      printJobs.set(job.jobId, job);
      console.log(`Job ${job.jobId} completed`);
    } else if (jobFound) {
      job.status = 'printing';
      printJobs.set(job.jobId, job);
    }

    res.json({ status: job.status, jobId: job.jobId });
  });
});

// Complete print job (debit credits on main server)
app.post('/api/print/complete', async (req, res) => {
  const { jobId } = req.body;
  const job = printJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job ainda não concluído' });
  }

  try {
    // Call main server to debit credits
    const response = await fetch(`${MAIN_SERVER}/api/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: job.email,
        senha: job.senha,
        documentId: job.documentId,
        documentName: job.documentName,
        pages: job.pages,
        cost: job.cost,
        color: job.color,
        duplex: job.duplex,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Main server error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    
    // Clean up job
    printJobs.delete(jobId);
    
    res.json({ message: 'Impressão concluída e créditos debitados', credits: data.credits });
  } catch (err) {
    console.error('Complete print error:', err.message);
    res.status(500).json({ error: `Falha ao debitar créditos: ${err.message}` });
  }
});

// Legacy CUPS print endpoint (kept for compatibility)
app.post('/api/cups-print', async (req, res) => {
  const { fileUrl, color, duplex } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl é obrigatório' });

  try {
    const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${MAIN_SERVER}${fileUrl}`;
    const fileResponse = await fetch(absoluteUrl);
    if (!fileResponse.ok) throw new Error('Falha ao baixar o arquivo do servidor principal');

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const ext = path.extname(fileUrl) || '.pdf';
    const tempFile = path.join(os.tmpdir(), `pf-${Date.now()}${ext}`);
    fs.writeFileSync(tempFile, buffer);

    const dest = CUPS_IPP_URL || CUPS_PRINTER;
    const colorModel = color === 'color' ? 'Color' : 'Gray';
    const sides = duplex === 'duplex' ? 'two-sided-long-edge' : 'one-sided';
    const cmd = `lp -d "${dest}" -o ColorModel=${colorModel} -o sides=${sides} "${tempFile}"`;
    exec(cmd, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}

      if (error) {
        console.error('CUPS error:', stderr || error.message);
        return res.status(500).json({ error: `Falha ao enviar para impressora: ${stderr || error.message}` });
      }

      const jobId = stdout?.trim() || '';
      console.log('CUPS job sent:', jobId);
      res.json({ message: 'Documento enviado para impressão', jobId });
    });
  } catch (err) {
    console.error('CUPS print error:', err.message);
    res.status(500).json({ error: `Erro ao processar impressão CUPS: ${err.message}` });
  }
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
    const fetchOptions = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };
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
