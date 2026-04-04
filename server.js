import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 4002;

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Save files to uploads directory
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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
    return res.status(400).json({ error: 'Invalid JSON payload' });
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

// Fetch all records from Admin API and find the full record for the given matricula
const findUserSheetRecord = async (matricula) => {
  const idVariants = getIdVariants(matricula).map(v => {
    const n = Number(v);
    return isNaN(n) ? v : n;
  });
  const response = await fetch(`${ADMIN_API_BASE}/records/${SHEET_ORG}/${DATATABLE_ID}`, {
    headers: { 'Authorization': getBasicAuthHeader() }
  });
  if (!response.ok) return null;
  const records = await response.json();
  return records.find(r => idVariants.includes(r.id)) ?? null;
};

const updateUserDocuments = async (matricula, documents) => {
  const serializedDocuments = JSON.stringify(documents);
  const sheetRecord = await findUserSheetRecord(matricula);
  if (!sheetRecord) {
    return { ok: false, status: 502, error: 'Failed to locate user record for update' };
  }

  const updateResponse = await fetch(
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

  const text = await updateResponse.text();
  return { ok: false, status: updateResponse.status, error: text || 'Failed to update user documents' };
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
  const idVariants = getIdVariants(matricula);

  // Try direct id+password filters first for fast-path compatibility.
  const encryptedPassword = crypto.createHash('sha256').update(String(senha)).digest('hex');
  const passwordsToTry = encryptedPassword === senha ? [String(senha)] : [encryptedPassword, String(senha)];

  for (const idValue of idVariants) {
    for (const passwordValue of passwordsToTry) {
      const queryUrl = `https://sheetlabs.com/PTFL/get_info?id=${encodeURIComponent(idValue)}&password=${encodeURIComponent(passwordValue)}`;
      const response = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          'Authorization': getBasicAuthHeader()
        }
      });

      if (response.status !== 200) {
        continue;
      }

      const userData = await response.json();
      if (!userData || (Array.isArray(userData) && userData.length === 0)) {
        continue;
      }

      const userRecord = Array.isArray(userData) ? userData[0] : userData;
      return { userRecord, passwordValue };
    }
  }

  return null;
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
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // In a real backend, save to DB; here we mock an ID return
  return res.status(201).json({ id: Date.now(), ...item });
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { matricula, nomeCompleto, senha } = req.body;
  if (!matricula || !nomeCompleto || !senha) {
    return res.status(400).json({ error: 'Missing required fields' });
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

    const response = await fetch('https://sheetlabs.com/PTFL/create_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getBasicAuthHeader()
      },
      body: JSON.stringify(data)
    });

    if (response.status === 204) {
      res.status(201).json({ message: 'User registered successfully' });
    } else {
      const text = await response.text();
      console.error('Sheetlabs response:', response.status, text);
      return res.status(502).json({ error: 'External API error' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { matricula, senha } = req.body;
  if (!matricula || !senha) {
    return res.status(400).json({ error: 'Missing matricula or senha' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sheetRecord = await findUserSheetRecord(matricula);
    const displayName = sheetRecord?.user ? String(sheetRecord.user) : String(matricula);

    return res.status(200).json({ message: 'Login success', displayName });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Get documents for user endpoint
app.post('/api/documents', async (req, res) => {
  const { matricula, senha } = req.body;

  if (!matricula || !senha) {
    return res.status(400).json({ error: 'Missing matricula or senha' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userRecord = lookup.userRecord;

    let documents = {};
    try {
      documents = JSON.parse(userRecord.documents || '{}');
    } catch (parseError) {
      console.error('Error parsing documents:', parseError);
      documents = {};
    }

    return res.status(200).json({
      documents,
      documentsList: Object.values(documents)
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({ error: 'Failed to get documents' });
  }
});

// File upload endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    return res.status(200).json({
      message: 'File uploaded successfully',
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`
      }
    });
  });
});

// Add document to user endpoint
app.post('/api/add-document', async (req, res) => {
  const { matricula, senha, documentName, filename, originalname, mimetype, size, url } = req.body;

  if (!matricula || !senha || !documentName || !filename) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
      return res.status(502).json({ error: 'Failed to update user documents' });
    }

  } catch (error) {
    console.error('Add document error:', error);
    res.status(500).json({ error: 'Failed to add document' });
  }
});

app.post('/api/delete-document', async (req, res) => {
  const { matricula, senha, documentId } = req.body;

  if (!matricula || !senha || !documentId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const lookup = await fetchUserRecord(matricula, senha);
    if (!lookup) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
      return res.status(404).json({ error: 'Document not found' });
    }

    delete documents[documentId];

    const updateResult = await updateUserDocuments(matricula, documents);
    if (!updateResult.ok) {
      console.error('Sheetlabs delete update response:', updateResult.status, updateResult.error);
      return res.status(502).json({ error: 'Failed to update user documents' });
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
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

app.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);
});
