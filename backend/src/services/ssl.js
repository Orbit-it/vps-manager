import fs from 'node:fs/promises';
import { config } from '../config.js';
import { runCommand, runPrivilegedCommand } from './shell.js';
import { getCertificateInfo } from './health.js';
import { reloadNginx, testNginxConfig } from './nginx.js';

async function checkCertFile(certPath, domain) {
  try {
    await fs.access(certPath);
    const result = await runCommand('openssl', [
      'x509',
      '-in', certPath,
      '-noout',
      '-issuer',
      '-enddate',
    ]);

    if (!result.ok) {
      return { domain, exists: false, path: certPath };
    }

    const endMatch = result.stdout.match(/notAfter=(.+)/);
    return {
      domain,
      exists: true,
      path: certPath,
      validTo: endMatch?.[1] || null,
    };
  } catch {
    return { domain, exists: false, path: certPath };
  }
}

export async function issueCertificate(domains, email) {
  const certbotEmail = email || config.certbotEmail;
  const domainArgs = domains.flatMap((d) => ['-d', d]);

  if (config.demoMode) {
    return {
      ok: true,
      status: 'active',
      domains,
      message: `Certificat SSL simulé pour ${domains.join(', ')}`,
      demo: true,
    };
  }

  const result = await runPrivilegedCommand('certbot', [
    '--nginx',
    ...domainArgs,
    '--non-interactive',
    '--agree-tos',
    '-m', certbotEmail,
    '--redirect',
  ]);

  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout, domains };
  }

  const nginxTest = await testNginxConfig();
  if (!nginxTest.ok) {
    return { ok: false, error: nginxTest.stderr, domains };
  }

  await reloadNginx();

  const certInfo = await getCertificateInfo(domains[0]);
  return {
    ok: true,
    status: 'active',
    domains,
    certificate: certInfo,
    output: result.stdout,
  };
}

export async function renewCertificate(domain) {
  if (config.demoMode) {
    return { ok: true, domain, message: 'Renouvellement simulé', demo: true };
  }

  const result = await runPrivilegedCommand('certbot', ['renew', '--cert-name', domain, '--quiet']);
  if (result.ok) {
    await reloadNginx();
  }

  return {
    ok: result.ok,
    domain,
    output: result.stdout,
    error: result.ok ? null : result.stderr,
  };
}

export async function listCertificates() {
  if (config.demoMode) {
    return [
      { domain: 'client1.example.com', expiry: '2026-06-09' },
    ];
  }

  const result = await runPrivilegedCommand('certbot', ['certificates']);
  return { raw: result.stdout, ok: result.ok };
}

export async function getSslStatus(app) {
  if (config.demoMode) {
    return {
      status: app.ssl ? 'active' : 'missing',
      domains: app.domains.map((domain) => ({ domain, exists: app.ssl })),
    };
  }

  if (app.sslCertPath) {
    const certInfo = await checkCertFile(app.sslCertPath, app.domains[0]);
    if (certInfo.exists) {
      return {
        status: 'active',
        source: 'nginx',
        domains: app.domains.map((domain) => ({ ...certInfo, domain })),
      };
    }

    if (app.ssl) {
      return {
        status: 'configured',
        source: 'nginx',
        domains: app.domains.map((domain) => ({ domain, exists: true, fromNginx: true })),
      };
    }
  }

  if (app.ssl) {
    return {
      status: 'configured',
      source: 'nginx',
      domains: app.domains.map((domain) => ({ domain, exists: true, fromNginx: true })),
    };
  }

  const statuses = await Promise.all(
    app.domains.map(async (domain) => ({
      domain,
      ...(await getCertificateInfo(domain)),
    }))
  );

  const allActive = statuses.every((s) => s.exists);
  const anyActive = statuses.some((s) => s.exists);

  return {
    status: allActive ? 'active' : anyActive ? 'partial' : 'missing',
    domains: statuses,
  };
}
