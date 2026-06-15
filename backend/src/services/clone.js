import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  buildNginxConfig,
  buildSpaNginxConfig,
  getAppById,
  writeNginxConfig,
  reloadNginx,
  testNginxConfig,
} from './nginx.js';
import { ensureARecord } from './ovh.js';
import { issueCertificate } from './ssl.js';
import {
  applyDomainMigration,
  applySharedBackendFrontend,
  addCorsOriginToBackend,
} from './domain-replace.js';
import { runCommand, copyDirectoryPrivileged } from './shell.js';

function getAppPath(app) {
  if (app.root) {
    return app.root.replace(/\/public$/, '');
  }
  return path.join(config.appsRoot, app.name);
}

function inferApiDomain(sourceApp, sharedApiDomain) {
  if (sharedApiDomain) return sharedApiDomain.replace(/^https?:\/\//, '');
  return sourceApp.domains[1] || sourceApp.domains[0];
}

function inferFrontendDomain(sourceApp) {
  return sourceApp.domains[0];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasIndexHtml(dir) {
  return fileExists(path.join(dir, 'index.html'));
}

async function hasPackageJson(dir) {
  return fileExists(path.join(dir, 'package.json'));
}

async function resolveServeDir(basePath) {
  if (await hasIndexHtml(basePath)) {
    return basePath;
  }

  for (const sub of ['dist', 'build']) {
    const nested = path.join(basePath, sub);
    if (await hasIndexHtml(nested)) {
      return nested;
    }
  }

  return null;
}

async function detectFrontendAssets(sourcePath, sourceApp) {
  const candidates = [];

  if (sourceApp?.root) {
    candidates.push({ label: 'nginx-root', basePath: sourceApp.root });
  }

  for (const name of ['public', 'frontend', 'client', 'web', 'dist', 'build']) {
    candidates.push({ label: name, basePath: path.join(sourcePath, name) });
  }

  for (const candidate of candidates) {
    if (!(await fileExists(candidate.basePath))) continue;

    const serveFrom = await resolveServeDir(candidate.basePath);
    if (!serveFrom) continue;

    const hasSource = await hasPackageJson(candidate.basePath);
    const compiledOnly = !hasSource || serveFrom !== candidate.basePath || candidate.label === 'nginx-root';

    return {
      ...candidate,
      serveFrom,
      compiledOnly: compiledOnly || !(await hasPackageJson(path.dirname(serveFrom))),
    };
  }

  if (config.demoMode) {
    return {
      label: 'demo',
      basePath: path.join(sourcePath, 'frontend'),
      serveFrom: path.join(sourcePath, 'frontend', 'dist'),
      compiledOnly: true,
    };
  }

  throw new Error(
    'Frontend introuvable. Dossiers acceptés : public/, dist/, build/, frontend/dist/ ou root Nginx avec index.html'
  );
}

async function copyFrontendOnly(sourcePath, destPath, sourceApp) {
  const assets = await detectFrontendAssets(sourcePath, sourceApp);

  if (assets.compiledOnly) {
    const destServe = path.join(destPath, 'public');
    if (config.demoMode) {
      return {
        mode: 'compiled',
        src: assets.serveFrom,
        dest: destServe,
        nginxRoot: destServe,
        compiledOnly: true,
      };
    }

    await copyDirectoryPrivileged(assets.serveFrom, destServe);
    return {
      mode: 'compiled',
      src: assets.serveFrom,
      dest: destServe,
      nginxRoot: destServe,
      compiledOnly: true,
      sourceLabel: assets.label,
    };
  }

  const frontendDest = path.join(destPath, 'frontend');
  if (config.demoMode) {
    return {
      mode: 'source',
      src: assets.basePath,
      dest: frontendDest,
      nginxRoot: path.join(frontendDest, 'dist'),
      compiledOnly: false,
    };
  }

  await copyDirectoryPrivileged(assets.basePath, frontendDest);
  const serveFrom = await resolveServeDir(frontendDest);
  return {
    mode: 'source',
    src: assets.basePath,
    dest: frontendDest,
    nginxRoot: serveFrom || path.join(frontendDest, 'dist'),
    compiledOnly: false,
  };
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

async function rebuildFrontendAt(frontendDir) {
  if (config.demoMode) {
    return { ok: true, demo: true };
  }

  try {
    await fs.access(path.join(frontendDir, 'package.json'));
  } catch {
    return { ok: false, skipped: true, reason: 'package.json introuvable' };
  }

  return runCommand('npm', ['run', 'build'], { cwd: frontendDir });
}

async function duplicateFullStack(sourceApp, sourcePath, destPath, newDomains, rebuildFrontend, steps) {
  let domainMigration = null;
  let cloneProxyPass = sourceApp.proxyPass;

  const copyResult = await copyDirectoryPrivileged(sourcePath, destPath);
  steps.push({ step: 'copy_files', ok: true, ...copyResult });

  domainMigration = await applyDomainMigration(destPath, sourceApp.domains, newDomains);
  steps.push({ step: 'update_env', ok: true, ...domainMigration });

  if (sourceApp.proxyPass) {
    cloneProxyPass = shiftProxyPort(sourceApp.proxyPass, 1);
    const portUpdate = await updateBackendPortEnv(destPath, cloneProxyPass);
    steps.push({ step: 'update_backend_port', ok: true, ...portUpdate, proxyPass: cloneProxyPass });
  }

  if (rebuildFrontend) {
    const buildResult = await rebuildFrontendAt(path.join(destPath, 'frontend'));
    steps.push({
      step: 'rebuild_frontend',
      ok: buildResult.ok !== false,
      ...buildResult,
    });
  }

  const nginxContent = buildNginxConfig({
    domains: newDomains,
    root: sourceApp.root ? `${destPath}/public` : null,
    proxyPass: cloneProxyPass,
  });

  return { nginxContent, domainMigration, apiUrl: domainMigration?.apiUrl, frontendUrl: domainMigration?.frontendUrl };
}

async function duplicateFrontendShared(sourceApp, sourcePath, destPath, newDomains, sharedApiDomain, rebuildFrontend, steps) {
  const frontendDomain = newDomains[0];
  const apiDomain = inferApiDomain(sourceApp, sharedApiDomain);
  const sourceFrontendDomain = inferFrontendDomain(sourceApp);

  const copyResult = await copyFrontendOnly(sourcePath, destPath, sourceApp);
  steps.push({ step: 'copy_frontend', ok: true, mode: 'frontend-shared', ...copyResult });

  const frontendConfig = await applySharedBackendFrontend(destPath, {
    newFrontendDomain: frontendDomain,
    sharedApiDomain: apiDomain,
    sourceFrontendDomain,
    servePath: copyResult.nginxRoot,
    compiledOnly: copyResult.compiledOnly,
  });
  steps.push({ step: 'configure_frontend', ok: true, ...frontendConfig });

  const corsUpdate = await addCorsOriginToBackend(sourcePath, frontendDomain);
  steps.push({ step: 'update_source_cors', ok: true, ...corsUpdate });

  if (rebuildFrontend && !copyResult.compiledOnly) {
    const buildResult = await rebuildFrontendAt(path.join(destPath, 'frontend'));
    steps.push({
      step: 'rebuild_frontend',
      ok: buildResult.ok !== false,
      ...buildResult,
    });
  } else if (copyResult.compiledOnly) {
    steps.push({
      step: 'rebuild_frontend',
      ok: true,
      skipped: true,
      reason: 'Fichiers compilés détectés — remplacement direct dans les assets',
    });
  }

  const nginxContent = buildSpaNginxConfig({
    domains: [frontendDomain],
    root: copyResult.nginxRoot,
  });

  return {
    nginxContent,
    domainMigration: frontendConfig,
    apiUrl: frontendConfig.apiUrl,
    frontendUrl: frontendConfig.frontendUrl,
    sharedApiDomain: apiDomain,
    corsUpdate,
  };
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
    duplicateMode = 'full',
    sharedApiDomain = '',
  } = options;

  const sourceApp = await getAppById(sourceId);
  if (!sourceApp) {
    throw new Error(`Application source introuvable: ${sourceId}`);
  }

  const sourcePath = getAppPath(sourceApp);
  const destPath = path.join(config.appsRoot, newName);
  const steps = [];
  const isSharedFrontend = duplicateMode === 'frontend-shared';

  let nginxContent;
  let domainMigration = null;
  let sharedMeta = null;

  if (copyFiles) {
    if (isSharedFrontend) {
      const result = await duplicateFrontendShared(
        sourceApp,
        sourcePath,
        destPath,
        newDomains,
        sharedApiDomain,
        rebuildFrontend !== false,
        steps
      );
      nginxContent = result.nginxContent;
      domainMigration = result.domainMigration;
      sharedMeta = result;
    } else {
      const result = await duplicateFullStack(
        sourceApp,
        sourcePath,
        destPath,
        newDomains,
        rebuildFrontend,
        steps
      );
      nginxContent = result.nginxContent;
      domainMigration = result.domainMigration;
    }
  } else {
    nginxContent = buildNginxConfig({ domains: newDomains, root: sourceApp.root, proxyPass: sourceApp.proxyPass });
  }

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

  const dnsDomains = isSharedFrontend ? [newDomains[0]] : newDomains;
  const dnsResults = [];
  if (createDns && targetIp) {
    for (const domain of dnsDomains) {
      dnsResults.push(await ensureARecord(domain, targetIp));
    }
  }
  steps.push({ step: 'dns', ok: true, results: dnsResults });

  let sslResult = null;
  if (enableSsl) {
    sslResult = await issueCertificate(dnsDomains);
    steps.push({ step: 'ssl', ok: sslResult.ok, ...sslResult });
  }

  return {
    ok: true,
    duplicateMode,
    source: sourceApp,
    clone: {
      id: newName,
      name: newName,
      domains: isSharedFrontend ? [newDomains[0]] : newDomains,
      path: destPath,
      configFile: `${config.nginxSitesEnabled}/${newName}.conf`,
      frontendUrl: domainMigration?.frontendUrl,
      apiUrl: domainMigration?.apiUrl,
      sharedApiDomain: sharedMeta?.sharedApiDomain || null,
    },
    domainMigration,
    sharedBackend: isSharedFrontend,
    corsUpdate: sharedMeta?.corsUpdate || null,
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
