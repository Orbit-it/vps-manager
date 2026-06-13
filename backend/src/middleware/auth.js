import { verifyToken } from '../services/auth.js';
import { config } from '../config.js';

const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/health',
];

export function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.some((path) => req.path === path || req.path.startsWith(path))) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    const token = req.cookies?.[config.auth.cookieName] ||
      req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.clearCookie(config.auth.cookieName, cookieOptions());
      return res.status(401).json({ error: 'Session expirée ou invalide' });
    }

    req.user = payload;
  }

  next();
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: parseDuration(config.auth.sessionMaxAge),
    path: '/',
  };
}

function parseDuration(duration) {
  if (typeof duration === 'number') return duration;

  const match = String(duration).match(/^(\d+)([smhd])?$/);
  if (!match) return 24 * 60 * 60 * 1000;

  const value = Number(match[1]);
  const unit = match[2] || 's';

  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}
