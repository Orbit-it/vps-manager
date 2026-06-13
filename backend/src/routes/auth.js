import { Router } from 'express';
import { verifyCredentials, signToken } from '../services/auth.js';
import { cookieOptions } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const token = signToken(username);
    res.cookie(config.auth.cookieName, token, cookieOptions());

    res.json({
      ok: true,
      user: { username },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(config.auth.cookieName, cookieOptions());
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  res.json({
    user: { username: req.user.username },
  });
});

export default router;
