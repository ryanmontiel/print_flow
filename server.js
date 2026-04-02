import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

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

    const basicAuth = Buffer.from(`${process.env.SHEET_USERNAME}:${process.env.SHEET_TOKEN}`).toString('base64');
    const response = await fetch('https://sheetlabs.com/PTFL/create_user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + basicAuth
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
    const encryptedPassword = crypto.createHash('sha256').update(senha).digest('hex');
    const basicAuth = Buffer.from(`${process.env.SHEET_USERNAME}:${process.env.SHEET_TOKEN}`).toString('base64');
    const queryUrl = `https://sheetlabs.com/PTFL/get_info?id=${encodeURIComponent(matricula)}&password=${encodeURIComponent(encryptedPassword)}`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + basicAuth
      }
    });

    if (response.status === 200) {
      const userData = await response.json();
      if (!userData || (Array.isArray(userData) && userData.length === 0)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      return res.status(200).json({ message: 'Login success', user: userData });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);
});
