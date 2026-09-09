import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 4002;

// Ensure uploads directory exists. On serverless hosts (Vercel) the filesystem
// is read-only, so this is best-effort and only used for the local fallback.
const uploadsDir = 'uploads/';
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  console.log('uploads dir not writable (serverless env):', err.message);
}

// Memory storage: files are forwarded to Catbox (CDN), which is the source of
// truth for stored documents. Serverless instances do not persist disk files.
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB limit (Vercel request body limit)
  },
  fileFilter: (req, file, cb) => {
    // Accept most image formats plus common document formats
    const allowedDocumentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'application/rtf',
      'application/vnd.oasis.opendocument.text'
    ];

    if (file.mimetype.startsWith('image/') || allowedDocumentTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an image or supported document format.'));
    }
  }
});

app.use(cors());
app.use(express.json());

// Normalize JSON parsing errors so frontend always receives JSON.
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  return next(error);
});

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

const getBasicAuthHeader = () => {
  const basicAuth = Buffer.from(`${process.env.SHEET_USERNAME}:${process.env.SHEET_TOKEN}`).toString('base64');
  return 'Basic ' + basicAuth;
};

const DATATABLE_ID = 859;
const ADMIN_API_BASE = 'https://app.sheetlabs.com';
const SHEET_ORG = 'PTFL';
const NOTIFICATIONS_KEY = '__notifications__'; // stored inside the documents JSON field
const TRANSACTIONS_KEY = '__transactions__'; // stored inside the documents JSON field
const PRINT_HISTORY_KEY = '__printHistory__'; // stored inside the documents JSON field

// Fetch all records from Admin API and find the full record for the given matricula
const findUserSheetRecord = async (matricula) => {
  try {
    const idVariants = getIdVariants(matricula).flatMap(v => {
      const n = Number(v);
      return isNaN(n) ? [v] : [v, n];
    });
    const response = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, {
      headers: { 'Authorization': getBasicAuthHeader() }
    });
    if (!response.ok) return null;
    const records = await response.json();
    return records.find(r => idVariants.includes(r.id) || idVariants.includes(String(r.id))) ?? null;
  } catch (error) {
    console.error('findUserSheetRecord error:', error);
    return null;
  }
};

const updateUserDocuments = async (matricula, documents) => {
  const serializedDocuments = JSON.stringify(documents);
  const sheetRecord = await findUserSheetRecord(matricula);
  if (!sheetRecord) {
    return { ok: false, status: 502, error: 'Falha ao localizar registro do usuário para atualização' };
  }

  const updateResponse = await fetchWithTimeout(
    `${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getBasicAuthHeader()
      },
      body: JSON.stringify({ ...sheetRecord, documents: serializedDocuments })
    }
  );

  if (updateResponse.status === 204 || updateResponse.status === 200) {
    return { ok: true, status: updateResponse.status };
  }

  const text = await updateResponse.text().catch(() => '');
  return { ok: false, status: updateResponse.status, error: text || 'Falha ao atualizar documentos do usuário' };
};

const FETCH_TIMEOUT = 30000; // 30 seconds

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const safeJson = async (response) => {
  try { return await response.json(); } catch { return null; }
};

const getIdVariants = (matricula) => {
  const raw = String(matricula).trim();
  const normalized = raw.replace(/^0+/, '');
  const variants = new Set([raw]);
  if (normalized && normalized !== raw) {
    variants.add(normalized);
  }
  return [...variants];
};

const verifyPasswordAgainstRecord = async (senha, storedPassword) => {
  if (!storedPassword) {
    return false;
  }

  const senhaValue = String(senha);
  const sha256 = crypto.createHash('sha256').update(senhaValue).digest('hex');

  if (storedPassword === senhaValue || storedPassword === sha256) {
    return true;
  }

  // Support bcrypt hashes from legacy users if present.
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    try {
      return await bcrypt.compare(senhaValue, storedPassword);
    } catch (error) {
      return false;
    }
  }

  return false;
};

const fetchUserRecord = async (matricula, senha) => {
  try {
    const idVariants = getIdVariants(matricula);

    // Try direct id+password filters first for fast-path compatibility.
    const encryptedPassword = crypto.createHash('sha256').update(String(senha)).digest('hex');
    const passwordsToTry = encryptedPassword === senha ? [String(senha)] : [encryptedPassword, String(senha)];

    for (const idValue of idVariants) {
      for (const passwordValue of passwordsToTry) {
        const queryUrl = `https://sheetlabs.com/PTFL/get_info?id=${encodeURIComponent(idValue)}&password=${encodeURIComponent(passwordValue)}`;
        const response = await fetchWithTimeout(queryUrl, {
          method: 'GET',
          headers: {
            'Authorization': getBasicAuthHeader()
          }
        });

        if (response.status !== 200) {
          continue;
        }

        const userData = await safeJson(response);
        if (!userData || (Array.isArray(userData) && userData.length === 0)) {
          continue;
        }

        const userRecord = Array.isArray(userData) ? userData[0] : userData;
        return { userRecord, passwordValue };
      }
    }

    return null;
  } catch (error) {
    console.error('fetchUserRecord error:', error);
    return null;
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Example data endpoint
app.get('/api/items', (req, res) => {
  res.json([
    { id: 1, name: 'Flow Print #1', status: 'ready' },
    { id: 2, name: 'Flow Print #2', status: 'queued' },
  ]);
});

// Example create endpoint
app.post('/api/items', (req, res) => {
  const item = req.body;
  if (!item || !item.name) {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  // In a real backend, save to DB; here we mock an ID return
  return res.status(201).json({ id: Date.now(), ...item });
});

// List users (matricula + name) for autocomplete
app.get('/api/users', async (req, res) => {
  try {
    const response = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, {
      headers: { 'Authorization': getBasicAuthHeader() }
    });
    if (!response.ok) return res.status(502).json({ error: 'Erro ao buscar usuários' });
    const records = await response.json();
    if (!Array.isArray(records)) return res.status(502).json({ error: 'Resposta inválida' });
    const users = records.map(r => ({ matricula: String(r.id), nome: r.user || String(r.id) }));
    return res.status(200).json({ users });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Falha ao listar usuários' });
  }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { matricula, nomeCompleto, senha } = req.body;
  if (!matricula || !nomeCompleto || !senha) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    const encryptedPassword = crypto.createHash('sha256').update(senha).digest('hex');
    const data = [{
      id: matricula,
      user: nomeCompleto,
      password: encryptedPassword,
      documents: '{}',
      credits: 0
    }];

      const response = await fetchWithTimeout('https://sheetlabs.com/PTFL/create_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getBasicAuthHeader()
      },
      body: JSON.stringify(data)
    });

    if (response.status === 204) {
      res.status(201).json({ message: 'Usuário registrado com sucesso' });
    } else {
      const text = await response.text().catch(() => '');
      console.error('Sheetlabs response:', response.status, text);
      return res.status(502).json({ error: 'Erro na API externa' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha no registro' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { matricula, senha } = req.body;
  if (!matricula || !senha) {
    return res.status(400).json({ error: 'Matrícula ou senha ausentes' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const sheetRecord = await findUserSheetRecord(matricula);
    const displayName = sheetRecord?.user ? String(sheetRecord.user) : String(matricula);

    return res.status(200).json({ message: 'Login efetuado com sucesso', displayName });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Falha no login' });
  }
});

// Get documents for user endpoint
app.post('/api/documents', async (req, res) => {
  const { matricula, senha } = req.body;

  if (!matricula || !senha) {
    return res.status(400).json({ error: 'Matrícula ou senha ausentes' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const userRecord = lookup.userRecord;

    let documents = {};
    try {
      documents = JSON.parse(userRecord.documents || '{}');
    } catch (parseError) {
      console.error('Error parsing documents:', parseError);
      documents = {};
    }
    // Remove internal keys from document list
    const { [NOTIFICATIONS_KEY]: _n, [TRANSACTIONS_KEY]: _t, ...docsOnly } = documents;

    return res.status(200).json({
      documents: docsOnly,
      documentsList: Object.values(docsOnly)
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({ error: 'Falha ao obter documentos' });
  }
});

// Upload file buffer to Catbox.moe CDN
async function uploadToCatbox(fileBuffer, fileName) {
  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', blob, fileName);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const url = (await response.text()).trim();
    if (url.startsWith('https://')) return url;
    console.error('Catbox returned invalid URL:', url);
    return null;
  } catch (err) {
    console.error('Catbox upload error:', err.message);
    return null;
  }
}

// File upload endpoint
app.post('/api/upload', async (req, res) => {
  upload.single('file')(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // Upload to Catbox CDN from the in-memory buffer
    const catboxUrl = await uploadToCatbox(req.file.buffer, req.file.originalname);

    let storedFilename = req.file.filename;
    let fileUrl = catboxUrl;

    // Fallback only if Catbox fails (best-effort within this runtime instance)
    if (!catboxUrl) {
      storedFilename = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fileUrl = `/uploads/${storedFilename}`;
      try {
        fs.writeFileSync(path.join(os.tmpdir(), storedFilename), req.file.buffer);
      } catch (err) {
        console.warn('Could not persist fallback upload:', err.message);
      }
    }

    return res.status(200).json({
      message: 'File uploaded successfully',
      file: {
        filename: storedFilename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl
      }
    });
  });
});

// Serve fallback uploads (best-effort: same runtime instance or local dev)
app.get('/uploads/:file', (req, res) => {
  const file = path.basename(req.params.file || '');
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado' });
  const candidates = [
    path.join(os.tmpdir(), file),
    path.join(__dirname, 'uploads', file),
    path.join(process.cwd(), 'uploads', file),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return res.sendFile(candidate);
    }
  }
  return res.status(404).json({ error: 'Arquivo não encontrado' });
});

// Add document to user endpoint
app.post('/api/add-document', async (req, res) => {
  const { matricula, senha, documentName, filename, originalname, mimetype, size, url } = req.body;

  if (!matricula || !senha || !documentName || !filename) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const userRecord = lookup.userRecord;

    // Parse current documents
    let documents = {};
    try {
      documents = JSON.parse(userRecord.documents || '{}');
    } catch (parseError) {
      console.error('Error parsing documents:', parseError);
      documents = {};
    }

    // Add new document
    const documentId = Date.now().toString();
    documents[documentId] = {
      id: documentId,
      name: documentName,
      filename: filename,
      originalname: originalname,
      mimetype: mimetype,
      size: size,
      url: url,
      uploadedAt: new Date().toISOString()
    };

    const updateResult = await updateUserDocuments(matricula, documents);
    if (updateResult.ok) {
      res.status(200).json({
        message: 'Document added successfully',
        document: documents[documentId]
      });
    } else {
      console.error('Sheetlabs update response:', updateResult.status, updateResult.error);
      return res.status(502).json({ error: 'Falha ao atualizar documentos do usuário' });
    }

  } catch (error) {
    console.error('Add document error:', error);
    res.status(500).json({ error: 'Falha ao adicionar documento' });
  }
});

app.post('/api/delete-document', async (req, res) => {
  const { matricula, senha, documentId } = req.body;

  if (!matricula || !senha || !documentId) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    let documents = {};
    try {
      documents = JSON.parse(lookup.userRecord.documents || '{}');
    } catch (parseError) {
      console.error('Error parsing documents:', parseError);
      documents = {};
    }

    const removedDocument = documents[documentId];
    if (!removedDocument) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    delete documents[documentId];

    const updateResult = await updateUserDocuments(matricula, documents);
    if (!updateResult.ok) {
      console.error('Sheetlabs delete update response:', updateResult.status, updateResult.error);
      return res.status(502).json({ error: 'Falha ao atualizar documentos do usuário' });
    }

    const possiblePaths = [
      path.join(__dirname, 'uploads', path.basename(removedDocument.filename || '')),
      path.join(process.cwd(), 'uploads', path.basename(removedDocument.filename || ''))
    ];
    for (const filePath of possiblePaths) {
      if (filePath.endsWith(path.sep) || !path.basename(filePath)) {
        continue;
      }
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          break;
        } catch (unlinkError) {
          console.warn('Could not delete local file:', filePath);
        }
      }
    }

    return res.status(200).json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    return res.status(500).json({ error: 'Falha ao excluir documento' });
  }
});

// ─── New routes: Credits ────────────────────────────────────────────────

app.get('/api/credits', async (req, res) => {
  const { matricula, senha } = req.query;
  if (!matricula || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);
    let documents = {};
    try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
    const credits = Number(sheetRecord?.credits ?? 0);
    const transactions = documents[TRANSACTIONS_KEY] || [];
    return res.status(200).json({ credits, transactions });
  } catch (error) {
    console.error('Get credits error:', error);
    return res.status(500).json({ error: 'Falha ao obter créditos' });
  }
});

app.post('/api/credits/add', async (req, res) => {
  const { matricula, senha, amount, description } = req.body;
  if (!matricula || !senha || !amount) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);
    const currentCredits = Number(sheetRecord?.credits ?? 0);
    const newBalance = currentCredits + Number(amount);
    let documents = {};
    try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
    const transactions = documents[TRANSACTIONS_KEY] || [];
    transactions.push({
      amount: Number(amount),
      description: description || 'Adição de créditos',
      type: 'credit',
      createdAt: new Date().toISOString()
    });
    documents[TRANSACTIONS_KEY] = transactions;
    const updateResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
      body: JSON.stringify({ ...sheetRecord, credits: newBalance, documents: JSON.stringify(documents) })
    });
    if (updateResponse.status === 204 || updateResponse.status === 200) {
      return res.status(200).json({ credits: newBalance, transactions });
    }
    const text = await updateResponse.text().catch(() => '');
    return res.status(502).json({ error: `Falha ao atualizar créditos (${updateResponse.status}): ${text.slice(0, 200)}` });
  } catch (error) {
    console.error('Add credits error:', error);
    return res.status(500).json({ error: 'Falha ao adicionar créditos' });
  }
});

// ─── New routes: Print & History ───────────────────────────────────────

app.post('/api/print', async (req, res) => {
  const { matricula, senha, documentId, documentName, pages, cost } = req.body;
  if (!matricula || !senha || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);
    const currentCredits = Number(sheetRecord?.credits ?? 0);
    const printCost = Math.round((cost || 0) / 0.50);
    if (currentCredits < printCost) return res.status(402).json({ error: 'Créditos insuficientes' });
    const printRecord = {
      id: Date.now().toString(),
      documentId,
      documentName: documentName || 'Unknown',
      pages: pages || 1,
      cost: printCost,
      status: 'completed',
      printedAt: new Date().toISOString()
    };
    const newBalance = currentCredits - printCost;
    let documents = {};
    try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
    const printHistory = documents[PRINT_HISTORY_KEY] || [];
    printHistory.push(printRecord);
    documents[PRINT_HISTORY_KEY] = printHistory;
    const transactions = documents[TRANSACTIONS_KEY] || [];
    transactions.push({
      amount: -printCost,
      description: `Impressão: ${documentName || 'Documento'}`,
      type: 'debit',
      createdAt: new Date().toISOString()
    });
    documents[TRANSACTIONS_KEY] = transactions;
    const updateResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
      body: JSON.stringify({ ...sheetRecord, credits: newBalance, documents: JSON.stringify(documents) })
    });
    if (updateResponse.status === 204 || updateResponse.status === 200) {
      return res.status(200).json({ message: 'Impressão concluída', printRecord, credits: newBalance });
    }
    return res.status(502).json({ error: 'Falha ao processar impressão' });
  } catch (error) {
    console.error('Print error:', error);
    return res.status(500).json({ error: 'Falha ao processar impressão' });
  }
});

app.get('/api/print-history', async (req, res) => {
  const { matricula, senha } = req.query;
  if (!matricula || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);
    let documents = {};
    try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
    const printHistory = documents[PRINT_HISTORY_KEY] || [];
    return res.status(200).json({ printHistory: printHistory.sort((a, b) => new Date(b.printedAt) - new Date(a.printedAt)) });
  } catch (error) {
    console.error('Print history error:', error);
    return res.status(500).json({ error: 'Falha ao obter histórico de impressão' });
  }
});

// ─── New routes: Share Document ────────────────────────────────────────

app.post('/api/share-document', async (req, res) => {
  const { matricula, senha, targetMatricula, documentId, documentName, message } = req.body;
  if (!matricula || !senha || !targetMatricula || !documentId) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    // Step 1: authenticate sender
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });

    // Step 2: get sender's full record
    const sheetRecord = await findUserSheetRecord(matricula);
    if (!sheetRecord) return res.status(500).json({ error: 'Erro interno: não foi possível localizar seus dados na base' });
    const senderName = sheetRecord.user || matricula;

    // Step 3: find the document in sender's account
    let senderDocs = {};
    try { senderDocs = JSON.parse(sheetRecord.documents || '{}'); } catch { senderDocs = {}; }
    const sourceDoc = senderDocs[documentId];
    if (!sourceDoc) return res.status(404).json({ error: 'Documento não encontrado na sua conta' });

    // Step 4: find target user
    const idVariants = getIdVariants(targetMatricula).flatMap(v => {
      const n = Number(v);
      return isNaN(n) ? [v] : [v, n];
    });
    const allResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, { headers: { 'Authorization': getBasicAuthHeader() } });
    if (!allResponse.ok) {
      const text = await allResponse.text().catch(() => 'unknown');
      return res.status(502).json({ error: `Falha ao buscar usuários na API (${allResponse.status}: ${text.slice(0, 200)})` });
    }
    const allRecords = await safeJson(allResponse);
    if (!Array.isArray(allRecords)) return res.status(502).json({ error: 'Resposta inválida da API ao buscar usuários' });
    const targetRecord = allRecords.find(r => idVariants.includes(r.id) || idVariants.includes(String(r.id)));
    if (!targetRecord) return res.status(404).json({ error: 'Usuário de destino não encontrado' });
    if (!targetRecord.__id) return res.status(502).json({ error: 'Registro do destino não possui identificador interno (__id)' });

    // Step 5: copy document with sent: prefix
    let recipientDocs = {};
    try { recipientDocs = JSON.parse(targetRecord.documents || '{}'); } catch { recipientDocs = {}; }
    // Extract existing notifications from documents
    const existingNotifications = recipientDocs[NOTIFICATIONS_KEY] || [];
    delete recipientDocs[NOTIFICATIONS_KEY];
    const newDocId = Date.now().toString();
    recipientDocs[newDocId] = {
      ...sourceDoc,
      id: newDocId,
      name: `sent:${documentName || sourceDoc.name}`,
      uploadedAt: new Date().toISOString(),
      sentFromMatricula: matricula,
      sentFromName: senderName,
      sentMessage: message || '',
      sentDocId: documentId,
    };

    // Step 6: create notification (stored inside documents JSON to avoid schema issues)
    existingNotifications.push({
      id: Date.now().toString() + '-n',
      type: 'share_request',
      fromMatricula: matricula,
      fromName: senderName,
      documentId: newDocId,
      documentName: documentName || sourceDoc.name,
      message: message || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    recipientDocs[NOTIFICATIONS_KEY] = existingNotifications;

    // Step 7: save to API (only includes `documents` field, notifications lives inside it)
    const updateResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${targetRecord.__id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
      body: JSON.stringify({ ...targetRecord, documents: JSON.stringify(recipientDocs) })
    });
    if (updateResponse.status === 204 || updateResponse.status === 200) {
      return res.status(200).json({ message: 'Documento compartilhado com sucesso' });
    }
    const errText = await updateResponse.text().catch(() => '');
    return res.status(502).json({ error: `API recusou atualização (status ${updateResponse.status}): ${errText.slice(0, 200)}` });
  } catch (error) {
    console.error('Share document error:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return res.status(500).json({ error: `Falha ao compartilhar documento: ${msg}` });
  }
});

app.post('/api/handle-share', async (req, res) => {
  const { matricula, senha, notificationId, action } = req.body;
  if (!matricula || !senha || !notificationId || !action) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: 'Ação inválida' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);

    // Parse documents (which also stores notifications internally)
    let recipientDocs = {};
    try { recipientDocs = JSON.parse(sheetRecord.documents || '{}'); } catch { recipientDocs = {}; }
    // Extract and update notifications from documents
    let notifications = recipientDocs[NOTIFICATIONS_KEY] || [];
    const notifIndex = notifications.findIndex(n => n.id === notificationId);
    if (notifIndex === -1) return res.status(404).json({ error: 'Notificação não encontrada' });
    notifications[notifIndex].status = action;

    const docId = notifications[notifIndex].documentId;
    const sharedDoc = recipientDocs[docId];

    // Remove internal key before saving documents
    delete recipientDocs[NOTIFICATIONS_KEY];

    if (action === 'accepted') {
      // Remove sent: prefix, clear sender fields
      if (sharedDoc && sharedDoc.name && sharedDoc.name.startsWith('sent:')) {
        recipientDocs[docId] = {
          ...sharedDoc,
          name: sharedDoc.name.replace(/^sent:/, ''),
          sentFromMatricula: undefined,
          sentFromName: undefined,
          sentMessage: undefined,
          sentDocId: undefined,
        };
      }
    } else if (action === 'rejected') {
      // Delete the document
      delete recipientDocs[docId];
    }

    // Re-attach notifications to documents
    recipientDocs[NOTIFICATIONS_KEY] = notifications;

    const updateResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
      body: JSON.stringify({ ...sheetRecord, documents: JSON.stringify(recipientDocs) })
    });
    if (updateResponse.status === 204 || updateResponse.status === 200) {
      return res.status(200).json({ message: action === 'accepted' ? 'Compartilhamento aceito' : 'Compartilhamento recusado' });
    }
    return res.status(502).json({ error: 'Falha ao atualizar compartilhamento' });
  } catch (error) {
    console.error('Handle share error:', error);
    return res.status(500).json({ error: 'Falha ao processar compartilhamento' });
  }
});

// ─── New routes: Notifications ─────────────────────────────────────────

app.get('/api/notifications', async (req, res) => {
  const { matricula, senha } = req.query;
  if (!matricula || !senha) return res.status(400).json({ error: 'Credenciais ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });
    const sheetRecord = await findUserSheetRecord(matricula);
    let documents = {};
    try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch { documents = {}; }
    const notifications = documents[NOTIFICATIONS_KEY] || [];
    return res.status(200).json({ notifications: notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ error: 'Falha ao obter notificações' });
  }
});

// ─── InfinitePay integration ──────────────────────────────────────────

const INFINITE_HANDLE = 'ryan-montiel';
const INFINITE_API = 'https://api.checkout.infinitepay.io';
// Pending payments live inside the user's `documents` JSON field (the data
// folder file is not persistent on serverless hosts like Vercel).
const PENDING_KEY = '__pendingPayments__';

const readPendingForUser = async (sheetRecord) => {
  let documents = {};
  try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
  return documents[PENDING_KEY] || {};
};

const writePendingForUser = async (sheetRecord, pending) => {
  let documents = {};
  try { documents = JSON.parse(sheetRecord?.documents || '{}'); } catch {}
  documents[PENDING_KEY] = pending;
  const updateResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify({ ...sheetRecord, documents: JSON.stringify(documents) })
  });
  return updateResponse.status === 204 || updateResponse.status === 200;
};

// Webhook only knows order_nsu, so scan all user records to find the owner.
const findPendingPaymentOwner = async (order_nsu) => {
  try {
    const allResponse = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, { headers: { 'Authorization': getBasicAuthHeader() } });
    if (!allResponse.ok) return null;
    const records = await safeJson(allResponse);
    if (!Array.isArray(records)) return null;
    for (const record of records) {
      let documents = {};
      try { documents = JSON.parse(record.documents || '{}'); } catch {}
      const pending = documents[PENDING_KEY] || {};
      if (pending[order_nsu]) return record;
    }
    return null;
  } catch (error) {
    console.error('findPendingPaymentOwner error:', error);
    return null;
  }
};

const addCreditsToUser = async (matricula, amount, description) => {
  const sheetRecord = await findUserSheetRecord(matricula);
  if (!sheetRecord) throw new Error(`Usuário ${matricula} não encontrado na base para adicionar créditos`);
  if (!sheetRecord.__id) throw new Error(`Registro do usuário ${matricula} está sem identificador interno (__id)`);
  const currentCredits = Number(sheetRecord.credits ?? 0);
  const prints = Math.round(Number(amount) / 0.50);
  const newBalance = currentCredits + prints;
  let documents = {};
  try { documents = JSON.parse(sheetRecord.documents || '{}'); } catch {}
  const transactions = documents[TRANSACTIONS_KEY] || [];
  transactions.push({
    amount: prints,
    description: description || 'Adição de créditos',
    type: 'credit',
    createdAt: new Date().toISOString()
  });
  documents[TRANSACTIONS_KEY] = transactions;
  const response = await fetchWithTimeout(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}/${sheetRecord.__id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': getBasicAuthHeader() },
    body: JSON.stringify({ ...sheetRecord, credits: newBalance, documents: JSON.stringify(documents) })
  });
  if (response.status !== 204 && response.status !== 200) {
    const text = await response.text().catch(() => '');
    throw new Error(`Falha ao atualizar créditos (status ${response.status}): ${text.slice(0, 200)}`);
  }
};

// Create a payment link via InfinitePay Checkout API
app.post('/api/create-payment-link', async (req, res) => {
  const { matricula, senha, amount, redirect_url } = req.body;
  if (!matricula || !senha || !amount || amount <= 0) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });

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

    const response = await fetchWithTimeout(`${INFINITE_API}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(502).json({ error: `InfinitePay recusou (${response.status}): ${text.slice(0, 200)}` });
    }

    const data = await safeJson(response);
    if (!data?.url) return res.status(502).json({ error: 'Resposta inválida da InfinitePay' });

    // Store pending payment inside the user's Sheetlabs record
    const sheetRecord = await findUserSheetRecord(matricula);
    if (!sheetRecord || !sheetRecord.__id) {
      return res.status(500).json({ error: 'Não foi possível localizar seus dados na base' });
    }
    const pending = await readPendingForUser(sheetRecord);
    pending[order_nsu] = { matricula, amount, status: 'pending', createdAt: new Date().toISOString() };
    const saved = await writePendingForUser(sheetRecord, pending);
    if (!saved) return res.status(502).json({ error: 'Falha ao registrar o pagamento' });

    return res.status(200).json({ url: data.url, order_nsu });
  } catch (error) {
    console.error('Create payment link error:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return res.status(500).json({ error: `Falha ao criar link de pagamento: ${msg}` });
  }
});

// Check payment status (called by frontend after redirect from InfinitePay)
// Calls InfinitePay's payment_check API synchronously since webhook may not
// reach localhost in dev mode.
app.post('/api/check-payment', async (req, res) => {
  const { matricula, senha, order_nsu, slug, transaction_nsu } = req.body;
  if (!matricula || !senha || !order_nsu) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) return res.status(401).json({ error: 'Credenciais inválidas' });

    const sheetRecord = await findUserSheetRecord(matricula);
    if (!sheetRecord || !sheetRecord.__id) return res.status(500).json({ error: 'Não foi possível localizar seus dados na base' });
    const pending = await readPendingForUser(sheetRecord);
    const payment = pending[order_nsu];
    if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado' });
    if (payment.matricula !== matricula) return res.status(403).json({ error: 'Pagamento não pertence a este usuário' });

    // Already confirmed by webhook
    if (payment.status === 'completed') {
      return res.status(200).json({ paid: true, amount: Math.round(payment.amount / 0.50) });
    }

    // Consult InfinitePay API synchronously
    if (slug || transaction_nsu) {
      const checkPayload = { handle: INFINITE_HANDLE, order_nsu };
      if (slug) checkPayload.slug = slug;
      if (transaction_nsu) checkPayload.transaction_nsu = transaction_nsu;
      const checkResponse = await fetchWithTimeout(`${INFINITE_API}/payment_check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      });
      if (checkResponse.ok) {
        const checkData = await safeJson(checkResponse);
        if (checkData?.paid) {
          // Payment confirmed — add credits immediately
          try {
            await addCreditsToUser(matricula, payment.amount, `Créditos via InfinitePay (${transaction_nsu || order_nsu})`);
          } catch (creditError) {
            const msg = creditError instanceof Error ? creditError.message : String(creditError);
            console.error('Failed to add credits after payment check:', msg);
            return res.status(500).json({ error: `Pagamento confirmado, mas falha ao adicionar créditos: ${msg}` });
          }
          payment.status = 'completed';
          payment.paidAt = new Date().toISOString();
          payment.transaction_nsu = transaction_nsu || '';
          pending[order_nsu] = payment;
          await writePendingForUser(sheetRecord, pending);
          return res.status(200).json({ paid: true, amount: Math.round(payment.amount / 0.50) });
        }
      }
    }

    return res.status(200).json({ paid: false });
  } catch (error) {
    console.error('Check payment error:', error);
    return res.status(500).json({ error: 'Falha ao verificar pagamento' });
  }
});

// Webhook received from InfinitePay when payment is confirmed
app.post('/api/webhook-infinitepay', async (req, res) => {
  try {
    const { order_nsu, transaction_nsu, paid_amount, capture_method } = req.body;
    if (!order_nsu) return res.status(400).json({ error: 'Missing order_nsu' });

    const ownerRecord = await findPendingPaymentOwner(order_nsu);
    if (!ownerRecord || !ownerRecord.__id) {
      console.warn('Webhook received for unknown order:', order_nsu);
      return res.status(200).json({ received: true }); // Ack anyway
    }
    const pending = await readPendingForUser(ownerRecord);
    const payment = pending[order_nsu];
    if (!payment) {
      console.warn('Webhook received for unknown order:', order_nsu);
      return res.status(200).json({ received: true }); // Ack anyway
    }
    if (payment.status === 'completed') return res.status(200).json({ received: true });

    try {
      await addCreditsToUser(payment.matricula, payment.amount, `Créditos via InfinitePay (${transaction_nsu || order_nsu})`);
      console.log(`Credits added via webhook: ${payment.matricula} +${payment.amount} (order: ${order_nsu})`);
    } catch (err) {
      console.error('Webhook: failed to add credits:', err);
    }

    // Mark as completed
    payment.status = 'completed';
    payment.paidAt = new Date().toISOString();
    payment.transaction_nsu = transaction_nsu || '';
    payment.capture_method = capture_method || '';
    pending[order_nsu] = payment;
    await writePendingForUser(ownerRecord, pending);

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ received: true }); // Always ack to prevent retries
  }
});

// ─── Production: serve built frontend ──────────────────────────────────
const __dist = path.join(__dirname, 'dist');
if (fs.existsSync(__dist)) {
  app.use(express.static(__dist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(path.join(__dist, 'index.html'));
    }
  });
}

// Export the Express app for serverless hosts (Vercel).
export default app;

// Listen only when run directly (Vercel invokes the exported app).
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Backend server listening on http://localhost:${port}`);
  });
}
