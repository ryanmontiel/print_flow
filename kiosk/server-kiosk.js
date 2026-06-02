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
const MAIN_SERVER = process.env.MAIN_SERVER || 'https://print-flow-frjf.onrender.com';
const BIND_ADDRESS = process.env.KIOSK_BIND || '127.0.0.1';
const CUPS_PRINTER = process.env.CUPS_PRINTER || 'printflow';
const CUPS_IPP_URL = process.env.CUPS_IPP_URL || '';
const CACHE_DIR = path.join(__dirname, 'cache');

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
      body: JSON.stringify({ matricula: 'keepalive', senha: 'keepalive' }),
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
      body: JSON.stringify({ matricula: 'warmup', senha: 'warmup' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    res.json({ status: 'ok' });
  } catch {
    res.json({ status: 'warming' });
  }
});

// ── CUPS print endpoint ──────────────────────────────────────────────
app.post('/api/cups-print', async (req, res) => {
  const { fileUrl } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl é obrigatório' });

  try {
    const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${MAIN_SERVER}${fileUrl}`;
    const fileResponse = await fetch(absoluteUrl);
    if (!fileResponse.ok) throw new Error('Falha ao baixar o arquivo do servidor principal');

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const ext = path.extname(fileUrl) || '.pdf';
    const tempFile = path.join(os.tmpdir(), `pf-${Date.now()}${ext}`);
    fs.writeFileSync(tempFile, buffer);

    // Send to CUPS: B&W, single-sided
    const dest = CUPS_IPP_URL || CUPS_PRINTER;
    const cmd = `lp -d "${dest}" -o ColorModel=Gray -o sides=one-sided "${tempFile}"`;
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
  if (req.path === '/api/health') return;

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
