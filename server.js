import express from 'express';
import cors from 'cors';

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

app.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);
});
