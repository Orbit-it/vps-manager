import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { runCommand, runPrivilegedCommand, writeFilePrivileged, ensureSymlinkPrivileged } from './shell.js';

const DEMO_APPS = [
  {
    id: 'client1',
    name: 'client1',
    configFile: '/etc/nginx/sites-enabled/client1.conf',
    domains: ['client1.example.com'],
    root: '/var/www/client1/public',
    proxyPass: null,
    ssl: true,
    sslCertPath: '/etc/letsencrypt/live/client1.example.com/fullchain.pem',
  },
  {
    id: 'client2',
    name: 'client2',
    configFile: '/etc/nginx/sites-enabled/client2.conf',
    domains: ['client2.example.com', 'api.client2.example.com'],
    root: null,
    proxyPass: 'http://127.0.0.1:3002',
    ssl: false,
    sslCertPath: null,
  },
];

function getScanDirs() {
  const fromEnv = (process.env.NGINX_SCAN_DIRS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  return [
    config.nginxSitesEnabled,
    config.nginxSitesAvailable,
    '/etc/nginx/conf.d',
  ].filter((value, index, array) => array.indexOf(value) === index);
}

function isIgnoredDefaultSite(fileName) {
  const base = fileName.replace(/\.(conf|site)$/, '');
  return ['default', '000-default'].includes(base);
}

function shouldScanEntry(entry, dir) {
  if (entry.name.startsWith('.')) return false;
  if (isIgnoredDefaultSite(entry.name)) return false;
  if (!entry.isFile() && !entry.isSymbolicLink()) return false;

  const isSitesDir = dir.includes('sites-enabled') || dir.includes('sites-available');
  if (isSitesDir) return true;

  return isConfigFileName(entry.name);
}

function isConfigFileName(fileName) {
  return fileName.endsWith('.conf') || fileName.endsWith('.site');
}

function getAppIdFromPath(filePath) {
  return path.basename(filePath).replace(/\.(conf|site)$/, '');
}

function parseNginxContent(content, filePath) {
  const domains = [...content.matchAll(/server_name\s+([^;]+);/gi)]
    .flatMap((match) => match[1].trim().split(/\s+/))
    .map((domain) => domain.trim())
    .filter((domain) => domain && domain !== '_' && !domain.startsWith('$'));

  const uniqueDomains = [...new Set(domains)];
  const rootMatch = content.match(/root\s+([^;]+);/i);
  const proxyMatches = [...content.matchAll(/proxy_pass\s+([^;]+);/gi)]
    .map((match) => match[1].trim())
    .filter((value) => value && !value.startsWith('$') && !value.startsWith('unix:'));
  const sslCertMatch = content.match(/ssl_certificate\s+([^;]+);/i);
  const baseName = getAppIdFromPath(filePath);

  if (uniqueDomains.length === 0 && ['default', '000-default'].includes(baseName)) {
    return null;
  }

  return {
    id: baseName,
    name: baseName,
    configFile: filePath,
    domains: uniqueDomains.length > 0 ? uniqueDomains : [baseName],
    root: rootMatch ? rootMatch[1].trim() : null,
    proxyPass: proxyMatches[0] || null,
    ssl: Boolean(sslCertMatch),
    sslCertPath: sslCertMatch ? sslCertMatch[1].trim() : null,
    rawConfig: content,
  };
}

export async function parseNginxFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseNginxContent(content, filePath);
}

function normalizeProxyTarget(proxyPass) {
  if (!proxyPass) return null;
  return proxyPass
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function getManagerExclusionReason(app) {
  const configFileName = path.basename(app.configFile).toLowerCase();
  if (config.manager.nginxConfigs.includes(configFileName)) {
    return `fichier nginx du manager (${configFileName})`;
  }

  const managerDomains = config.manager.domains;
  if (managerDomains.length > 0) {
    const matchedDomain = app.domains
      .map((domain) => domain.toLowerCase())
      .find((domain) => managerDomains.includes(domain));
    if (matchedDomain) {
      return `domaine du manager (${matchedDomain})`;
    }
  }

  const proxyTarget = normalizeProxyTarget(app.proxyPass);
  if (proxyTarget) {
    const managerTargets = [
      `127.0.0.1:${config.port}`,
      `localhost:${config.port}`,
      `[::1]:${config.port}`,
    ];
    if (managerTargets.includes(proxyTarget)) {
      return `proxy vers le port du manager (${config.port})`;
    }
  }

  return null;
}

export function isManagerApp(app) {
  return Boolean(getManagerExclusionReason(app));
}

async function collectConfigFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (!shouldScanEntry(entry, dir)) continue;
      results.push(path.join(dir, entry.name));
    }

    return results;
  } catch (error) {
    return { error: error.message, code: error.code };
  }
}

async function resolveConfigPath(filePath) {
  try {
    const realPath = await fs.realpath(filePath);
    return realPath;
  } catch {
    return filePath;
  }
}

export async function scanNginxConfigs() {
  if (config.demoMode) {
    return {
      scanDirs: [],
      files: [],
      parsed: DEMO_APPS.map((app) => ({ app, excluded: false })),
      apps: DEMO_APPS,
      excluded: [],
      errors: [],
    };
  }

  const scanDirs = getScanDirs();
  const files = [];
  const errors = [];
  const parsed = [];
  const excluded = [];
  const apps = [];
  const seenPaths = new Set();
  const seenIds = new Set();

  for (const dir of scanDirs) {
    const dirFiles = await collectConfigFiles(dir);
    if (dirFiles.error) {
      errors.push({ dir, error: dirFiles.error, code: dirFiles.code });
      continue;
    }

    for (const filePath of dirFiles) {
      const resolvedPath = await resolveConfigPath(filePath);
      if (seenPaths.has(resolvedPath)) continue;
      seenPaths.add(resolvedPath);
      files.push({ dir, filePath, resolvedPath });
    }
  }

  for (const { dir, filePath, resolvedPath } of files) {
    try {
      const app = await parseNginxFile(resolvedPath);
      if (!app) {
        parsed.push({ filePath, resolvedPath, dir, status: 'ignored', reason: 'config vide ou default' });
        continue;
      }

      app.configFile = filePath;
      app.id = getAppIdFromPath(resolvedPath);
      app.name = app.id;

      if (seenIds.has(app.id)) {
        parsed.push({ filePath, resolvedPath, dir, status: 'duplicate', app });
        continue;
      }

      seenIds.add(app.id);
      const exclusionReason = getManagerExclusionReason(app);

      if (exclusionReason) {
        excluded.push({ app, reason: exclusionReason });
        parsed.push({ filePath, resolvedPath, dir, status: 'excluded', app, reason: exclusionReason });
        continue;
      }

      const { rawConfig, ...publicApp } = app;
      apps.push(publicApp);
      parsed.push({ filePath, resolvedPath, dir, status: 'included', app: publicApp });
    } catch (error) {
      errors.push({ filePath, resolvedPath, error: error.message, code: error.code });
      parsed.push({ filePath, resolvedPath, dir, status: 'error', error: error.message, code: error.code });
    }
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));

  return {
    scanDirs,
    processUser: process.getuid?.() ?? null,
    processGroup: process.getgid?.() ?? null,
    files,
    parsed,
    apps,
    excluded,
    errors,
  };
}

export async function listAppsFromNginx() {
  const scan = await scanNginxConfigs();
  return scan.apps;
}

export async function getAppById(id) {
  const apps = await listAppsFromNginx();
  return apps.find((app) => app.id === id) || null;
}

export async function testNginxConfig() {
  if (config.demoMode) {
    return { ok: true, stdout: 'nginx: configuration file test is successful (demo)' };
  }
  return runPrivilegedCommand('nginx', ['-t']);
}

export async function reloadNginx() {
  if (config.demoMode) {
    return { ok: true, stdout: 'nginx reloaded (demo)' };
  }
  return runPrivilegedCommand('systemctl', ['reload', 'nginx']);
}

export function buildNginxConfig({ domains, root, proxyPass }) {
  const serverName = domains.join(' ');
  const mainDomain = domains[0];

  if (proxyPass) {
    return `server {
    listen 80;
    server_name ${serverName};

    location / {
        proxy_pass ${proxyPass};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
  }

  return `server {
    listen 80;
    server_name ${serverName};
    root ${root || `/var/www/${mainDomain.split('.')[0]}/public`};

    index index.html index.php;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
}
`;
}

export async function writeNginxConfig(name, content) {
  if (config.demoMode) {
    return {
      availablePath: `${config.nginxSitesAvailable}/${name}.conf`,
      enabledPath: `${config.nginxSitesEnabled}/${name}.conf`,
      demo: true,
    };
  }

  const availablePath = path.join(config.nginxSitesAvailable, `${name}.conf`);
  const enabledPath = path.join(config.nginxSitesEnabled, `${name}.conf`);

  await writeFilePrivileged(availablePath, content);

  try {
    await fs.access(enabledPath);
  } catch {
    await ensureSymlinkPrivileged(availablePath, enabledPath);
  }

  return { availablePath, enabledPath };
}
