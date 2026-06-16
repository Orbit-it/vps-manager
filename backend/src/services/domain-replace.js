import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFilePrivileged } from './shell.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.next', 'cache']);
const ENV_FILE_PATTERN = /^\.env(\..+)?$/;
const COMPILED_FILE_PATTERN = /\.(js|css|html|json|map|txt)$/;
const CORS_ENV_KEYS = ['ALLOWED_ORIGINS', 'CORS_ALLOWED_ORIGINS', 'CORS_ORIGIN'];

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

function appendOriginToEnvValue(currentValue, origin) {
  const values = currentValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.includes(origin)) return currentValue;
  return [...values, origin].join(',');
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

async function walkAndReplace(rootDir, domainMap, options = {}) {
  const { compiledOnly = false } = options;
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
      const isCompiledFile = COMPILED_FILE_PATTERN.test(entry.name);
      const isDistFile = fullPath.includes(`${path.sep}dist${path.sep}`) && COMPILED_FILE_PATTERN.test(entry.name);

      if (!isEnvFile && !isCompiledFile && !(compiledOnly && isDistFile)) continue;
      if (compiledOnly && !isCompiledFile) continue;

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

export async function addCorsOriginToBackend(sourceAppPath, frontendDomain) {
  const origin = frontendDomain.startsWith('http')
    ? frontendDomain
    : `https://${frontendDomain}`;

  const backendDirs = [
    sourceAppPath,
    path.join(sourceAppPath, 'backend'),
    path.join(sourceAppPath, 'api'),
    path.join(sourceAppPath, 'server'),
  ];

  const updatedFiles = [];

  for (const dir of backendDirs) {
    for (const envName of ['.env', '.env.local', '.env.production']) {
      const envPath = path.join(dir, envName);

      try {
        let content = await fs.readFile(envPath, 'utf8');
        let changed = false;

        for (const key of CORS_ENV_KEYS) {
          const regex = new RegExp(`^${key}=(.*)$`, 'm');
          const match = content.match(regex);

          if (match) {
            const nextValue = appendOriginToEnvValue(match[1], origin);
            if (nextValue !== match[1]) {
              content = content.replace(regex, `${key}=${nextValue}`);
              changed = true;
            }
          } else if (key === 'ALLOWED_ORIGINS') {
            content += `\n${key}=${origin}`;
            changed = true;
          }
        }

        if (changed) {
          await writeFilePrivileged(envPath, content);
          updatedFiles.push(envPath);
        }
      } catch {
        // ignore missing env files
      }
    }
  }

  return { origin, updatedFiles };
}

export async function patchSharedBackendApiUrlsInAssets(rootDir, frontendDomain, sharedApiDomain, options = {}) {
  const { aggressive = false } = options;
  const frontend = frontendDomain?.replace(/^https?:\/\//, '').toLowerCase();
  const api = sharedApiDomain?.replace(/^https?:\/\//, '').toLowerCase();

  if (!api) return [];

  const updatedFiles = [];
  const zoneSuffix = api.includes('.') ? api.split('.').slice(-2).join('.') : api;
  const apiUrlRegex = new RegExp(
    `(https?://)([a-z0-9-]+\\.${zoneSuffix.replace(/\./g, '\\.')})(/api[^"'\\s]*)`,
    'gi'
  );

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

      if (!entry.isFile() || !COMPILED_FILE_PATTERN.test(entry.name)) continue;

      try {
        const original = await fs.readFile(fullPath, 'utf8');
        let content = original;

        if (frontend && frontend !== api) {
          const variants = [
            [`https://${frontend}/api`, `https://${api}/api`],
            [`http://${frontend}/api`, `https://${api}/api`],
            [`//${frontend}/api`, `//${api}/api`],
            [`wss://${frontend}/api`, `wss://${api}/api`],
            [`ws://${frontend}/api`, `wss://${api}/api`],
            [`"${frontend}/api`, `"${api}/api`],
            [`'${frontend}/api`, `'${api}/api`],
          ];

          for (const [from, to] of variants) {
            content = content.split(from).join(to);
          }
        }

        if (aggressive) {
          content = content.replace(apiUrlRegex, (match, protocol, domain, apiPath) => {
            if (domain.toLowerCase() === api) return match;
            return `${protocol}${api}${apiPath}`;
          });
        }

        if (content !== original) {
          await writeFilePrivileged(fullPath, content);
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

export async function applySharedBackendFrontend(destPath, options) {
  const {
    newFrontendDomain,
    sharedApiDomain,
    sourceFrontendDomain,
    servePath,
    compiledOnly = false,
  } = options;

  const frontendUrl = `https://${newFrontendDomain}`;
  const apiUrl = `https://${sharedApiDomain}`;
  const patchRoot = servePath || path.join(destPath, 'frontend');
  const domainMap = new Map();

  // Ne pas remplacer le domaine API dans les assets compilés.
  // Si frontend et API étaient sur le même domaine (ex: avis.kaptainfry.fr),
  // les appels API doivent continuer à pointer vers le backend partagé.
  if (
    sourceFrontendDomain &&
    sourceFrontendDomain !== newFrontendDomain &&
    sourceFrontendDomain !== sharedApiDomain
  ) {
    domainMap.set(sourceFrontendDomain.toLowerCase(), newFrontendDomain);
  }

  let updatedFiles = [];
  if (domainMap.size > 0) {
    updatedFiles = await walkAndReplace(patchRoot, domainMap, { compiledOnly });
  }

  const apiUrlPatches = await patchSharedBackendApiUrlsInAssets(
    patchRoot,
    newFrontendDomain,
    sharedApiDomain,
    { aggressive: true }
  );
  updatedFiles = [...new Set([...updatedFiles, ...apiUrlPatches])];

  if (!compiledOnly) {
    const envValues = {
      APP_URL: frontendUrl,
      FRONTEND_URL: frontendUrl,
      CLIENT_URL: frontendUrl,
      PUBLIC_URL: frontendUrl,
      VITE_APP_URL: frontendUrl,
      VITE_API_URL: apiUrl,
      VITE_BACKEND_URL: apiUrl,
      NEXT_PUBLIC_APP_URL: frontendUrl,
      NEXT_PUBLIC_API_URL: apiUrl,
      REACT_APP_API_URL: apiUrl,
    };

    const frontendPath = path.join(destPath, 'frontend');
    for (const envName of ['.env', '.env.local', '.env.production']) {
      const envPath = path.join(frontendPath, envName);
      const updated = await updateEnvKeys(envPath, envValues);
      if (updated) updatedFiles.push(envPath);
    }
  }

  return {
    frontendUrl,
    apiUrl,
    sharedApiDomain,
    compiledOnly,
    updatedFiles: [...new Set(updatedFiles)],
    rebuildRecommended: !compiledOnly,
  };
}
