import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { buildNginxConfig, getAppById, writeNginxConfig, reloadNginx, testNginxConfig } from './nginx.js';
import { ensureARecord } from './ovh.js';
import { issueCertificate } from './ssl.js';
import { applyDomainMigration } from './domain-replace.js';
import { runCommand, copyDirectoryPrivileged } from './shell.js';

function getAppPath(app) {
  if (app.root) {
    return app.root.replace(/\/public$/, '');
  }
  return path.join(config.appsRoot, app.name);
}

function shiftProxyPort(proxyPass, offset = 1) {
  if (!proxyPass) return null;
  const match = proxyPass.match(/^(https?:\/\/[^:/]+):(\d+)(.*)$/);
  if (!match) return proxyPass;
  const nextPort = Number(match[2]) + offset;
  return `${match[1]}:${nextPort}${match[3]}`;
}

async function updateBackendPortEnv(appPath, proxyPass) {
  const match = proxyPass?.match(/:(\d+)/);
  if (!match) return null;

  const port = match[1];
  const targets = [
    path.join(appPath, '.env'),
    path.join(appPath, 'backend', '.env'),
    path.join(appPath, 'api', '.env'),
    path.join(appPath, 'server', '.env'),
  ];

  for (const envPath of targets) {
    try {
      let content = await fs.readFile(envPath, 'utf8');
      const regex = /^PORT=.*$/m;
      if (regex.test(content)) {
        content = content.replace(regex, `PORT=${port}`);
      } else {
        content += `\nPORT=${port}`;
      }
      await fs.writeFile(envPath, content, 'utf8');
      return { envPath, port };
    } catch {
      // try next
    }
  }

  return { port };
}

export async function duplicateApp(sourceId, options) {
  const {
    newName,
    newDomains,
    targetIp,
    copyFiles = true,
    createDns = true,
    enableSsl = false,
    rebuildFrontend = false,
  } = options;

  const sourceApp = await getAppById(sourceId);
  if (!sourceApp) {
    throw new Error(`Application source introuvable: ${sourceId}`);
  }

  const sourcePath = getAppPath(sourceApp);
  const destPath = path.join(config.appsRoot, newName);
  const steps = [];

  let domainMigration = null;
  let cloneProxyPass = sourceApp.proxyPass;

  if (copyFiles) {
    const copyResult = await copyDirectoryPrivileged(sourcePath, destPath);
    steps.push({ step: 'copy_files', ok: true, ...copyResult });

    domainMigration = await applyDomainMigration(
      destPath,
      sourceApp.domains,
      newDomains
    );
    steps.push({
      step: 'update_env',
      ok: true,
      ...domainMigration,
    });

    if (sourceApp.proxyPass) {
      cloneProxyPass = shiftProxyPort(sourceApp.proxyPass, 1);
      const portUpdate = await updateBackendPortEnv(destPath, cloneProxyPass);
      steps.push({ step: 'update_backend_port', ok: true, ...portUpdate, proxyPass: cloneProxyPass });
    }

    if (rebuildFrontend && !config.demoMode) {
      const frontendDir = path.join(destPath, 'frontend');
      try {
        await fs.access(path.join(frontendDir, 'package.json'));
        const buildResult = await runCommand('npm', ['run', 'build'], { cwd: frontendDir });
        steps.push({
          step: 'rebuild_frontend',
          ok: buildResult.ok,
          output: buildResult.stdout,
          error: buildResult.ok ? null : buildResult.stderr,
        });
      } catch {
        steps.push({ step: 'rebuild_frontend', ok: false, skipped: true });
      }
    }
  }

  const nginxContent = buildNginxConfig({
    domains: newDomains,
    root: sourceApp.root ? `${destPath}/public` : null,
    proxyPass: cloneProxyPass,
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
      frontendUrl: domainMigration?.frontendUrl,
      apiUrl: domainMigration?.apiUrl,
    },
    domainMigration,
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
    useSudo: config.useSudo,
    appsRoot: config.appsRoot,
    nginxSitesEnabled: config.nginxSitesEnabled,
  };
}
