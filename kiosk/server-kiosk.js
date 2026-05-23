import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.KIOSK_PORT || 4003;
const MAIN_SERVER = process.env.MAIN_SERVER || 'https://print-flow-frjf.onrender.com';
const BIND_ADDRESS = process.env.KIOSK_BIND || '127.0.0.1';
const CUPS_PRINTER = process.env.CUPS_PRINTER || 'printflow';

app.use(express.json());

// CUPS print endpoint (MUST be before the /api/* proxy)
app.post('/api/cups-print', async (req, res) => {
  const { fileUrl } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl é obrigatório' });

  try {
    const fileResponse = await fetch(`${MAIN_SERVER}${fileUrl}`);
    if (!fileResponse.ok) throw new Error('Falha ao baixar o arquivo do servidor principal');

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const ext = path.extname(fileUrl) || '.pdf';
    const tempFile = path.join(os.tmpdir(), `pf-${Date.now()}${ext}`);
    fs.writeFileSync(tempFile, buffer);

    // Send to CUPS: B&W, single-sided
    const cmd = `lp -d "${CUPS_PRINTER}" -o ColorModel=Gray -o sides=one-sided "${tempFile}"`;
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

// Proxy /uploads (PDFs, images) to the main server
app.all('/uploads/*', async (req, res) => {
  try {
    const targetUrl = `${MAIN_SERVER}${req.originalUrl}`;
    const response = await fetch(targetUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (err) {
    console.error('Kiosk uploads proxy error:', err.message);
    res.status(502).json({ error: 'Falha ao baixar arquivo do servidor principal' });
  }
});

// Proxy all /api requests to the main server
app.all('/api/*', async (req, res) => {
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
});
