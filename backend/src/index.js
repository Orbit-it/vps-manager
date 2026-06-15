import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateAuthConfig } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import appsRouter from './routes/apps.js';

try {
  validateAuthConfig();
} catch (error) {
  console.error('Erreur de configuration:', error.message);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  origin: config.isProduction ? false : true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    demoMode: config.demoMode,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/apps', appsRouter);

const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      res.json({
        message: 'VPS App Manager API',
        hint: 'Lancez le frontend avec npm run dev:frontend',
      });
    }
  });
});

app.listen(config.port, () => {
  console.log(`VPS App Manager — http://localhost:${config.port}`);
  console.log(`Mode: ${config.demoMode ? 'DEMO' : 'PRODUCTION'}`);
  console.log(`Auth: utilisateur "${config.auth.adminUsername}"`);
}).on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Erreur: le port ${config.port} est déjà utilisé. Arrêtez l'ancien processus ou changez PORT dans .env`);
  } else {
    console.error('Erreur au démarrage:', error.message);
  }
  process.exit(1);
});
