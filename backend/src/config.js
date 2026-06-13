import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3001,
  isProduction: process.env.NODE_ENV === 'production',
  demoMode: process.env.DEMO_MODE === 'true',
  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
    jwtSecret: process.env.JWT_SECRET || '',
    cookieName: 'vps_session',
    sessionMaxAge: process.env.SESSION_MAX_AGE || '24h',
  },
  nginxSitesEnabled: process.env.NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled',
  nginxSitesAvailable: process.env.NGINX_SITES_AVAILABLE || '/etc/nginx/sites-available',
  appsRoot: process.env.APPS_ROOT || '/var/www',
  vpsPublicIp: process.env.VPS_PUBLIC_IP || '',
  certbotEmail: process.env.CERTBOT_EMAIL || 'admin@example.com',
  ovh: {
    endpoint: process.env.OVH_ENDPOINT || 'ovh-eu',
    appKey: process.env.OVH_APP_KEY || '',
    appSecret: process.env.OVH_APP_SECRET || '',
    consumerKey: process.env.OVH_CONSUMER_KEY || '',
  },
};

export function isOvhConfigured() {
  const { appKey, appSecret, consumerKey } = config.ovh;
  return Boolean(appKey && appSecret && consumerKey);
}

export function validateAuthConfig() {
  const { adminPassword, adminPasswordHash, jwtSecret } = config.auth;

  if (!adminPassword && !adminPasswordHash) {
    throw new Error('ADMIN_PASSWORD ou ADMIN_PASSWORD_HASH doit être défini dans .env');
  }

  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET doit contenir au moins 32 caractères aléatoires');
  }
}
