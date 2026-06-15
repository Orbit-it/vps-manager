import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  port: Number(process.env.PORT) || 3001,
  isProduction: process.env.NODE_ENV === 'production',
  demoMode: process.env.DEMO_MODE === 'true',
  useSudo: process.env.USE_SUDO !== 'false',
  deployUser: process.env.DEPLOY_USER || process.env.USER || '',
  webGroup: process.env.WEB_GROUP || 'www-data',
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
  manager: {
    domains: (process.env.MANAGER_DOMAINS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    nginxConfigs: (process.env.MANAGER_NGINX_CONFIGS || 'vps-manager.conf,vps-app-manager.conf')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
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
