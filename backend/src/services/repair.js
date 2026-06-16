import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  buildSpaNginxConfig,
  getAppById,
  reloadNginx,
  testNginxConfig,
  writeNginxConfig,
} from './nginx.js';
import { addCorsOriginToBackend, patchSharedBackendApiUrlsInAssets } from './domain-replace.js';

const SCAN_FILE_PATTERN = /\.(js|css|html|json|map|txt|webmanifest)$/;

function getAppPath(app) {
  if (app.root) {
    return app.root.replace(/\/(public|dist|build)$/, '');
  }
  return path.join(config.appsRoot, app.name);
}

function getServePath(app) {
  if (app.root) return app.root;
  return path.join(getAppPath(app), 'public');
}

export async function scanApiUrlsInAssets(rootDir, sharedApiDomain) {
  const api = sharedApiDomain.replace(/^https?:\/\//, '').toLowerCase();
  const zoneSuffix = api.split('.').slice(-2).join('.').replace(/\./g, '\\.');
  const apiUrlPattern = new RegExp(
    `https?://([a-z0-9-]+\\.${zoneSuffix})(/api)`,
    'gi'
  );
  const findings = [];

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
        if (['node_modules', '.git'].includes(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !SCAN_FILE_PATTERN.test(entry.name)) continue;

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const matches = [...content.matchAll(apiUrlPattern)];
        const wrongDomains = [
          ...new Set(
            matches
              .map((match) => match[1].toLowerCase())
              .filter((domain) => domain !== api)
          ),
        ];

        if (wrongDomains.length > 0) {
          findings.push({
            file: fullPath,
            wrongDomains,
            count: matches.filter((m) => m[1].toLowerCase() !== api).length,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  await walk(rootDir);
  return findings;
}

export async function repairSharedFrontend(targetAppId, options = {}) {
  const {
    sharedApiDomain,
    sourceAppId,
  } = options;

  if (!sharedApiDomain) {
    throw new Error('sharedApiDomain est requis (ex: avis.kaptainfry.fr)');
  }

  const apiDomain = sharedApiDomain.replace(/^https?:\/\//, '');
  const targetApp = await getAppById(targetAppId);
  if (!targetApp) {
    throw new Error(`Application introuvable: ${targetAppId}`);
  }

  const sourceApp = sourceAppId ? await getAppById(sourceAppId) : null;
  const servePath = getServePath(targetApp);
  const frontendDomain = targetApp.domains[0];

  const beforeScan = await scanApiUrlsInAssets(servePath, apiDomain);
  const patchedFiles = await patchSharedBackendApiUrlsInAssets(
    servePath,
    frontendDomain,
    apiDomain,
    { aggressive: true }
  );
  const afterScan = await scanApiUrlsInAssets(servePath, apiDomain);

  const nginxContent = buildSpaNginxConfig({
    domains: targetApp.domains,
    root: servePath,
    apiProxyPass: sourceApp?.proxyPass || null,
    sharedApiDomain: apiDomain,
  });

  const nginxResult = await writeNginxConfig(targetApp.name, nginxContent);

  if (!config.demoMode) {
    const nginxTest = await testNginxConfig();
    if (!nginxTest.ok) {
      throw new Error(`Config Nginx invalide: ${nginxTest.stderr}`);
    }
    await reloadNginx();
  }

  let corsUpdate = null;
  if (sourceApp) {
    const sourcePath = getAppPath(sourceApp);
    corsUpdate = await addCorsOriginToBackend(sourcePath, frontendDomain);
  }

  return {
    ok: true,
    app: targetApp,
    servePath,
    sharedApiDomain: apiDomain,
    beforeScan,
    afterScan,
    patchedFiles,
    nginxResult,
    corsUpdate,
    cacheHint: 'Videz le cache navigateur et désactivez le service worker (DevTools > Application > Service Workers > Unregister).',
  };
}
