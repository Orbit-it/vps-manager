import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getAppById, isManagerApp, reloadNginx, testNginxConfig } from './nginx.js';
import { deleteARecord } from './ovh.js';
import { removePathPrivileged } from './shell.js';

function getAppPath(app) {
  if (app.root) {
    return app.root.replace(/\/(public|dist|build)$/, '');
  }
  return path.join(config.appsRoot, app.name);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeNginxConfig(app) {
  const removed = [];
  const candidates = new Set([
    app.configFile,
    path.join(config.nginxSitesEnabled, `${app.name}.conf`),
    path.join(config.nginxSitesAvailable, `${app.name}.conf`),
  ].filter(Boolean));

  for (const configPath of candidates) {
    if (!(await pathExists(configPath))) continue;
    await removePathPrivileged(configPath);
    removed.push(configPath);
  }

  return removed;
}

export async function deleteApp(appId, options = {}) {
  const {
    removeFiles = true,
    removeNginx = true,
    removeDns = false,
  } = options;

  const app = await getAppById(appId);
  if (!app) {
    throw new Error(`Application introuvable: ${appId}`);
  }

  if (isManagerApp(app)) {
    throw new Error('Impossible de supprimer le VPS App Manager');
  }

  const steps = [];
  const appPath = getAppPath(app);

  if (removeFiles) {
    if (await pathExists(appPath)) {
      await removePathPrivileged(appPath);
      steps.push({ step: 'remove_files', ok: true, path: appPath });
    } else {
      steps.push({ step: 'remove_files', ok: true, skipped: true, path: appPath, reason: 'Dossier déjà absent' });
    }
  }

  if (removeNginx) {
    const removedConfigs = await removeNginxConfig(app);
    steps.push({ step: 'remove_nginx', ok: true, removed: removedConfigs });

    if (!config.demoMode) {
      const nginxTest = await testNginxConfig();
      if (!nginxTest.ok) {
        throw new Error(`Config Nginx invalide après suppression: ${nginxTest.stderr}`);
      }
      await reloadNginx();
      steps.push({ step: 'nginx_reload', ok: true });
    }
  }

  const dnsResults = [];
  if (removeDns) {
    for (const domain of app.domains) {
      dnsResults.push(await deleteARecord(domain));
    }
    steps.push({ step: 'remove_dns', ok: true, results: dnsResults });
  }

  return {
    ok: true,
    app: {
      id: app.id,
      name: app.name,
      domains: app.domains,
      path: appPath,
    },
    steps,
    dns: dnsResults,
    note: removeDns
      ? null
      : 'Les enregistrements DNS OVH n\'ont pas été supprimés. Utilisez removeDns=true si besoin.',
  };
}
