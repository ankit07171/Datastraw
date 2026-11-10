import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { api } from './routes.js';
import { seed } from './service.js';

const app = express();
app.use(cors({ origin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 }));
app.use('/api', api);

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
   
app.use((err, _req, res, _next) => {
  if (err.name === 'ValidationError' || err.name === 'CastError')
    return res.status(400).json({ error: err.message });
  if (err.code === 11000)
    return res.status(409).json({ error: 'Duplicate record', details: err.keyValue });
  const status = err.status ?? 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    ...(err.details && { details: err.details }),
  });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (copy .env.example to .env)');
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.syncIndexes();
  if (process.env.AUTO_SEED !== 'false' && (await seed())) console.log('Empty database: loaded sample data');
  const port = process.env.PORT ?? 4000;
  app.listen(port, () => console.log(`API listening on :${port}`));
}

start().catch(err => { console.error(err); process.exit(1); });
