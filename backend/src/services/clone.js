import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { buildNginxConfig, getAppById, writeNginxConfig, reloadNginx, testNginxConfig } from './nginx.js';
import { ensureARecord } from './ovh.js';
import { issueCertificate } from './ssl.js';
import { runCommand } from './shell.js';

async function copyDirectory(src, dest) {
  if (config.demoMode) {
    return { src, dest, demo: true };
  }

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }

  return { src, dest };
}

async function updateEnvFile(appPath, replacements) {
  const envPath = path.join(appPath, '.env');

  if (config.demoMode) {
    return { envPath, demo: true, replacements };
  }

  try {
    let content = await fs.readFile(envPath, 'utf8');

    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    }

    await fs.writeFile(envPath, content, 'utf8');
    return { envPath, updated: true };
  } catch {
    return { envPath, updated: false, skipped: true };
  }
}

function getAppPath(app) {
  if (app.root) {
    return app.root.replace(/\/public$/, '');
  }
  return path.join(config.appsRoot, app.name);
}

export async function duplicateApp(sourceId, options) {
  const {
    newName,
    newDomains,
    targetIp,
    copyFiles = true,
    createDns = true,
    enableSsl = false,
  } = options;

  const sourceApp = await getAppById(sourceId);
  if (!sourceApp) {
    throw new Error(`Application source introuvable: ${sourceId}`);
  }

  const sourcePath = getAppPath(sourceApp);
  const destPath = path.join(config.appsRoot, newName);
  const steps = [];

  if (copyFiles) {
    const copyResult = await copyDirectory(sourcePath, destPath);
    steps.push({ step: 'copy_files', ok: true, ...copyResult });

    const envUpdates = {};
    if (newDomains[0]) envUpdates.APP_URL = `https://${newDomains[0]}`;
    if (newDomains[1]) envUpdates.API_URL = `https://${newDomains[1]}`;

    const envResult = await updateEnvFile(destPath, envUpdates);
    steps.push({ step: 'update_env', ok: true, ...envResult });
  }

  const nginxContent = buildNginxConfig({
    domains: newDomains,
    root: sourceApp.root ? destPath + '/public' : null,
    proxyPass: sourceApp.proxyPass,
  });

  const nginxResult = await writeNginxConfig(newName, nginxContent);
  steps.push({ step: 'nginx_config', ok: true, ...nginxResult });

  const nginxTest = await testNginxConfig();
  if (!nginxTest.ok && !config.demoMode) {
    throw new Error(`Config Nginx invalide: ${nginxTest.stderr}`);
  }

  if (!config.demoMode) {
    await reloadNginx();
  }
  steps.push({ step: 'nginx_reload', ok: true });

  const dnsResults = [];
  if (createDns && targetIp) {
    for (const domain of newDomains) {
      const dnsResult = await ensureARecord(domain, targetIp);
      dnsResults.push(dnsResult);
    }
  }
  steps.push({ step: 'dns', ok: true, results: dnsResults });

  let sslResult = null;
  if (enableSsl) {
    sslResult = await issueCertificate(newDomains);
    steps.push({ step: 'ssl', ok: sslResult.ok, ...sslResult });
  }

  return {
    ok: true,
    source: sourceApp,
    clone: {
      id: newName,
      name: newName,
      domains: newDomains,
      path: destPath,
      configFile: `${config.nginxSitesEnabled}/${newName}.conf`,
    },
    steps,
    dns: dnsResults,
    ssl: sslResult,
  };
}

export async function getServerInfo() {
  let publicIp = config.vpsPublicIp;

  if (!publicIp && !config.demoMode) {
    const result = await runCommand('curl', ['-s', 'ifconfig.me']);
    if (result.ok) publicIp = result.stdout.trim();
  }

  if (!publicIp) {
    publicIp = '203.0.113.10';
  }

  return {
    publicIp,
    demoMode: config.demoMode,
    appsRoot: config.appsRoot,
    nginxSitesEnabled: config.nginxSitesEnabled,
  };
}
