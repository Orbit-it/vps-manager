import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFilePrivileged } from './shell.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.next', 'cache']);
const ENV_FILE_PATTERN = /^\.env(\..+)?$/;
const DIST_FILE_PATTERN = /\.(js|css|html|json|map)$/;

const URL_ENV_KEYS = [
  'APP_URL',
  'API_URL',
  'VITE_API_URL',
  'VITE_APP_URL',
  'VITE_BACKEND_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_BACKEND_URL',
  'REACT_APP_API_URL',
  'PUBLIC_URL',
  'FRONTEND_URL',
  'CLIENT_URL',
  'CORS_ORIGIN',
  'ALLOWED_ORIGINS',
  'CORS_ALLOWED_ORIGINS',
  'ORIGIN',
];

export function buildDomainMap(sourceDomains, newDomains) {
  const map = new Map();

  sourceDomains.forEach((sourceDomain, index) => {
    map.set(sourceDomain.toLowerCase(), newDomains[index] || newDomains[0]);
  });

  return map;
}

function replaceDomainsInText(content, domainMap) {
  let result = content;

  for (const [oldDomain, newDomain] of domainMap) {
    if (!oldDomain || !newDomain || oldDomain === newDomain) continue;

    const variants = [
      [`https://${oldDomain}`, `https://${newDomain}`],
      [`http://${oldDomain}`, `https://${newDomain}`],
      [`wss://${oldDomain}`, `wss://${newDomain}`],
      [`ws://${oldDomain}`, `wss://${newDomain}`],
      [oldDomain, newDomain],
    ];

    for (const [from, to] of variants) {
      result = result.split(from).join(to);
    }
  }

  return result;
}

async function updateEnvKeys(envPath, values) {
  try {
    let content = await fs.readFile(envPath, 'utf8');

    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    }

    await writeFilePrivileged(envPath, content);
    return true;
  } catch {
    return false;
  }
}

async function walkAndReplace(rootDir, domainMap) {
  const updatedFiles = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const isEnvFile = ENV_FILE_PATTERN.test(entry.name);
      const isDistFile = fullPath.includes(`${path.sep}dist${path.sep}`) && DIST_FILE_PATTERN.test(entry.name);

      if (!isEnvFile && !isDistFile) continue;

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const replaced = replaceDomainsInText(content, domainMap);
        if (replaced !== content) {
          await writeFilePrivileged(fullPath, replaced);
          updatedFiles.push(fullPath);
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  await walk(rootDir);
  return updatedFiles;
}

export async function applyDomainMigration(appPath, sourceDomains, newDomains) {
  const domainMap = buildDomainMap(sourceDomains, newDomains);
  const frontendDomain = newDomains[0];
  const apiDomain = newDomains[1] || newDomains[0];
  const frontendUrl = frontendDomain ? `https://${frontendDomain}` : null;
  const apiUrl = apiDomain ? `https://${apiDomain}` : null;

  const updatedFiles = await walkAndReplace(appPath, domainMap);

  const envTargets = [
    appPath,
    path.join(appPath, 'frontend'),
    path.join(appPath, 'backend'),
    path.join(appPath, 'api'),
    path.join(appPath, 'server'),
  ];

  const envValues = {
    APP_URL: frontendUrl,
    FRONTEND_URL: frontendUrl,
    CLIENT_URL: frontendUrl,
    API_URL: apiUrl,
    VITE_API_URL: apiUrl,
    VITE_APP_URL: frontendUrl,
    VITE_BACKEND_URL: apiUrl,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_APP_URL: frontendUrl,
    REACT_APP_API_URL: apiUrl,
    CORS_ORIGIN: frontendUrl,
    ALLOWED_ORIGINS: frontendUrl,
    CORS_ALLOWED_ORIGINS: frontendUrl,
  };

  const envFilesUpdated = [];
  for (const dir of envTargets) {
    for (const envName of ['.env', '.env.local', '.env.production']) {
      const envPath = path.join(dir, envName);
      const updated = await updateEnvKeys(envPath, envValues);
      if (updated) envFilesUpdated.push(envPath);
    }
  }

  return {
    domainMap: Object.fromEntries(domainMap),
    frontendUrl,
    apiUrl,
    updatedFiles: [...new Set([...updatedFiles, ...envFilesUpdated])],
    rebuildRecommended: updatedFiles.some((file) => file.includes('/dist/')),
  };
}
