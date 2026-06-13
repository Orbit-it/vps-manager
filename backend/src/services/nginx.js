import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { runCommand } from './shell.js';

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

function extractServerBlocks(content) {
  const blocks = [];
  const regex = /server\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/gs;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function parseBlock(block) {
  const serverNames = [...block.matchAll(/server_name\s+([^;]+);/g)]
    .flatMap((m) => m[1].trim().split(/\s+/))
    .filter((d) => d && d !== '_');

  const rootMatch = block.match(/root\s+([^;]+);/);
  const proxyMatch = block.match(/proxy_pass\s+([^;]+);/);
  const sslCertMatch = block.match(/ssl_certificate\s+([^;]+);/);

  return {
    domains: [...new Set(serverNames)],
    root: rootMatch ? rootMatch[1].trim() : null,
    proxyPass: proxyMatch ? proxyMatch[1].trim() : null,
    ssl: Boolean(sslCertMatch),
    sslCertPath: sslCertMatch ? sslCertMatch[1].trim() : null,
  };
}

export async function parseNginxFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const blocks = extractServerBlocks(content);

  const parsed = blocks.map(parseBlock).filter((b) => b.domains.length > 0);
  if (parsed.length === 0) return null;

  const domains = [...new Set(parsed.flatMap((b) => b.domains))];
  const sslBlock = parsed.find((b) => b.ssl) || parsed[0];

  return {
    id: path.basename(filePath, '.conf'),
    name: path.basename(filePath, '.conf'),
    configFile: filePath,
    domains,
    root: parsed.find((b) => b.root)?.root || null,
    proxyPass: parsed.find((b) => b.proxyPass)?.proxyPass || null,
    ssl: parsed.some((b) => b.ssl),
    sslCertPath: sslBlock.sslCertPath,
    rawConfig: content,
  };
}

export async function listAppsFromNginx() {
  if (config.demoMode) {
    return DEMO_APPS;
  }

  const files = await fs.readdir(config.nginxSitesEnabled);
  const apps = [];

  for (const file of files) {
    if (!file.endsWith('.conf')) continue;

    try {
      const filePath = path.join(config.nginxSitesEnabled, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const app = await parseNginxFile(filePath);
      if (app) apps.push(app);
    } catch {
      // ignore unreadable configs
    }
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAppById(id) {
  const apps = await listAppsFromNginx();
  return apps.find((app) => app.id === id) || null;
}

export async function testNginxConfig() {
  if (config.demoMode) {
    return { ok: true, stdout: 'nginx: configuration file test is successful (demo)' };
  }
  return runCommand('nginx', ['-t']);
}

export async function reloadNginx() {
  if (config.demoMode) {
    return { ok: true, stdout: 'nginx reloaded (demo)' };
  }
  return runCommand('systemctl', ['reload', 'nginx']);
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

  await fs.writeFile(availablePath, content, 'utf8');

  try {
    await fs.access(enabledPath);
  } catch {
    await fs.symlink(availablePath, enabledPath);
  }

  return { availablePath, enabledPath };
}
